/**
 * Guard for URLs that the *server* will fetch on a user's behalf (SSO issuer
 * discovery, SSO OIDC endpoints, AI provider base URLs). Without it, anyone who
 * can save such a URL can make the server issue requests to cloud metadata
 * endpoints (169.254.169.254), the database host, or any other service
 * reachable from the app network — a server-side request forgery.
 *
 * This module is the *literal* half of the guard: it judges the URL as written,
 * so it is synchronous and safe to import anywhere (zod refinements, client
 * bundles). It cannot see where a DNS name actually points — `evil.example.com`
 * with an A record of 169.254.169.254 passes every check here. The resolving
 * half lives in `src/lib/url-guard-dns.ts` and is what every server-side fetch
 * path must use; this one is the cheap pre-filter and the last-line check on
 * sync code paths.
 *
 * Plain http and private/loopback hosts are allowed outside production so local
 * mock IdPs and self-hosted model gateways still work in development.
 */

/**
 * Hostnames that are internal by name rather than by address. Single-label
 * hosts (`redis`, `intranet`) are covered separately below — on a corporate
 * network they resolve to internal services, and no public IdP or AI provider
 * is ever addressed without a dot.
 */
const PRIVATE_HOST_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".home.arpa",
  ".in-addr.arpa",
  ".ip6.arpa",
];

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(host: string): number[] | null {
  const match = IPV4_PATTERN.exec(host);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

/**
 * Every IPv4 range that must never be reachable from a user-supplied URL.
 * Note that `new URL()` normalizes the obfuscated forms (`http://2130706433/`,
 * `http://0177.0.0.1/`) to dotted-quad before we ever see them, so classifying
 * the dotted form is sufficient.
 */
function isPrivateIpv4([a, b]: number[]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 — "this network", incl. unspecified
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, 255.255.255.255
  return false;
}

/**
 * Expands an IPv6 literal (already stripped of brackets) into eight 16-bit
 * groups, resolving `::` and a trailing embedded IPv4 (`::ffff:127.0.0.1`).
 * Returns null when the text isn't a well-formed IPv6 address.
 */
function parseIpv6(host: string): number[] | null {
  let text = host;

  // A zone id (`fe80::1%eth0`) never changes which range the address is in.
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  if (lastColon !== -1) {
    const embedded = parseIpv4(text.slice(lastColon + 1));
    if (embedded) {
      tail = [
        (embedded[0] << 8) | embedded[1],
        (embedded[2] << 8) | embedded[3],
      ];
      text = text.slice(0, lastColon + 1);
      // Leave the trailing ":" only when it is part of a "::" run.
      if (!text.endsWith("::")) text = text.slice(0, -1);
    }
  }

  const doubleColon = text.indexOf("::");
  let head: string[];
  let rest: string[];
  if (doubleColon === -1) {
    head = text === "" ? [] : text.split(":");
    rest = [];
  } else {
    if (text.indexOf("::", doubleColon + 1) !== -1) return null;
    const left = text.slice(0, doubleColon);
    const right = text.slice(doubleColon + 2);
    head = left === "" ? [] : left.split(":");
    rest = right === "" ? [] : right.split(":");
  }

  const parseGroup = (group: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    return Number.parseInt(group, 16);
  };

  const headGroups: number[] = [];
  for (const group of head) {
    const value = parseGroup(group);
    if (value === null) return null;
    headGroups.push(value);
  }
  const restGroups: number[] = [];
  for (const group of rest) {
    const value = parseGroup(group);
    if (value === null) return null;
    restGroups.push(value);
  }

  const explicit = headGroups.length + restGroups.length + tail.length;
  if (doubleColon === -1) {
    return explicit === 8 ? [...headGroups, ...restGroups, ...tail] : null;
  }
  if (explicit > 7) return null; // "::" must stand for at least one group
  const fill = new Array(8 - explicit).fill(0) as number[];
  return [...headGroups, ...fill, ...restGroups, ...tail];
}

function isPrivateIpv6(groups: number[]): boolean {
  const [g0, g1] = groups;

  // ::/128 unspecified and ::1/128 loopback (and the whole deprecated
  // ::/96 IPv4-compatible block, which embeds an IPv4 address).
  if (groups.slice(0, 5).every((g) => g === 0)) {
    if (g0 === 0 && groups[5] === 0) return true;
    // ::ffff:a.b.c.d — IPv4-mapped: judge the embedded IPv4.
    if (groups[5] === 0xffff) {
      return isPrivateIpv4([
        groups[6] >> 8,
        groups[6] & 0xff,
        groups[7] >> 8,
        groups[7] & 0xff,
      ]);
    }
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  // 64:ff9b::/96 NAT64 and 2002::/16 6to4 both tunnel an IPv4 address; a
  // private one behind either is still a request to the internal network.
  if (g0 === 0x0064 && g1 === 0xff9b) {
    return isPrivateIpv4([
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ]);
  }
  if (g0 === 0x2002) {
    return isPrivateIpv4([
      g1 >> 8,
      g1 & 0xff,
      groups[2] >> 8,
      groups[2] & 0xff,
    ]);
  }

  return false;
}

/**
 * True when the literal IP address is one the server must never be asked to
 * reach. Exported for `url-guard-dns.ts`, which runs it against every address a
 * hostname resolves to.
 */
export function isPrivateIpAddress(address: string): boolean {
  const stripped =
    address.startsWith("[") && address.endsWith("]")
      ? address.slice(1, -1)
      : address;

  const ipv4 = parseIpv4(stripped);
  if (ipv4) return isPrivateIpv4(ipv4);

  const ipv6 = parseIpv6(stripped);
  if (ipv6) return isPrivateIpv6(ipv6);

  return false;
}

/**
 * True when the hostname *as written* names something internal — an internal
 * TLD, a single-label host, or a private/loopback/link-local IP literal. Says
 * nothing about where a public-looking DNS name resolves to.
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") return true;
  if (host === "localhost") return true;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)))
    return true;

  const isIpLiteral =
    (host.startsWith("[") && host.endsWith("]")) || IPV4_PATTERN.test(host);
  if (isIpLiteral) return isPrivateIpAddress(host);

  // Single-label hosts (`redis`, `vault`) only resolve on an internal network.
  if (!host.includes(".")) return true;

  return false;
}

export function isPublicHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (process.env.NODE_ENV !== "production") {
    return url.protocol === "https:" || url.protocol === "http:";
  }
  return url.protocol === "https:" && !isPrivateHostname(url.hostname);
}

/** Throws a user-facing message when the URL isn't safe to fetch server-side. */
export function assertPublicHttpUrl(value: string, label = "URL"): void {
  if (!isPublicHttpUrl(value)) {
    throw new Error(
      `${label} must be a public https:// address. Private, loopback, and link-local hosts aren't allowed.`,
    );
  }
}
