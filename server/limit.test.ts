import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { clientKey, relayLimit } from "./limit.ts";

interface Answer {
  status: number;
  body: { code: string; retry_after_millis: number } | null;
}

function call(handler: ReturnType<typeof relayLimit>, ip: string): { answer: Answer; passed: boolean; response: EventEmitter } {
  const answer: Answer = { status: 200, body: null };
  const response = Object.assign(new EventEmitter(), {
    set: () => response,
    status: (status: number) => {
      answer.status = status;
      return response;
    },
    json: (body: Answer["body"]) => {
      answer.body = body;
      return response;
    },
  });
  let passed = false;
  handler({ ip } as Request, response as unknown as Response, (() => {
    passed = true;
  }) as NextFunction);
  return { answer, passed, response };
}

test("a client gets its burst, then waits for the refill", () => {
  let clock = 0;
  const limit = relayLimit(600, () => clock);
  const finished = (ip: string) => {
    const result = call(limit, ip);
    result.response.emit("finish");
    return result;
  };
  for (let index = 0; index < 120; index += 1) {
    assert.equal(finished("203.0.113.7").passed, true);
  }
  const refused = finished("203.0.113.7");
  assert.equal(refused.passed, false);
  assert.equal(refused.answer.status, 429);
  assert.equal(refused.answer.body?.code, "rate_limited");
  assert.equal(finished("203.0.113.8").passed, true, "another client has its own budget");
  clock += 100;
  assert.equal(finished("203.0.113.7").passed, true, "ten requests a second come back");
});

test("requests in flight are capped until they finish", () => {
  const limit = relayLimit(0);
  const open = Array.from({ length: 128 }, (_, index) => call(limit, `198.51.100.${index}`));
  assert.ok(open.every((result) => result.passed));
  const busy = call(limit, "198.51.100.200");
  assert.equal(busy.answer.status, 503);
  assert.equal(busy.answer.body?.code, "unavailable");
  open[0]?.response.emit("finish");
  open[0]?.response.emit("close");
  assert.equal(call(limit, "198.51.100.201").passed, true, "a finished request frees exactly one place");
  assert.equal(call(limit, "198.51.100.202").passed, false);
});

test("IPv6 clients share one budget per /64", () => {
  assert.equal(clientKey("2001:db8:1:2::9"), "2001:db8:1:2::/64");
  assert.equal(clientKey("2001:0db8:0001:0002:ffff:0:0:1"), "2001:db8:1:2::/64");
  assert.equal(clientKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(clientKey("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(clientKey("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(clientKey("203.0.113.7"), "203.0.113.7");
});
