import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, URL-safe. Used for state, nonce, PKCE verifiers and session ids. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The S256 PKCE challenge for a verifier (RFC 7636). */
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
