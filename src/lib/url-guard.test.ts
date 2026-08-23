import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPrivateIpAddress, isPublicHttpUrl } from "./url-guard";

describe("isPrivateIpAddress", () => {
  it("rejects the IPv4 ranges that reach internal infrastructure", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "127.0.0.1",
      "100.64.0.1", // CGNAT
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "192.0.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateIpAddress(address), address).toBe(true);
    }
  });

  it("allows genuinely public IPv4", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "100.63.0.1"]) {
      expect(isPrivateIpAddress(address), address).toBe(false);
    }
  });

  it("rejects the IPv6 ranges, including addresses that embed a private IPv4", () => {
    for (const address of [
      "::",
      "::1",
      "[::1]",
      "fd00::1", // unique local
      "fe80::1", // link-local
      "fe80::1%eth0", // link-local with a zone id
      "ff02::1", // multicast
      "::ffff:127.0.0.1", // IPv4-mapped loopback
      "::ffff:169.254.169.254", // IPv4-mapped metadata
      "64:ff9b::10.0.0.1", // NAT64
      "2002:a00:1::", // 6to4 wrapping 10.0.0.1
    ]) {
      expect(isPrivateIpAddress(address), address).toBe(true);
    }
  });

  it("allows public IPv6 and IPv4-mapped public addresses", () => {
    for (const address of [
      "2606:4700:4700::1111",
      "::ffff:8.8.8.8",
      "2002:808:808::", // 6to4 wrapping 8.8.8.8
    ]) {
      expect(isPrivateIpAddress(address), address).toBe(false);
    }
  });

  it("treats non-addresses as not-an-IP rather than private", () => {
    for (const value of ["example.com", "", "1.2.3", "999.1.1.1", "gg::1"]) {
      expect(isPrivateIpAddress(value), value).toBe(false);
    }
  });
});

describe("isPublicHttpUrl in production", () => {
  // `process.env.NODE_ENV` is a read-only type; assigning to it fails
  // `tsc --noEmit`. Vitest's stub does the same job and restores cleanly.
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows public https URLs", () => {
    expect(isPublicHttpUrl("https://accounts.google.com/")).toBe(true);
    expect(isPublicHttpUrl("https://llm.example.com/v1")).toBe(true);
  });

  it("rejects plain http and non-http schemes", () => {
    expect(isPublicHttpUrl("http://example.com/")).toBe(false);
    expect(isPublicHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicHttpUrl("not a url")).toBe(false);
  });

  it("rejects hosts that name something internal", () => {
    for (const url of [
      "https://localhost/",
      "https://redis/", // single label
      "https://db.internal/",
      "https://printer.local/",
      "https://metadata.google.internal/",
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });

  it("rejects private IP literals, including the obfuscated forms URL normalizes", () => {
    for (const url of [
      "https://127.0.0.1/",
      "https://169.254.169.254/latest/meta-data/",
      "https://2130706433/", // decimal 127.0.0.1
      "https://0177.0.0.1/", // octal 127.0.0.1
      "https://[::1]/",
      "https://[fd00::1]/",
      "https://[fe80::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://100.64.0.1/",
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });

  it("still allows a public hostname — resolution is url-guard-dns's job", () => {
    // The literal guard cannot see the A record; `isPublicHttpUrlWithDns` is
    // what rejects this, and it is what every server-side fetch path uses.
    expect(isPublicHttpUrl("https://evil.example.com/")).toBe(true);
  });
});
