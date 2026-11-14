import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildHarness, proposeThenFinish, type Harness } from "../support/harness.js";
import { buildRoutes } from "../../src/http/routes.js";
import { Approvers } from "../../src/domain/approvers.js";
import { createHttpServer } from "../../src/http/server.js";
import { identifyFromEasyAuth, identifyLocal } from "../../src/http/identity.js";
import { serveSite } from "../../src/http/static.js";

const SHELL = "<!doctype html><title>shell</title>";
let h: Harness | undefined;
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  h?.close();
  h = undefined;
});

async function start(identify = identifyLocal("hector"), extra: { hsts?: boolean } = {}): Promise<string> {
  if (!h) throw new Error("harness not built");
  const server = createHttpServer({
    routes: buildRoutes({ reads: h.app.reads, approvals: h.app.approvals, monitoring: h.app.monitoring, groups: h.app.groups, approvers: new Approvers(["hector"]) }),
    identify,
    site: { fallbackHtml: SHELL },
    hsts: extra.hsts,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

const JSON_HEADERS = { "content-type": "application/json" };

describe("authentication and CSRF guard", () => {
  test("API calls without a signed-in user are refused", async () => {
    h = await buildHarness();
    const base = await start(() => null);
    assert.equal((await fetch(`${base}/api/integrations`)).status, 401);
  });

  test("writes must send a JSON content type", async () => {
    h = await buildHarness({ metrics: { total: 1, serverErrors: 80, healthy: 1 } });
    const base = await start();
    const res = await fetch(`${base}/api/approvals/x/approve`, { method: "POST", headers: { "content-type": "text/plain" }, body: "" });
    assert.equal(res.status, 415);
  });

  test("Easy Auth identity comes only from the header", () => {
    const identify = identifyFromEasyAuth();
    assert.equal(identify({ headers: {} } as never), null);
    assert.equal(identify({ headers: { "x-ms-client-principal-name": " hector " } } as never), "hector");
  });

  test("local identity is the named local user", () => {
    assert.equal(identifyLocal("hector")({ headers: {} } as never), "hector");
  });
});

describe("responses", () => {
  test("every API response carries the security headers", async () => {
    h = await buildHarness();
    const base = await start();
    const res = await fetch(`${base}/api/whoami`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  });

  test("responses carry the hardening headers, and HSTS only when served over https", async () => {
    h = await buildHarness();
    const base = await start();
    const res = await fetch(`${base}/api/whoami`);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(res.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.match(res.headers.get("permissions-policy") ?? "", /camera=\(\)/);
    assert.equal(res.headers.get("strict-transport-security"), null);
    const secure = await start(identifyLocal("hector"), { hsts: true });
    assert.match((await fetch(`${secure}/api/whoami`)).headers.get("strict-transport-security") ?? "", /max-age=31536000/);
  });

  test("connection details such as workspace and namespace never reach the browser", async () => {
    h = await buildHarness();
    const base = await start();
    const body = await (await fetch(`${base}/api/integrations`)).text();
    assert.ok(body.includes("orders-api"));
    assert.ok(!body.includes("ws-secret-123"));
    assert.ok(!body.includes("bus-secret.servicebus.windows.net"));
  });

  test("an approval can be approved over HTTP end to end", async () => {
    h = await buildHarness({ metrics: { total: 100, serverErrors: 80, healthy: 1 }, replies: proposeThenFinish() });
    await h.app.monitoring.tick("orders-api", "orders-5xx-spike");
    const [pending] = h.persistence.approvals.list({ status: "pending" });
    const base = await start();
    const res = await fetch(`${base}/api/approvals/${pending.id}/approve`, { method: "POST", headers: JSON_HEADERS, body: "{}" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "executed");
    assert.deepEqual(h.runner.ran, ["reprocess-dlq"]);
  });
});

describe("static site", () => {
  test("unknown client routes get the app shell", async () => {
    const reply = await serveSite({ fallbackHtml: SHELL }, "/issues/abc");
    assert.equal(reply.body, SHELL);
  });

  test("paths that escape the web folder never leave it", async () => {
    const reply = await serveSite({ fallbackHtml: SHELL }, "/../../package.json");
    assert.equal(reply.body, SHELL);
  });
});
