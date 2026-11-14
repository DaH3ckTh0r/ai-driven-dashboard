import { test } from "node:test";
import assert from "node:assert/strict";
import { challengeFor, newToken } from "../../src/infrastructure/auth/pkce.js";

test("the PKCE challenge matches the RFC 7636 example", () => {
  assert.equal(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("generated tokens are unguessable and URL-safe", () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
});
