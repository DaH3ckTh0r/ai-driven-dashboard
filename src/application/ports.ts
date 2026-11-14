import type { Session } from "../domain/session.js";
// Ports: the interfaces the application needs. Infrastructure implements them.
import type { ApprovalStatus, ApprovalRequest } from "../domain/approval.js";
import type { ActionDef, AuditEntry, Finding, FindingStatus, GroupDef, IntegrationDef, SignalDef, ThreadMessage } from "../domain/model.js";

export interface IntegrationRecord {
  integration: IntegrationDef;
  /** Folder the definition was loaded from. Action scripts resolve relative to it. */
  location: string;
}

export interface IntegrationCatalog {
  list(): IntegrationRecord[];
  find(integrationId: string): IntegrationRecord | undefined;
}

/** Groups kept in the database. The dashboard edits them; groups.yaml only seeds missing ones. */
export interface GroupRepository {
  list(): GroupDef[];
  get(id: string): GroupDef | undefined;
  insert(group: GroupDef): void;
  update(group: GroupDef): void;
  delete(id: string): void;
}

export interface SignalReading {
  metrics: Record<string, number>;
  details?: Record<string, unknown>;
}

export interface SignalReader {
  /** Reads a signal. Failures must be SignalUnavailableError. */
  read(signal: SignalDef): Promise<SignalReading>;
}

/** The signal could not be read. Monitoring reports it as an issue rather than a crash. */
export class SignalUnavailableError extends Error {
  constructor(
    readonly signalId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`signal "${signalId}" could not be read: ${message}`, options);
    this.name = "SignalUnavailableError";
  }
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ModelClient {
  complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatMessage>;
}

export interface ActionOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ActionRunner {
  run(action: ActionDef, location: string, options: { dryRun: boolean }): Promise<ActionOutput>;
}

export interface FindingRepository {
  save(finding: Finding): void;
  get(id: string): Finding | undefined;
  list(status?: FindingStatus): Finding[];
}

export interface ApprovalRepository {
  get(id: string): ApprovalRequest | undefined;
  insert(request: ApprovalRequest): void;
  /** Writes `next` only while the stored status is still `expected`. Returns false when another writer won. */
  replace(next: ApprovalRequest, expected: ApprovalStatus): boolean;
  list(filter?: { status?: ApprovalStatus; findingId?: string }): ApprovalRequest[];
}

export interface ThreadRepository {
  append(message: Omit<ThreadMessage, "id">): ThreadMessage;
  list(findingId: string): ThreadMessage[];
}

export interface AuditLog {
  append(entry: Omit<AuditEntry, "id">): void;
  list(filter?: { subject?: string; limit?: number }): AuditEntry[];
}

/** Runs `work` atomically. Synchronous, so no await may happen inside. */
export interface UnitOfWork {
  run<T>(work: () => T): T;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface SessionRepository {
  insert(session: Session): void;
  get(id: string): Session | undefined;
  touch(id: string, lastSeenAt: string): void;
  delete(id: string): void;
}

/** The identity provider (Microsoft Entra). Knows OpenID Connect; the use cases do not. */
export interface IdentityProvider {
  authorizationUrl(request: { state: string; nonce: string; codeVerifier: string; redirectUri: string }): Promise<string>;
  exchangeCode(request: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ idToken: string }>;
  verifyIdToken(idToken: string, nonce: string): Promise<{ user: string }>;
}
