import "server-only";
import { lookup } from "node:dns/promises";
import { isPrivateIpAddress, isPublicHttpUrl } from "@/lib/url-guard";

/**
 * The resolving half of the SSRF guard. `isPublicHttpUrl` only judges the URL
 * as written, so `https://evil.example.com/` passes it while its A record
 * points at 169.254.169.254 — the whole attack is that the hostname looks fine.
 * This module resolves the name and rejects the URL when *any* address it maps
 * to is private, loopback, link-local, CGNAT, multicast or IPv4-mapped-private.
 *
 * `dns.lookup` (not `dns.resolve`) is deliberate: it goes through the OS
 * resolver, which is what `fetch` itself will use, so /etc/hosts and search
 * domains are seen the same way by the check and by the request.
 *
 * Residual risk, stated plainly: this is a check-then-connect, so a hostname
 * whose record flips between the check and the socket (DNS rebinding) can still
 * slip through. Closing that fully needs connection-time enforcement (a custom
 * dispatcher) or an egress proxy; `guardedFetch` below narrows the window to a
 * single request by re-checking on every call and on every redirect hop rather
 * than only at write time.
 */

/** Fail closed when DNS says nothing — an unresolvable host can't be fetched anyway. */
async function resolvedAddresses(hostname: string): Promise<string[] | null> {
  const host =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  // An IP literal is already fully judged by the literal guard.
  if (isPrivateIpAddress(host)) return [host];

  try {
    const records = await lookup(host, { all: true, verbatim: true });
    if (records.length === 0) return null;
    return records.map((record) => record.address);
  } catch {
    return null;
  }
}

export async function isPublicHttpUrlWithDns(value: string): Promise<boolean> {
  if (!isPublicHttpUrl(value)) return false;

  // Outside production the literal guard already allows private hosts on
  // purpose (local mock IdPs, self-hosted gateways) — resolving would undo it.
  if (process.env.NODE_ENV !== "production") return true;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const addresses = await resolvedAddresses(url.hostname);
  if (!addresses) return false;
  return !addresses.some(isPrivateIpAddress);
}

/** Throws a user-facing message when the URL isn't safe to fetch server-side. */
export async function assertPublicHttpUrlWithDns(
  value: string,
  label = "URL",
): Promise<void> {
  if (!(await isPublicHttpUrlWithDns(value))) {
    throw new Error(
      `${label} must be a public https:// address that resolves to a public IP. Private, loopback, and link-local hosts aren't allowed.`,
    );
  }
}

const MAX_REDIRECTS = 5;

/**
 * A `fetch` that re-runs the guard on every request *and* on every redirect
 * hop. Pass it to any SDK that will call a user-supplied base URL (the OpenAI
 * client takes it via its `fetch` option) so a URL that passed validation at
 * write time can't be re-pointed at internal infrastructure afterwards, and so
 * a public host can't 302 the request into the private network.
 */
export const guardedFetch: typeof fetch = async (input, init) => {
  let request = new Request(input as RequestInfo, init);
  await assertPublicHttpUrlWithDns(request.url, "The request URL");

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // `manual` hands back the 3xx itself so each hop can be guarded; letting
    // fetch follow redirects internally would skip the check entirely.
    const response = await fetch(request, { redirect: "manual" });

    const location =
      response.status >= 300 && response.status <= 399
        ? response.headers.get("location")
        : null;
    if (!location) return response;

    const target = new URL(location, request.url).toString();
    await assertPublicHttpUrlWithDns(target, "The redirect target");

    // 303 always continues as GET; so does 301/302 on a non-GET (RFC 9110).
    const dropsBody =
      response.status === 303 ||
      (response.status !== 307 &&
        response.status !== 308 &&
        request.method !== "GET" &&
        request.method !== "HEAD");

    request = dropsBody
      ? new Request(target, { method: "GET", headers: request.headers })
      : new Request(target, request);
  }

  throw new Error("Too many redirects while fetching the request URL.");
};
