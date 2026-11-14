import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { SignIn } from "../../src/application/sign-in.js";
import { createHttpServer } from "../../src/http/server.js";
import { buildAuthRoutes, identifyFromSession, SESSION_COOKIE } from "../../src/http/auth-routes.js";
import { buildRoutes } from "../../src/http/routes.js";
import { Approvers } from "../../src/domain/approvers.js";
import { FakeClock, SequentialIds } from "../support/harness.js";
import { FakeIdentity, MemorySessions } from "../support/identity.js";
import { buildHarness, type Harness } from "../support/harness.js";

let server: Server | undefined;
let h: Harness | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  h?.close();
  h = undefined;
});

async function start(): Promise<{ base: string; identity: FakeIdentity }> {
  h = await buildHarness();
  const identity = new FakeIdentity();
  let n = 0;
  const signIn = new SignIn({
    identity,
    sessions: h.persistence.sessions,
    clock: new FakeClock(),
    newToken: () => `tok-${++n}`,
    audit: h.persistence.audit,
    digest: (value) => `h:${value}`,
    redirectUri: "http://localhost/auth/callback",
  });
  server = createHttpServer({
    routes: buildRoutes({ reads: h.app.reads, approvals: h.app.approvals, monitoring: h.app.monitoring, groups: h.app.groups, approvers: new Approvers(["hector"]) }),
    identify: identifyFromSession(signIn),
    publicRoutes: buildAuthRoutes(signIn, { secureCookies: false }),
    site: { fallbackHtml: "<shell>" },
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  return { base: `http://127.0.0.1:${(server!.address() as { port: number }).port}`, identity };
}

describe("sign-in over HTTP", () => {
  test("the API refuses a visitor who has no session", async () => {
    const { base } = await start();
    assert.equal((await fetch(`${base}/api/whoami`, { redirect: "manual" })).status, 401);
  });

  test("login redirects to Microsoft with a fresh state", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/auth/login`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location") ?? "", /^https:\/\/login\.test\/authorize\?state=tok-1/);
  });

  test("a successful callback sets an HttpOnly session cookie that identifies the user", async () => {
    const { base } = await start();
    await fetch(`${base}/auth/login`, { redirect: "manual" });
    const res = await fetch(`${base}/auth/callback?code=code-1&state=tok-1`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
    const cookie = res.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const value = cookie.split(";")[0];
    const who = await fetch(`${base}/api/whoami`, { headers: { cookie: value } });
    assert.deepEqual(await who.json(), { user: "hector@contoso.com", approver: false });
  });

  test("a callback with a state that was never issued is refused", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/auth/callback?code=code-1&state=forged`, { redirect: "manual" });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  test("signing out clears the session on the server and in the browser", async () => {
    const { base } = await start();
    await fetch(`${base}/auth/login`, { redirect: "manual" });
    const login = await fetch(`${base}/auth/callback?code=code-1&state=tok-1`, { redirect: "manual" });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const out = await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie }, redirect: "manual" });
    assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await fetch(`${base}/api/whoami`, { headers: { cookie } })).status, 401);
  });
});
