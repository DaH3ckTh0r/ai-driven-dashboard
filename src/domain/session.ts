/** A stored session. `id` is the digest of the cookie value: the raw cookie is never stored. */
export interface Session {
  id: string;
  user: string;
  expiresAt: string;
  lastSeenAt: string;
}

/** Absolute lifetime of a session, from sign-in. */
export const SESSION_ABSOLUTE_MS = 12 * 3_600_000;
/** A session that is not used for this long must sign in again (OWASP ASVS session timeouts). */
export const SESSION_IDLE_MS = 30 * 60_000;

export function isSessionActive(session: Pick<Session, "expiresAt" | "lastSeenAt">, at: Date): boolean {
  const now = at.getTime();
  return now < new Date(session.expiresAt).getTime() && now - new Date(session.lastSeenAt).getTime() < SESSION_IDLE_MS;
}
