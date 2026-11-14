import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SignIn } from "../../src/application/sign-in.js";
import { FakeClock } from "../support/harness.js";
import { FakeIdentity, MemoryAudit, MemorySessions } from "../support/identity.js";
import { DomainError } from "../../src/domain/errors.js";

function setup() {
  const identity = new FakeIdentity();
  const sessions = new MemorySessions();
  const clock = new FakeClock();
  const audit = new MemoryAudit();
  let n = 0;
  const signIn = new SignIn({
    identity,
    sessions,
    audit,
    clock,
    newToken: () => `tok-${++n}`,
    digest: (value) => `h:${value}`,
    redirectUri: "http://localhost:47831/auth/callback",
  });
  return { identity, sessions, clock, signIn, audit };
}

function stateFrom(url: string): string {
  return new URL(url).searchParams.get("state")!;
}

describe("the existing session is checked before anyone is asked to sign in", () => {
  test("no cookie means nobody is signed in", () => {
    assert.equal(setup().signIn.currentUser(undefined), null);
  });

  test("a live session identifies the user without a new sign-in", async () => {
    const { signIn, identity } = setup();
    const url = await signIn.begin();
    const session = await signIn.complete({ code: "c", state: stateFrom(url) });
    assert.equal(signIn.currentUser(session.id), identity.user);
  });

  test("an expired session is removed and the user must sign in again", async () => {
    const { signIn, sessions, clock } = setup();
    const session = await signIn.complete({ code: "c", state: stateFrom(await signIn.begin()) });
    clock.advance(13 * 3_600_000);
    assert.equal(signIn.currentUser(session.id), null);
    assert.equal(sessions.get(session.id), undefined);
  });

  test("an unknown session id is treated as no session", () => {
    assert.equal(setup().signIn.currentUser("forged"), null);
  });
});

describe("session storage and lifetime", () => {
  test("the cookie value is not the stored key: only a digest is kept", async () => {
    const { signIn, sessions } = setup();
    const session = await signIn.complete({ code: "c", state: stateFrom(await signIn.begin()) });
    assert.equal(sessions.get(session.id), undefined);
    assert.ok(sessions.get(`h:${session.id}`));
  });

  test("a session ends after 30 minutes without activity", async () => {
    const { signIn, clock } = setup();
    const session = await signIn.complete({ code: "c", state: stateFrom(await signIn.begin()) });
    clock.advance(31 * 60_000);
    assert.equal(signIn.currentUser(session.id), null);
  });

  test("activity keeps the session alive until the 12-hour limit", async () => {
    const { signIn, clock } = setup();
    const session = await signIn.complete({ code: "c", state: stateFrom(await signIn.begin()) });
    for (let i = 0; i < 35; i++) {
      clock.advance(20 * 60_000);
      assert.equal(signIn.currentUser(session.id), "hector@contoso.com");
    }
    clock.advance(20 * 60_000); // 12 hours from sign-in
    assert.equal(signIn.currentUser(session.id), null);
  });
});

describe("sign-in audit trail", () => {
  test("successful sign-in, refusal and sign-out are all recorded", async () => {
    const { signIn, audit } = setup();
    const session = await signIn.complete({ code: "c", state: stateFrom(await signIn.begin()) });
    await assert.rejects(signIn.complete({ code: "c", state: "forged" }));
    signIn.end(session.id);
    assert.deepEqual(audit.entries.map((e) => e.event), ["auth.signed-in", "auth.refused", "auth.signed-out"]);
    assert.equal(audit.entries[0].actor, "hector@contoso.com");
    assert.equal(audit.entries[1].actor, "anonymous");
  });
});

describe("sign-in", () => {
  test("starting sign-in returns the Microsoft authorization URL with state", async () => {
    const url = await setup().signIn.begin();
    assert.match(url, /^https:\/\/login\.test\/authorize\?state=tok-1/);
  });

  test("completing sign-in records the verified user and the nonce that was sent", async () => {
    const { signIn, identity } = setup();
    const session = await signIn.complete({ code: "c", state: stateFrom(await signIn.begin()) });
    assert.equal(session.user, "hector@contoso.com");
    assert.equal(identity.lastNonce, "tok-2");
  });

  test("a state can be used only once", async () => {
    const { signIn } = setup();
    const state = stateFrom(await signIn.begin());
    await signIn.complete({ code: "c", state });
    await assert.rejects(signIn.complete({ code: "c", state }), (e: unknown) => e instanceof DomainError && e.code === "bad-input");
  });

  test("an unknown state is refused", async () => {
    await assert.rejects(setup().signIn.complete({ code: "c", state: "forged" }), DomainError);
  });

  test("a pending sign-in expires after ten minutes", async () => {
    const { signIn, clock } = setup();
    const state = stateFrom(await signIn.begin());
    clock.advance(11 * 60_000);
    await assert.rejects(signIn.complete({ code: "c", state }), DomainError);
  });

  test("signing out ends the session", async () => {
    const { signIn } = setup();
    const session = await signIn.complete({ code: "c", state: stateFrom(await signIn.begin()) });
    signIn.end(session.id);
    assert.equal(signIn.currentUser(session.id), null);
  });
});
