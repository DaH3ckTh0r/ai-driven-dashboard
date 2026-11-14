// End-to-end sign-in check against a fake OpenID Connect provider (no Microsoft account needed).
// It starts the built server, signs in, restarts the server to prove the session survives, then signs out.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const IDP_PORT = 19999;
const APP_PORT = 18090;
const TENANT = "tenant-1";
const CLIENT_ID = "client-1";
const IDP = `http://127.0.0.1:${IDP_PORT}/${TENANT}`;
const USER = "hector@contoso.com";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const codes = new Map();

const idp = createServer(async (req, res) => {
  const url = new URL(req.url, IDP);
  if (url.pathname === `/${TENANT}/v2.0/.well-known/openid-configuration`) {
    return json(res, {
      issuer: `${IDP}/v2.0`,
      authorization_endpoint: `${IDP}/authorize`,
      token_endpoint: `${IDP}/token`,
      jwks_uri: `${IDP}/keys`,
    });
  }
  if (url.pathname === `/${TENANT}/keys`) return json(res, { keys: [jwk] });
  if (url.pathname === `/${TENANT}/authorize`) {
    const code = `code-${codes.size + 1}`;
    codes.set(code, { nonce: url.searchParams.get("nonce"), challenge: url.searchParams.get("code_challenge") });
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", url.searchParams.get("state"));
    res.writeHead(302, { location: back.toString() }).end();
    return;
  }
  if (url.pathname === `/${TENANT}/token` && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    const grant = codes.get(form.get("code"));
    assert.ok(grant, "unknown code");
    const verifierChallenge = createHash("sha256").update(form.get("code_verifier")).digest("base64url");
    assert.equal(verifierChallenge, grant.challenge, "PKCE verifier must match the challenge");
    codes.delete(form.get("code"));
    const idToken = await new SignJWT({ nonce: grant.nonce, preferred_username: USER })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`${IDP}/v2.0`)
      .setAudience(CLIENT_ID)
      .setSubject("subject-1")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
    return json(res, { id_token: idToken });
  }
  res.writeHead(404).end();
});

function json(res, body) {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function startApp(dbPath) {
  const child = spawn(process.execPath, ["dist/main/serve.js", "examples/integrations"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      AUTH_MODE: "entra",
      APPROVERS: USER,
      ENTRA_TENANT_ID: TENANT,
      ENTRA_CLIENT_ID: CLIENT_ID,
      ENTRA_AUTHORITY: IDP,
      PUBLIC_BASE_URL: `http://localhost:${APP_PORT}`,
      HOST: "127.0.0.1",
      PORT: String(APP_PORT),
      DB_PATH: dbPath,
      APIM_CHAT_URL: "https://apim.example.test/chat",
      LA_WORKSPACE_ID: "ws-demo",
      SB_NAMESPACE: "bus-demo.servicebus.windows.net",
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  return new Promise((resolveReady, reject) => {
    child.on("exit", (code) => reject(new Error(`server exited during start-up (code ${code})`)));
    child.stdout.on("data", (d) => {
      if (String(d).includes("listening")) resolveReady(child);
    });
  });
}

async function signIn(jar) {
  // 1. The session check comes first: no cookie, so the API refuses.
  assert.equal((await fetch(`http://127.0.0.1:${APP_PORT}/api/whoami`)).status, 401);
  // 2. Login redirects to the identity provider.
  const login = await fetch(`http://127.0.0.1:${APP_PORT}/auth/login`, { redirect: "manual" });
  assert.equal(login.status, 302);
  // 3. The provider signs the user in and returns a code to the app.
  const authorize = await fetch(login.headers.get("location"), { redirect: "manual" });
  const callback = authorize.headers.get("location");
  // 4. The app exchanges the code and sets the session cookie.
  const done = await fetch(callback, { redirect: "manual" });
  assert.equal(done.status, 302);
  const cookie = done.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  jar.cookie = cookie.split(";")[0];
}

async function whoami(jar) {
  return fetch(`http://127.0.0.1:${APP_PORT}/api/whoami`, { headers: { cookie: jar.cookie ?? "" } });
}

idp.listen(IDP_PORT, "127.0.0.1");
const dbPath = resolve("/tmp", `entra-e2e-${Date.now()}.db`);
const jar = {};
let app = await startApp(dbPath);
try {
  await signIn(jar);
  assert.deepEqual(await (await whoami(jar)).json(), { user: USER, approver: true });
  console.log("ok: sign-in creates a session and the API identifies the user");

  app.kill();
  app = await startApp(dbPath);
  assert.deepEqual(await (await whoami(jar)).json(), { user: USER, approver: true });
  console.log("ok: the existing session survives a server restart (no second sign-in needed)");

  const out = await fetch(`http://127.0.0.1:${APP_PORT}/auth/logout`, { method: "POST", headers: { cookie: jar.cookie }, redirect: "manual" });
  assert.equal(out.status, 302);
  assert.equal((await whoami(jar)).status, 401);
  console.log("ok: sign-out ends the session on the server");
} finally {
  app.kill();
  idp.close();
}
