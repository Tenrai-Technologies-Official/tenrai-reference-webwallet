import { isIPv6 } from "node:net";
import type { Response, RequestHandler } from "express";

const MAX_CLIENTS = 65_536;
const MAX_IN_FLIGHT = 128;

interface Bucket {
  tokens: number;
  at: number;
}

/** Per-client rate and a cap on requests in flight; `perMinute` 0 keeps only the cap. */
export function relayLimit(perMinute: number, now: () => number = Date.now): RequestHandler {
  const burst = Math.max(20, Math.floor(perMinute / 5));
  const perMilli = perMinute / 60_000;
  const refill = perMinute > 0 ? burst / perMilli : 0;
  const clients = new Map<string, Bucket>();
  let inFlight = 0;

  function allow(client: string, at: number): boolean {
    let bucket = clients.get(client);
    if (!bucket) {
      if (clients.size >= MAX_CLIENTS) {
        // Drop refilled buckets; if all are busy, clear the table rather than refuse.
        for (const [key, entry] of clients) {
          if (at - entry.at >= refill) {
            clients.delete(key);
          }
        }
        if (clients.size >= MAX_CLIENTS) {
          clients.clear();
        }
      }
      bucket = { tokens: burst, at };
      clients.set(client, bucket);
    }
    bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, at - bucket.at) * perMilli);
    bucket.at = Math.max(bucket.at, at);
    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }

  return (req, res, next) => {
    if (perMinute > 0 && !allow(clientKey(req.ip ?? ""), now())) {
      refuse(res, 429, "rate_limited", "too many requests, try again shortly", 10_000);
      return;
    }
    if (inFlight >= MAX_IN_FLIGHT) {
      refuse(res, 503, "unavailable", "the wallet server is busy, try again shortly", 1_000);
      return;
    }
    inFlight += 1;
    let open = true;
    const release = () => {
      if (open) {
        open = false;
        inFlight -= 1;
      }
    };
    res.on("finish", release);
    res.on("close", release);
    next();
  };
}

/** IPv4 addresses count alone, IPv6 per /64. */
export function clientKey(address: string): string {
  const plain = address.startsWith("::ffff:") && address.includes(".") ? address.slice(7) : address.split("%")[0] ?? "";
  if (!isIPv6(plain)) {
    return plain;
  }
  const [head = "", tail = ""] = plain.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const width = (groups: string[]) => groups.reduce((sum, group) => sum + (group.includes(".") ? 2 : 1), 0);
  const groups = plain.includes("::") ? [...left, ...Array<string>(8 - width(left) - width(right)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((group) => group.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

function refuse(res: Response, status: number, code: string, message: string, retry: number): void {
  res.set("retry-after", String(Math.ceil(retry / 1000)));
  res.status(status).json({ api_version: 1, code, message, retry_after_millis: retry });
}
