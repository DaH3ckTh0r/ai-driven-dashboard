import { DomainError } from "../domain/errors.js";
import { isSessionActive, SESSION_ABSOLUTE_MS, type Session } from "../domain/session.js";
import type { AuditLog, Clock, IdentityProvider, SessionRepository } from "./ports.js";

const PENDING_TTL_MS = 10 * 60_000;

export interface SignInDeps {
  identity: IdentityProvider;
  sessions: SessionRepository;
  audit: AuditLog;
  clock: Clock;
  /** Unguessable random values for state, nonce, PKCE verifier and session cookies. */
  newToken: () => string;
  /** One-way digest (for example SHA-256). Only digests of session cookies are stored. */
  digest: (value: string) => string;
  redirectUri: string;
}

interface PendingSignIn {
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

/**
 * Signs users in with their Microsoft account and tracks their sessions.
 * Callers check currentUser() first, so a user with a live session is never asked to sign in again.
 */
export class SignIn {
  private readonly pending = new Map<string, PendingSignIn>();

  constructor(private readonly deps: SignInDeps) {}

  /** Starts a sign-in and returns the Microsoft page to send the visitor to. */
  async begin(): Promise<string> {
    this.prunePending();
    const state = this.deps.newToken();
    const nonce = this.deps.newToken();
    const codeVerifier = this.deps.newToken();
    this.pending.set(state, { nonce, codeVerifier, expiresAt: this.now() + PENDING_TTL_MS });
    return this.deps.identity.authorizationUrl({ state, nonce, codeVerifier, redirectUri: this.deps.redirectUri });
  }

  /**
   * Completes a sign-in. Each state is accepted once, so a replayed response is refused.
   * Returns the session; `id` is the value to put in the cookie.
   */
  async complete(response: { code: string; state: string }): Promise<Session> {
    try {
      const request = this.pending.get(response.state);
      this.pending.delete(response.state);
      if (!request || request.expiresAt <= this.now()) {
        throw new DomainError("sign-in expired or not recognised; try again", "bad-input");
      }
      const { idToken } = await this.deps.identity.exchangeCode({
        code: response.code,
        codeVerifier: request.codeVerifier,
        redirectUri: this.deps.redirectUri,
      });
      const { user } = await this.deps.identity.verifyIdToken(idToken, request.nonce);
      const cookieValue = this.deps.newToken();
      const now = this.now();
      const session: Session = {
        id: this.deps.digest(cookieValue),
        user,
        expiresAt: new Date(now + SESSION_ABSOLUTE_MS).toISOString(),
        lastSeenAt: new Date(now).toISOString(),
      };
      this.deps.sessions.insert(session);
      this.record("auth.signed-in", user, user);
      return { ...session, id: cookieValue };
    } catch (err) {
      this.record("auth.refused", "anonymous", "sign-in");
      throw err;
    }
  }

  /** The signed-in user for a cookie value, or null. Each valid use counts as activity. */
  currentUser(cookieValue: string | undefined): string | null {
    if (!cookieValue) return null;
    const key = this.deps.digest(cookieValue);
    const session = this.deps.sessions.get(key);
    if (!session) return null;
    const at = this.deps.clock.now();
    if (!isSessionActive(session, at)) {
      this.deps.sessions.delete(key);
      return null;
    }
    this.deps.sessions.touch(key, at.toISOString());
    return session.user;
  }

  end(cookieValue: string | undefined): void {
    if (!cookieValue) return;
    const key = this.deps.digest(cookieValue);
    const session = this.deps.sessions.get(key);
    if (!session) return;
    this.deps.sessions.delete(key);
    this.record("auth.signed-out", session.user, session.user);
  }

  private record(event: string, actor: string, subject: string): void {
    this.deps.audit.append({ at: this.deps.clock.now().toISOString(), actor, event, subject, detail: {} });
  }

  private now(): number {
    return this.deps.clock.now().getTime();
  }

  private prunePending(): void {
    for (const [state, request] of this.pending) {
      if (request.expiresAt <= this.now()) this.pending.delete(state);
    }
  }
}
