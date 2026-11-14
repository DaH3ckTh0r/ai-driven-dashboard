import type { IncomingMessage } from "node:http";
import type { ApprovalWorkflow } from "../application/approval-workflow.js";
import type { MonitoringService } from "../application/monitoring.js";
import type { GroupFields, GroupService } from "../application/groups.js";
import type { Approvers } from "../domain/approvers.js";
import type { ReadModel } from "../application/read-model.js";
import type { FindingStatus } from "../domain/model.js";
import { readJsonBody } from "./body.js";
import { HttpError } from "./errors.js";
import {
  toApprovalView,
  toAuditView,
  toDryRunView,
  toFindingDetailView,
  toFindingView,
  toIntegrationView,
  toGroupView,
  toMonitorView,
} from "./presenters.js";
import { json, type Reply } from "./reply.js";
import type { WhoAmIView } from "./contracts.js";

export interface RequestContext {
  user: string;
  url: URL;
  request: IncomingMessage;
}

export interface Route {
  method: "GET" | "POST";
  pattern: RegExp;
  handle: (params: string[], ctx: RequestContext) => Promise<Reply>;
}

export interface RouteDeps {
  reads: ReadModel;
  approvals: ApprovalWorkflow;
  monitoring: MonitoringService;
  groups: GroupService;
  approvers: Approvers;
}

/** Reads the fields of a group from a request body. Structure is checked here; business rules live in GroupService. */
function groupBody(body: Record<string, unknown>): GroupFields & { id: string } {
  const text = (key: string): string | undefined => {
    const value = body[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw new HttpError(400, `${key} must be text`);
    return value;
  };
  const monitors = body.monitors;
  if (!Array.isArray(monitors) || !monitors.every((m) => typeof m === "string")) {
    throw new HttpError(400, "monitors must be a list of integration-id/monitor-id strings");
  }
  return { id: text("id") ?? "", name: text("name") ?? "", description: text("description"), owner: text("owner"), monitors };
}

const FINDING_STATUSES: FindingStatus[] = ["open", "resolved"];

/** The API surface. Each route maps to one use case; none contains business rules. */
export function buildRoutes(deps: RouteDeps): Route[] {
  const { reads, approvals, monitoring, groups } = deps;
  return [
    {
      method: "GET",
      pattern: /^\/api\/whoami$/,
      handle: async (_p, ctx) => json<WhoAmIView>(200, { user: ctx.user, approver: deps.approvers.allows(ctx.user) }),
    },
    {
      method: "GET",
      pattern: /^\/api\/integrations$/,
      handle: async () => json(200, reads.integrations().map(toIntegrationView)),
    },
    {
      method: "GET",
      pattern: /^\/api\/monitors$/,
      handle: async (_p, ctx) => json(200, reads.monitors(ctx.url.searchParams.get("tag") ?? undefined).map(toMonitorView)),
    },
    {
      method: "GET",
      pattern: /^\/api\/groups$/,
      handle: async () => json(200, reads.groups().map(toGroupView)),
    },
    {
      method: "POST",
      pattern: /^\/api\/groups$/,
      handle: async (_p, ctx) => {
        const group = groups.create(groupBody(await readJsonBody(ctx.request)), ctx.user);
        return json(200, { id: group.id });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/groups\/([^/]+)\/update$/,
      handle: async ([id], ctx) => {
        const fields = groupBody({ ...(await readJsonBody(ctx.request)), id });
        groups.update(id, fields, ctx.user);
        return json(200, { id });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/groups\/([^/]+)\/delete$/,
      handle: async ([id], ctx) => {
        groups.remove(id, ctx.user);
        return json(200, { id });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/findings$/,
      handle: async (_p, ctx) => {
        const status = ctx.url.searchParams.get("status");
        if (status !== null && !FINDING_STATUSES.includes(status as FindingStatus)) {
          throw new HttpError(400, "status must be open or resolved");
        }
        return json(200, reads.findings((status as FindingStatus | null) ?? undefined).map(toFindingView));
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/findings\/([^/]+)$/,
      handle: async ([id]) => json(200, toFindingDetailView(reads.findingDetail(decodeURIComponent(id)))),
    },
    {
      method: "POST",
      pattern: /^\/api\/findings\/([^/]+)\/resolve$/,
      handle: async ([id], ctx) => {
        await readJsonBody(ctx.request);
        return json(200, toFindingView(monitoring.resolve(decodeURIComponent(id), ctx.user)));
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/audit$/,
      handle: async (_p, ctx) => {
        const limit = Math.min(Math.max(Number(ctx.url.searchParams.get("limit") ?? 100), 1), 500);
        return json(200, reads.audit(limit).map(toAuditView));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/approvals\/([^/]+)\/approve$/,
      handle: async ([id], ctx) => {
        await readJsonBody(ctx.request);
        return json(200, toApprovalView(await approvals.approve(decodeURIComponent(id), ctx.user)));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/approvals\/([^/]+)\/reject$/,
      handle: async ([id], ctx) => {
        const body = await readJsonBody(ctx.request);
        const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined;
        return json(200, toApprovalView(approvals.reject(decodeURIComponent(id), ctx.user, reason)));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/approvals\/([^/]+)\/dry-run$/,
      handle: async ([id], ctx) => {
        await readJsonBody(ctx.request);
        return json(200, toDryRunView(await approvals.dryRun(decodeURIComponent(id), ctx.user)));
      },
    },
  ];
}
