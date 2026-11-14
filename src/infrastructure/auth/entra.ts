import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { IdentityProvider } from "../../application/ports.js";
import { DomainError } from "../../domain/errors.js";
import { challengeFor } from "./pkce.js";

export interface EntraOptions {
  /** Tenant id or domain. Ignored when `authority` is given. */
  tenantId?: string;
  authority?: string;
  clientId: string;
  /** Optional: a confidential client. Desktop apps are public clients and use PKCE alone. */
  clientSecret?: string;
  fetch?: typeof fetch;
  keySet?: JWTVerifyGetKey;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const GENERIC_FAILURE = "Microsoft sign-in could not be completed; try again";

/** OpenID Connect with Microsoft Entra ID: authorization code flow with PKCE. */
export class EntraIdentityProvider implements IdentityProvider {
  private discovery?: Promise<Discovery>;
  private keys?: JWTVerifyGetKey;
  private readonly authority: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: EntraOptions) {
    this.authority = (options.authority ?? `https://login.microsoftonline.com/${options.tenantId}`).replace(/\/$/, "");
    this.fetchFn = options.fetch ?? fetch;
    this.keys = options.keySet;
  }

  async authorizationUrl(request: { state: string; nonce: string; codeVerifier: string; redirectUri: string }): Promise<string> {
    const config = await this.config();
    const url = new URL(config.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      response_type: "code",
      redirect_uri: request.redirectUri,
      response_mode: "query",
      scope: "openid profile email",
      state: request.state,
      nonce: request.nonce,
      code_challenge: challengeFor(request.codeVerifier),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  async exchangeCode(request: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ idToken: string }> {
    const config = await this.config();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.options.clientId,
      code: request.code,
      redirect_uri: request.redirectUri,
      code_verifier: request.codeVerifier,
    });
    if (this.options.clientSecret) body.set("client_secret", this.options.clientSecret);
    const res = await this.fetchFn(config.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as { id_token?: string };
    // The provider's error text is not passed on: it can reveal tenant details.
    if (!res.ok || !data.id_token) throw new DomainError(GENERIC_FAILURE, "bad-input");
    return { idToken: data.id_token };
  }

  async verifyIdToken(idToken: string, nonce: string): Promise<{ user: string }> {
    const config = await this.config();
    this.keys ??= createRemoteJWKSet(new URL(config.jwks_uri));
    const { payload } = await jwtVerify(idToken, this.keys, { issuer: config.issuer, audience: this.options.clientId });
    if (payload.nonce !== nonce) throw new DomainError("sign-in nonce did not match this request; try again", "bad-input");
    const claims = [payload.preferred_username, payload.upn, payload.email, payload.sub];
    const user = claims.find((value): value is string => typeof value === "string" && value.length > 0);
    if (!user) throw new DomainError(GENERIC_FAILURE, "bad-input");
    return { user };
  }

  private config(): Promise<Discovery> {
    this.discovery ??= this.fetchFn(`${this.authority}/v2.0/.well-known/openid-configuration`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`OpenID discovery failed (${res.status})`);
        return (await res.json()) as Discovery;
      })
      .catch((err: unknown) => {
        this.discovery = undefined;
        throw new DomainError("Microsoft sign-in is unavailable right now; try again shortly", "unavailable", { cause: err });
      });
    return this.discovery;
  }
}
