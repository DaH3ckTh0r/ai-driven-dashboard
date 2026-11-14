import type { SignalDef } from "../../domain/model.js";
import { SignalUnavailableError, type SignalReader, type SignalReading } from "../../application/ports.js";
import type { AzureClients } from "../azure/clients.js";

type HttpSignal = Extract<SignalDef, { type: "http-health" }>;
type KqlSignal = Extract<SignalDef, { kql: string }>;
type QueueSignal = Extract<SignalDef, { type: "storage-queue" }>;
type BusSignal = Extract<SignalDef, { type: "service-bus" }>;

/** Probes an endpoint. Latency and status are metrics; `healthy` is 1 when the status is expected. */
export class HttpHealthReader {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async read(signal: HttpSignal): Promise<SignalReading> {
    const started = performance.now();
    const response = await this.fetchFn(signal.url, {
      method: signal.method,
      signal: AbortSignal.timeout(signal.timeoutMs),
      redirect: "manual",
    });
    const latencyMs = Math.round(performance.now() - started);
    await response.body?.cancel().catch(() => undefined);
    return {
      metrics: { latencyMs, status: response.status, healthy: signal.expectStatus.includes(response.status) ? 1 : 0 },
      details: { status: response.status },
    };
  }
}

/** Runs a KQL query that must summarize to one row. Every numeric column becomes a metric. */
export class KqlReader {
  constructor(private readonly logs: AzureClients["logs"]) {}

  async read(signal: KqlSignal): Promise<SignalReading> {
    const { columns, rows } = await this.logs.query(signal.workspaceId, signal.kql, signal.windowMinutes);
    if (rows.length !== 1) {
      throw new Error(
        rows.length === 0
          ? "query returned no rows; summarize without 'by' so it always returns one row"
          : `query returned ${rows.length} rows; it must summarize to a single row`,
      );
    }
    const metrics: Record<string, number> = {};
    const details: Record<string, unknown> = {};
    columns.forEach((name, i) => {
      if (!name) return;
      const value = rows[0][i];
      details[name] = value;
      if (typeof value === "number" && Number.isFinite(value)) metrics[name] = value;
    });
    if (Object.keys(metrics).length === 0) throw new Error("query returned no numeric columns to use as metrics");
    return { metrics, details };
  }
}

export class QueueDepthReader {
  constructor(private readonly queues: AzureClients["queues"]) {}

  async read(signal: QueueSignal): Promise<SignalReading> {
    return { metrics: { depth: await this.queues.approximateMessageCount(signal.accountUrl, signal.queueName) } };
  }
}

export class ServiceBusReader {
  constructor(private readonly bus: AzureClients["bus"]) {}

  async read(signal: BusSignal): Promise<SignalReading> {
    const counts = await this.bus.runtimeCounts(signal.namespace, signal.queueName);
    return { metrics: { active: counts.active, deadLetter: counts.deadLetter, scheduled: counts.scheduled, total: counts.total } };
  }
}

/**
 * Routes each signal to its reader. Any failure is reported as SignalUnavailableError,
 * so monitoring treats every read failure the same way.
 */
export class SignalReaders implements SignalReader {
  constructor(
    private readonly readers: {
      http: HttpHealthReader;
      kql: KqlReader;
      queues: QueueDepthReader;
      bus: ServiceBusReader;
    },
  ) {}

  async read(signal: SignalDef): Promise<SignalReading> {
    try {
      switch (signal.type) {
        case "http-health":
          return await this.readers.http.read(signal);
        case "log-analytics":
        case "app-insights":
          return await this.readers.kql.read(signal);
        case "storage-queue":
          return await this.readers.queues.read(signal);
        case "service-bus":
          return await this.readers.bus.read(signal);
      }
    } catch (err) {
      if (err instanceof SignalUnavailableError) throw err;
      throw new SignalUnavailableError(signal.id, (err as Error).message, { cause: err });
    }
  }
}
