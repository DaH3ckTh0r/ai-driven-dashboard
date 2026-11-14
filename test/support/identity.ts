import type { IdentityProvider, SessionRepository } from "../../src/application/ports.js";
import type { Session } from "../../src/domain/session.js";

/** Stands in for Microsoft Entra: any code is accepted and the user is whoever `user` says. */
export class FakeIdentity implements IdentityProvider {
  user = "hector@contoso.com";
  lastNonce?: string;
  async authorizationUrl(p: { state: string; nonce: string; codeVerifier: string; redirectUri: string }): Promise<string> {
    return `https://login.test/authorize?state=${encodeURIComponent(p.state)}&nonce=${encodeURIComponent(p.nonce)}`;
  }
  async exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ idToken: string }> {
    return { idToken: `${p.code}|${p.codeVerifier}` };
  }
  async verifyIdToken(_idToken: string, nonce: string): Promise<{ user: string }> {
    this.lastNonce = nonce;
    return { user: this.user };
  }
}

export class MemorySessions implements SessionRepository {
  private readonly rows = new Map<string, Session>();
  insert(session: Session): void {
    this.rows.set(session.id, session);
  }
  get(id: string): Session | undefined {
    return this.rows.get(id);
  }
  delete(id: string): void {
    this.rows.delete(id);
  }
  touch(id: string, lastSeenAt: string): void {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastSeenAt });
  }
}

export class MemoryAudit {
  readonly entries: { actor: string; event: string; subject: string }[] = [];
  append(entry: { at: string; actor: string; event: string; subject: string; detail: unknown }): void {
    this.entries.push({ actor: entry.actor, event: entry.event, subject: entry.subject });
  }
  list(): never[] {
    return [];
  }
}
