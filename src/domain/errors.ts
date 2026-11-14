export type DomainErrorCode = "not-found" | "invalid-state" | "expired" | "bad-input" | "conflict" | "unavailable" | "forbidden";

/** A rule of the monitoring domain was broken. The HTTP layer maps codes to status codes. */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: DomainErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DomainError";
  }
}
