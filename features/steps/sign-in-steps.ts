import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { SignIn } from "../../src/application/sign-in.js";
import { DomainError } from "../../src/domain/errors.js";
import { FakeIdentity } from "../../test/support/identity.js";
import type { MonitorWorld } from "./steps.js";

interface SignInWorld extends MonitorWorld {
  identity: FakeIdentity;
  signIn: SignIn;
  pendingState?: string;
  signedIn?: string;
  sessionId?: string;
  authUrl?: string;
  refusal?: string;
}

let counter = 0;
function ensureSignIn(world: SignInWorld): void {
  if (world.signIn) return;
  world.identity = new FakeIdentity();
  world.signIn = new SignIn({
    identity: world.identity,
    sessions: world.h.persistence.sessions,
    clock: world.h.clock,
    newToken: () => `state-${++counter}`,
    audit: world.h.persistence.audit,
    digest: (value) => `h:${value}`,
    redirectUri: "http://localhost:47831/auth/callback",
  });
}

async function completeSignIn(world: SignInWorld, user: string): Promise<void> {
  ensureSignIn(world);
  world.identity.user = user;
  world.authUrl = await world.signIn.begin();
  world.pendingState = new URL(world.authUrl).searchParams.get("state")!;
  const session = await world.signIn.complete({ code: "code-1", state: world.pendingState });
  world.sessionId = session.id;
}

Given("{string} signed in {int} hour(s) ago", async function (this: SignInWorld, user: string, hours: number) {
  await completeSignIn(this, user);
  this.h.clock.advance(hours * 3_600_000);
});

Given("{string} signed in {int} minute(s) ago", async function (this: SignInWorld, user: string, minutes: number) {
  await completeSignIn(this, user);
  this.h.clock.advance(minutes * 60_000);
});

When("the app checks for a session", function (this: SignInWorld) {
  ensureSignIn(this);
  this.signedIn = this.signIn.currentUser(this.sessionId) ?? undefined;
});

Then("the signed-in user is {string}", function (this: SignInWorld, user: string) {
  assert.equal(this.signedIn, user);
});

Then("nobody is signed in", function (this: SignInWorld) {
  assert.equal(this.signedIn, undefined);
});

When("the visitor starts sign-in", async function (this: SignInWorld) {
  ensureSignIn(this);
  this.authUrl = await this.signIn.begin();
  this.pendingState = new URL(this.authUrl).searchParams.get("state")!;
});

Then("the visitor is sent to the Microsoft sign-in page", function (this: SignInWorld) {
  assert.match(this.authUrl ?? "", /^https:\/\/login\.test\/authorize\?/);
});

When("Microsoft confirms the sign-in of {string}", async function (this: SignInWorld, user: string) {
  this.identity.user = user;
  this.sessionId = (await this.signIn.complete({ code: "code-1", state: this.pendingState! })).id;
});

When("Microsoft returns a sign-in response with state {string}", async function (this: SignInWorld, state: string) {
  ensureSignIn(this);
  try {
    await this.signIn.complete({ code: "code-1", state });
  } catch (err) {
    this.refusal = err instanceof DomainError ? err.code : "other";
  }
});

Then("the sign-in is refused", function (this: SignInWorld) {
  assert.equal(this.refusal, "bad-input");
});
