import type { IncomingMessage } from "node:http";
import { HttpError } from "./errors.js";

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Reads a JSON body. Requiring application/json also blocks cross-site form posts,
 * because browsers cannot send that content type without a CORS preflight.
 */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
}
