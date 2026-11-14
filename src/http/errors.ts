import { DomainError, type DomainErrorCode } from "../domain/errors.js";
import type { ErrorView } from "./contracts.js";
import { json, type Reply } from "./reply.js";

/** An error raised by the HTTP layer itself (bad content type, oversized body, ...). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  "not-found": 404,
  "bad-input": 400,
  "invalid-state": 409,
  expired: 409,
  conflict: 409,
  unavailable: 503,
  forbidden: 403,
};

/** Converts any thrown value to a reply. Unknown errors are logged and hidden from the client. */
export function toErrorReply(err: unknown): Reply {
  if (err instanceof HttpError) return json<ErrorView>(err.status, { error: err.message });
  if (err instanceof DomainError) {
    return json<ErrorView>(STATUS_BY_CODE[err.code], { error: err.message, code: err.code });
  }
  console.error("request failed:", err);
  return json<ErrorView>(500, { error: "internal error" });
}
