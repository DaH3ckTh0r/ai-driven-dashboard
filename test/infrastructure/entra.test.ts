import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { EntraIdentityProvider } from "../../src/infrastructure/auth/entra.js";
import { DomainError } from "../../src/domain/errors.js";

const AUTHORITY = "https://login.example.test/tenant-1";
const CLIENT_ID = "app-client-id";

async function fixture(overrides: { fetch?: typeof fetch } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keySet = createLocalJWKSet({ keys: [jwk] });
  const posted: { url: string; body: string }[] = [];
  const fakeFetch: typeof fetch =
    overrides.fetch ??
    (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          issuer: `${AUTHORITY}/v2.0`,
          authorization_endpoint: `${AUTHORITY}/oauth2/v2.0/authorize`,
          token_endpoint: `${AUTHORITY}/oauth2/v2.0/token`,
          jwks_uri: `${AUTHORITY}/discovery/v2.0/keys`,
        });
      }
      posted.push({ url, body: String(init?.body ?? "") });
      return Response.json({ id_token: "signed-by-test" });
    });
  const provider = new EntraIdentityProvider({ authority: AUTHORITY, clientId: CLIENT_ID, fetch: fakeFetch, keySet });
  const sign = (claims: Record<string, unknown>, opts: { aud?: string; exp?: string } = {}) =>
    new SignJWT({ nonce: "n-1", preferred_username: "hector@contoso.com", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`${AUTHORITY}/v2.0`)
      .setAudience(opts.aud ?? CLIENT_ID)
      .setSubject("subject-1")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "10m")
      .sign(privateKey);
  return { provider, sign, posted };
}

describe("Entra identity provider", () => {
  test("the authorization URL asks for a PKCE code with the state and nonce", async () => {
    const { provider } = await fixture();
    const url = new URL(
      await provider.authorizationUrl({ state: "s-1", nonce: "n-1", codeVerifier: "v-1", redirectUri: "http://localhost:47831/auth/callback" }),
    );
    assert.equal(url.origin + url.pathname, `${AUTHORITY}/oauth2/v2.0/authorize`);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"));
    assert.equal(url.searchParams.get("state"), "s-1");
    assert.equal(url.searchParams.get("nonce"), "n-1");
  });

  test("the code exchange sends the verifier and the same redirect URI", async () => {
    const { provider, posted } = await fixture();
    const result = await provider.exchangeCode({ code: "code-9", codeVerifier: "v-9", redirectUri: "http://localhost:47831/auth/callback" });
    assert.equal(result.idToken, "signed-by-test");
    const body = new URLSearchParams(posted[0].body);
    assert.equal(body.get("code_verifier"), "v-9");
    assert.equal(body.get("code"), "code-9");
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("redirect_uri"), "http://localhost:47831/auth/callback");
  });

  test("a valid token yields the user's sign-in name", async () => {
    const { provider, sign } = await fixture();
    assert.deepEqual(await provider.verifyIdToken(await sign({}), "n-1"), { user: "hector@contoso.com" });
  });

  test("a token for another application is rejected", async () => {
    const { provider, sign } = await fixture();
    await assert.rejects(provider.verifyIdToken(await sign({}, { aud: "someone-else" }), "n-1"));
  });

  test("a token with a different nonce is rejected (replay protection)", async () => {
    const { provider, sign } = await fixture();
    await assert.rejects(provider.verifyIdToken(await sign({}), "other-nonce"), /nonce/);
  });

  test("an expired token is rejected", async () => {
    const { provider, sign } = await fixture();
    await assert.rejects(provider.verifyIdToken(await sign({}, { exp: "-1m" }), "n-1"));
  });

  test("an unreachable identity provider is reported as unavailable, not as a crash", async () => {
    const down: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const { provider } = await fixture({ fetch: down });
    await assert.rejects(
      provider.authorizationUrl({ state: "s", nonce: "n", codeVerifier: "v", redirectUri: "http://localhost/auth/callback" }),
      (e: unknown) => e instanceof DomainError && e.code === "unavailable",
    );
  });

  test("a failed token exchange does not expose the provider's error text", async () => {
    const failing: typeof fetch = async (input) =>
      String(input).endsWith("openid-configuration")
        ? Response.json({
            issuer: `${AUTHORITY}/v2.0`,
            authorization_endpoint: `${AUTHORITY}/a`,
            token_endpoint: `${AUTHORITY}/t`,
            jwks_uri: `${AUTHORITY}/k`,
          })
        : new Response(JSON.stringify({ error: "invalid_grant", error_description: "AADSTS70008 secret detail" }), { status: 400 });
    const { provider } = await fixture({ fetch: failing });
    await assert.rejects(
      provider.exchangeCode({ code: "x", codeVerifier: "v", redirectUri: "http://localhost/auth/callback" }),
      (e: Error) => !/AADSTS/.test(e.message),
    );
  });
});
