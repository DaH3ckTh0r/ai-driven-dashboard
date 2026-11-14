import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadSettings, SettingsError } from "../../src/main/settings.js";

const BASE = { APIM_CHAT_URL: "https://apim.example.com/chat", AUTH_MODE: "easy-auth", APPROVERS: "hector@contoso.com" };

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    loadSettings(env);
  } catch (err) {
    if (err instanceof SettingsError) return err.problems;
    throw err;
  }
  return [];
}

describe("loadSettings", () => {
  test("defaults listen locally on 8080 and use Easy Auth", () => {
    const s = loadSettings({ APIM_CHAT_URL: BASE.APIM_CHAT_URL, APPROVERS: BASE.APPROVERS });
    assert.equal(s.host, "127.0.0.1");
    assert.equal(s.port, 8080);
    assert.deepEqual(s.auth, { kind: "easy-auth" });
    assert.equal(s.apimChatUrl, BASE.APIM_CHAT_URL);
  });

  test("local mode names the signed-in user from LOCAL_USER", () => {
    const s = loadSettings({ ...BASE, AUTH_MODE: "local", LOCAL_USER: "hector" });
    assert.deepEqual(s.auth, { kind: "local", user: "hector" });
  });

  test("local mode without a user is refused rather than signing everyone in", () => {
    assert.ok(problemsOf({ ...BASE, AUTH_MODE: "local" }).some((p) => p.includes("LOCAL_USER")));
    assert.ok(problemsOf({ ...BASE, AUTH_MODE: "local", LOCAL_USER: "   " }).some((p) => p.includes("LOCAL_USER")));
  });

  test("an unknown auth mode is reported", () => {
    assert.ok(problemsOf({ ...BASE, AUTH_MODE: "anonymous" }).some((p) => p.includes("AUTH_MODE")));
  });

  test("the APIM endpoint is required", () => {
    assert.ok(problemsOf({ AUTH_MODE: "easy-auth" }).some((p) => p.includes("APIM_CHAT_URL")));
  });

  test("the port must be a whole number from 1 to 65535", () => {
    assert.equal(loadSettings({ ...BASE, PORT: "9000" }).port, 9000);
    assert.ok(problemsOf({ ...BASE, PORT: "0" }).some((p) => p.includes("PORT")));
    assert.ok(problemsOf({ ...BASE, PORT: "http" }).some((p) => p.includes("PORT")));
  });

  test("the server stops when its parent closes stdin, so a quit desktop app leaves no server running", () => {
    assert.equal(loadSettings(BASE).stopWhenStdinCloses, false);
    assert.equal(loadSettings({ ...BASE, EXIT_WITH_PARENT: "1" }).stopWhenStdinCloses, true);
  });

  test("entra mode needs the tenant, the app registration and the public address", () => {
    const entra = { ...BASE, AUTH_MODE: "entra", ENTRA_TENANT_ID: "tid", ENTRA_CLIENT_ID: "cid", PUBLIC_BASE_URL: "http://localhost:47831" };
    const s = loadSettings(entra);
    assert.deepEqual(s.auth, { kind: "entra", tenantId: "tid", clientId: "cid", clientSecret: undefined, authority: undefined, publicBaseUrl: "http://localhost:47831" });
    assert.ok(problemsOf({ ...entra, ENTRA_TENANT_ID: "" }).some((p) => p.includes("ENTRA_TENANT_ID")));
    assert.ok(problemsOf({ ...entra, ENTRA_CLIENT_ID: "" }).some((p) => p.includes("ENTRA_CLIENT_ID")));
    assert.ok(problemsOf({ ...entra, PUBLIC_BASE_URL: "" }).some((p) => p.includes("PUBLIC_BASE_URL")));
  });

  test("a custom authority (sovereign cloud or test tenant) can be given", () => {
    const s = loadSettings({ ...BASE, AUTH_MODE: "entra", ENTRA_TENANT_ID: "tid", ENTRA_CLIENT_ID: "cid", PUBLIC_BASE_URL: "http://localhost:1", ENTRA_AUTHORITY: "https://login.example.cn/tid/" });
    assert.equal(s.auth.kind === "entra" && s.auth.authority, "https://login.example.cn/tid/");
  });

  test("approvers are required, so that nobody is allowed to approve by default", () => {
    assert.ok(problemsOf({ APIM_CHAT_URL: BASE.APIM_CHAT_URL }).some((p) => p.includes("APPROVERS")));
    assert.deepEqual(loadSettings(BASE).approvers, ["hector@contoso.com"]);
  });

  test("local mode approves as the local user when no list is given", () => {
    assert.deepEqual(loadSettings({ ...BASE, AUTH_MODE: "local", LOCAL_USER: "hector", APPROVERS: "" }).approvers, ["hector"]);
  });

  test("every problem is reported together", () => {
    const problems = problemsOf({ AUTH_MODE: "bogus", PORT: "x", APPROVERS: BASE.APPROVERS });
    assert.equal(problems.length, 3);
  });
});
