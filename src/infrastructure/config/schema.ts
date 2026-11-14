import { z } from "zod";

/** Lowercase slug used for integration, signal, monitor and action ids. */
export const IdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "must be 2-63 chars: lowercase letters, digits and dashes");

const Seconds = z.number().int().positive();

// Shapes of the integration.yaml file. Mapped to domain types by the loader.

const KqlSignal = z.strictObject({
  id: IdSchema,
  type: z.enum(["log-analytics", "app-insights"]),
  workspaceId: z.string().min(1),
  kql: z.string().min(1),
  windowMinutes: Seconds.default(5),
  intervalSec: Seconds.default(300),
});

const HttpHealthSignal = z.strictObject({
  id: IdSchema,
  type: z.literal("http-health"),
  url: z.url(),
  method: z.enum(["GET", "HEAD"]).default("GET"),
  expectStatus: z.array(z.number().int().min(100).max(599)).min(1).default([200]),
  timeoutMs: Seconds.default(5000),
  intervalSec: Seconds.default(60),
});

const StorageQueueSignal = z.strictObject({
  id: IdSchema,
  type: z.literal("storage-queue"),
  accountUrl: z.url(),
  queueName: z.string().min(3).max(63),
  intervalSec: Seconds.default(120),
});

const ServiceBusSignal = z.strictObject({
  id: IdSchema,
  type: z.literal("service-bus"),
  namespace: z.string().min(1),
  queueName: z.string().min(1),
  intervalSec: Seconds.default(120),
});

export const SignalSchema = z.discriminatedUnion("type", [KqlSignal, HttpHealthSignal, StorageQueueSignal, ServiceBusSignal]);

const ReadAction = z.strictObject({
  id: IdSchema,
  description: z.string().min(1),
  risk: z.literal("read"),
  script: z.string().min(1),
  requiresConfirmation: z.boolean().default(false),
  timeoutSec: Seconds.default(120),
});

const WriteAction = z.strictObject({
  id: IdSchema,
  description: z.string().min(1),
  risk: z.literal("write"),
  script: z.string().min(1),
  /** Write actions must always be confirmed by the logged-in user. */
  requiresConfirmation: z.literal(true),
  timeoutSec: Seconds.default(300),
});

export const ActionSchema = z.discriminatedUnion("risk", [ReadAction, WriteAction]);

const TagSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "tags: lowercase letters, digits and dashes, up to 32 characters");

export const MonitorSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1),
  signal: IdSchema,
  metric: z.string().min(1),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq", "ne"]),
  threshold: z.number(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  enabled: z.boolean().default(true),
  tags: z.array(TagSchema).max(10).default([]),
  agent: z
    .strictObject({
      maxSteps: z.number().int().min(1).max(30).default(8),
      actions: z.array(IdSchema).default([]),
    })
    .default({ maxSteps: 8, actions: [] }),
});

const MemberRef = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}\/[a-z0-9][a-z0-9-]{1,62}$/, "must be integration-id/monitor-id");

export const GroupSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1),
  owner: z.string().min(1).optional(),
  description: z.string().optional(),
  monitors: z.array(MemberRef).min(1),
});

/** groups.yaml at the integrations root. Member references are checked against the loaded monitors. */
export const GroupsFileSchema = z.strictObject({
  groups: z.array(GroupSchema).default([]),
});

export const IntegrationSchema = z
  .strictObject({
    id: IdSchema,
    name: z.string().min(1),
    owner: z.string().min(1),
    description: z.string().optional(),
    signals: z.array(SignalSchema).min(1),
    actions: z.array(ActionSchema).default([]),
    monitors: z.array(MonitorSchema).default([]),
  })
  .superRefine((integration, ctx) => {
    const signalIds = unique(integration.signals.map((s) => s.id), "signal", ["signals"], ctx);
    const actionIds = unique(integration.actions.map((a) => a.id), "action", ["actions"], ctx);
    unique(integration.monitors.map((m) => m.id), "monitor", ["monitors"], ctx);

    integration.monitors.forEach((m, i) => {
      if (!signalIds.has(m.signal)) {
        ctx.addIssue({ code: "custom", path: ["monitors", i, "signal"], message: `monitor "${m.id}" references unknown signal "${m.signal}"` });
      }
      m.agent.actions.forEach((actionId) => {
        if (!actionIds.has(actionId)) {
          ctx.addIssue({ code: "custom", path: ["monitors", i, "agent", "actions"], message: `monitor "${m.id}" references unknown action "${actionId}"` });
        }
      });
    });
  });

type Ctx = { addIssue: (issue: { code: "custom"; path: (string | number)[]; message: string }) => void };

/** Returns the set of ids and reports duplicates. */
function unique(ids: string[], kind: string, path: string[], ctx: Ctx): Set<string> {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) ctx.addIssue({ code: "custom", path: [...path, i, "id"], message: `duplicate ${kind} id "${id}"` });
    seen.add(id);
  });
  return seen;
}
