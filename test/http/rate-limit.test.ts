import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../../src/http/rate-limit.js";

describe("rate limiter", () => {
  test("allows the limit per window and then refuses", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    assert.deepEqual([limiter.hit("a"), limiter.hit("a"), limiter.hit("a"), limiter.hit("a")], [true, true, true, false]);
  });

  test("keys are counted separately", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    assert.equal(limiter.hit("10.0.0.1"), true);
    assert.equal(limiter.hit("10.0.0.2"), true);
  });

  test("the count resets when the window passes", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => now });
    limiter.hit("a");
    assert.equal(limiter.hit("a"), false);
    now = 60_000;
    assert.equal(limiter.hit("a"), true);
  });
});
