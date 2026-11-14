import { Approvers } from "../../src/domain/approvers.js";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadGroups, loadIntegrationRecords } from "../../src/infrastructure/config/loader.js";
import { StaticCatalog } from "../../src/infrastructure/config/catalog.js";
import { openDatabase } from "../../src/infrastructure/persistence/database.js";
import { createSqlitePersistence, type SqlitePersistence } from "../../src/infrastructure/persistence/sqlite-repositories.js";
import { wire, type Application } from "../../src/main/wire.js";
import { SignalUnavailableError, type ActionOutput, type ActionRunner, type ChatMessage, type Clock, type IdGenerator, type ModelClient, type SignalReader, type SignalReading, type ToolCall } from "../../src/application/ports.js";
import type { ActionDef, GroupDef, SignalDef } from "../../src/domain/model.js";

export const ENV = { LA_WORKSPACE_ID: "ws-secret-123", SB_NAMESPACE: "bus-secret.servicebus.windows.net" };
export const EXAMPLES = resolve("examples/integrations");

export class FakeClock implements Clock {
  private current = new Date("2026-11-13T12:00:00Z");
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0;
  next(prefix: string): string {
    return `${prefix}-${++this.n}`;
  }
}

/** Replies from a fixed script. Throws if called more times than scripted, so unexpected model calls fail tests. */
export class ScriptedModel implements ModelClient {
  calls = 0;
  constructor(private readonly replies: ChatMessage[]) {}
  async complete(): Promise<ChatMessage> {
    this.calls++;
    const next = this.replies.shift();
    if (!next) throw new Error("scripted model ran out of replies");
    return next;
  }
}

export class FakeSignals implements SignalReader {
  constructor(private outcome: SignalReading | Error) {}
  set(outcome: SignalReading | Error): void {
    this.outcome = outcome;
  }
  async read(signal: SignalDef): Promise<SignalReading> {
    if (this.outcome instanceof SignalUnavailableError) throw this.outcome;
    if (this.outcome instanceof Error) throw new SignalUnavailableError(signal.id, this.outcome.message, { cause: this.outcome });
    return this.outcome;
  }
}

export class RecordingRunner implements ActionRunner {
  readonly ran: string[] = [];
  async run(action: ActionDef, _location: string, options: { dryRun: boolean }): Promise<ActionOutput> {
    this.ran.push(`${action.id}${options.dryRun ? ":dry" : ""}`);
    return { exitCode: 0, stdout: `output of ${action.id}`, stderr: "" };
  }
}

export function toolCall(name: string, args: Record<string, unknown>, id = `call-${name}`): ChatMessage {
  const call: ToolCall = { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
  return { role: "assistant", content: null, tool_calls: [call] };
}

/** The reply script for a typical breach: propose one write, then finish. */
export function proposeThenFinish(decision: "needs_approval" | "informational" = "needs_approval"): ChatMessage[] {
  return [
    toolCall("propose_write_action", { action_id: "reprocess-dlq", reason: "replay the failed batch" }),
    toolCall("finish", { summary: "billing timeouts caused the 5xx spike", decision }),
  ];
}

export interface Harness {
  app: Application;
  db: DatabaseSync;
  persistence: SqlitePersistence;
  clock: FakeClock;
  signals: FakeSignals;
  runner: RecordingRunner;
  model: ScriptedModel;
  close: () => void;
}

export interface HarnessOptions {
  metrics?: Record<string, number>;
  signals?: SignalReading | Error;
  replies?: ChatMessage[];
  dbPath?: string;
  approvers?: string[];
  groups?: GroupDef[];
}

/** Real use cases and real SQLite, with fake external services. */
export async function buildHarness(options: HarnessOptions = {}): Promise<Harness> {
  const records = await loadIntegrationRecords(EXAMPLES, { env: ENV });
  const db = openDatabase(options.dbPath ?? ":memory:");
  const persistence = createSqlitePersistence(db);
  const clock = new FakeClock();
  const signals = new FakeSignals(options.signals ?? { metrics: options.metrics ?? { total: 100, serverErrors: 80, healthy: 1 } });
  const runner = new RecordingRunner();
  const model = new ScriptedModel(options.replies ?? proposeThenFinish());
  const app = wire({
    catalog: new StaticCatalog(records),
    signals,
    model,
    actions: runner,
    persistence,
    clock,
    ids: new SequentialIds(),
    approvers: new Approvers(options.approvers ?? ["hector"]),
  });
  app.groups.seedFromFile(options.groups ?? []);
  return { app, db, persistence, clock, signals, runner, model, close: () => db.close() };
}
