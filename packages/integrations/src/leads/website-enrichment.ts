import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { emptyEnrichment, type EnrichmentInput, type EnrichmentProvider, type EnrichmentResult } from "./types";

/**
 * Public-website enrichment. Deliberately conservative:
 *  - honours robots.txt (skips sites that disallow "/" for all agents or our agent)
 *  - fetches only the homepage, with a timeout and a 1 MB cap
 *  - extracts only business contact details the site publishes (mailto links, tel links,
 *    social profile links) and simple feature signals
 * No crawling, no login walls, no personal data beyond what the business lists publicly.
 */

const USER_AGENT = "ReachlyBot/1.0 (+https://reachly.dev/bot)";
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;

const MAX_REDIRECTS = 3;

/** True for loopback, private, link-local, CGNAT and multicast addresses (IPv4 and IPv6). */
export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (isIP(value) === 4) {
    const [a = 0, b = 0] = value.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80") || value.startsWith("ff");
}

/**
 * Lead websites come from third-party data, so only public http(s) hosts are fetched —
 * never internal services (SSRF). Every redirect hop is checked the same way.
 */
export async function isPublicHttpUrl(url: URL): Promise<boolean> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  try {
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
    return addresses.length > 0 && addresses.every((address) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<{ status: number; text: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current = new URL(url);
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!(await isPublicHttpUrl(current))) return null;
      response = await fetch(current, { headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain" }, redirect: "manual", signal: controller.signal });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (!location) break;
      current = new URL(location, current);
      response = null;
    }
    if (!response) return null;
    const reader = response.body?.getReader();
    if (!reader) return { status: response.status, text: "", finalUrl: response.url };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { status: response.status, text: Buffer.concat(chunks).toString("utf8"), finalUrl: response.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal robots.txt evaluation for the homepage path. */
export function robotsAllowsHomepage(robots: string, agent = "reachlybot"): boolean {
  let applies = false;
  let appliesToUs = false;
  let disallowAll = false;
  let disallowUs = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const key = field?.trim().toLowerCase();
    if (key === "user-agent") {
      const ua = value.toLowerCase();
      appliesToUs = ua === agent;
      applies = ua === "*" || appliesToUs;
    } else if (key === "disallow" && applies && value === "/") {
      if (appliesToUs) disallowUs = true;
      else disallowAll = true;
    }
  }
  return !disallowUs && !disallowAll;
}

const EMAIL_RE = /mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
const TEL_RE = /tel:([+\d][\d\s()-]{6,})/gi;
const SOCIAL: Array<[string, RegExp]> = [
  ["instagram", /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.]+/i],
  ["facebook", /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.-]+/i],
  ["linkedin", /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9_.-]+/i],
  ["x", /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]+/i],
  ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/)[A-Za-z0-9_.-]+/i],
];

export class WebsiteEnrichmentProvider implements EnrichmentProvider {
  readonly name = "website";
  readonly isMock = false;

  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    const result = emptyEnrichment();
    if (!input.website) {
      result.signals.push({ key: "no_website", evidence: "No website listed", weight: 0.9, source: "listing" });
      return result;
    }
    let base: URL;
    try {
      base = new URL(input.website.startsWith("http") ? input.website : `https://${input.website}`);
    } catch {
      return result;
    }

    const robots = await fetchText(new URL("/robots.txt", base).toString());
    if (robots && robots.status === 200 && !robotsAllowsHomepage(robots.text)) {
      result.website = { reachable: true, https: base.protocol === "https:", hasOrdering: false, hasBooking: false, title: null };
      return result; // Respect the site's wishes: no further analysis.
    }

    const page = await fetchText(base.toString());
    if (!page || page.status >= 400) {
      result.website = { reachable: false, https: base.protocol === "https:", hasOrdering: false, hasBooking: false, title: null };
      result.signals.push({ key: "weak_website", evidence: "Website did not load", weight: 0.6, source: "website" });
      return result;
    }

    const html = page.text;
    const lower = html.toLowerCase();
    const https = page.finalUrl.startsWith("https://");
    const title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1]?.trim() ?? null;
    const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i.exec(html)?.[1]?.trim() ?? null;
    const hasOrdering = /(order online|order now|add to cart|checkout|zomato|swiggy|ubereats|doordash)/i.test(lower);
    const hasBooking = /(book now|book a table|reserve|reservation|book appointment|schedule a call)/i.test(lower);

    for (const match of html.matchAll(EMAIL_RE)) {
      const value = match[1]?.toLowerCase();
      if (value && !result.emails.some((email) => email.value === value)) result.emails.push({ value, source: "website" });
    }
    for (const match of html.matchAll(TEL_RE)) {
      const value = match[1]?.replace(/[^\d+]/g, "");
      if (value && !result.phones.some((phone) => phone.value === value)) result.phones.push({ value, source: "website" });
    }
    for (const [network, pattern] of SOCIAL) {
      const url = pattern.exec(html)?.[0];
      if (url) result.socialProfiles[network] = url;
    }

    result.description = description;
    result.website = { reachable: true, https, hasOrdering, hasBooking, title };
    if (!https) result.signals.push({ key: "weak_website", evidence: "Website has no HTTPS", weight: 0.6, source: "website" });
    else if (!hasOrdering && !hasBooking) result.signals.push({ key: "weak_website", evidence: "No online ordering or booking on the homepage", weight: 0.5, source: "website" });
    if (/(careers|we'?re hiring|join our team|open positions)/i.test(lower)) result.signals.push({ key: "hiring", evidence: "Careers link on homepage", weight: 0.6, source: "website" });
    if (/(delivery|takeaway|take-away|take away)/i.test(lower)) result.signals.push({ key: "takeaway_delivery", evidence: "Mentions delivery/takeaway", weight: 0.6, source: "website" });
    if (/(our (outlets|locations|stores|branches))/i.test(lower)) result.signals.push({ key: "multiple_locations", evidence: "Lists multiple locations", weight: 0.6, source: "website" });
    if (Object.keys(result.socialProfiles).length === 0) result.signals.push({ key: "no_social_presence", evidence: "No social links on website", weight: 0.6, source: "website" });
    else result.signals.push({ key: "active_social", evidence: `Links to ${Object.keys(result.socialProfiles).join(", ")}`, weight: 0.5, source: "website" });
    return result;
  }
}
