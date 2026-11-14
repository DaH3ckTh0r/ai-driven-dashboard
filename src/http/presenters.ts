// Maps domain objects to wire views. Each view lists its fields explicitly, so connection
// details (URLs, workspace ids, namespaces) and raw query data can never leak to the browser.
import type { ApprovalRequest } from "../domain/approval.js";
import type { AuditEntry, Finding, MonitorDef, ThreadMessage } from "../domain/model.js";
import type { FindingDetail, GroupEntry, MonitorEntry } from "../application/read-model.js";
import type { IntegrationRecord } from "../application/ports.js";
import type { ActionOutput } from "../application/ports.js";
import type { AuditView, ApprovalView, DryRunView, FindingDetailView, FindingView, GroupView, IntegrationView, MessageView, MonitorView } from "./contracts.js";

export function toIntegrationView({ integration }: IntegrationRecord): IntegrationView {
  return {
    id: integration.id,
    name: integration.name,
    owner: integration.owner,
    description: integration.description ?? "",
    signals: integration.signals.map((s) => ({ id: s.id, type: s.type, intervalSec: s.intervalSec })),
    actions: integration.actions.map((a) => ({
      id: a.id,
      description: a.description,
      risk: a.risk,
      requiresConfirmation: a.requiresConfirmation,
    })),
    monitors: integration.monitors.map((m: MonitorDef) => ({
      id: m.id,
      name: m.name,
      signal: m.signal,
      severity: m.severity,
      enabled: m.enabled,
      actions: m.agent.actions,
    })),
  };
}

export function toMonitorView(entry: MonitorEntry): MonitorView {
  const { record, monitor, last } = entry;
  return {
    id: monitor.id,
    name: monitor.name,
    integrationId: record.integration.id,
    integrationName: record.integration.name,
    severity: monitor.severity,
    enabled: monitor.enabled,
    tags: monitor.tags,
    metric: monitor.metric,
    operator: monitor.operator,
    threshold: monitor.threshold,
    last: last ?? null,
  };
}

export function toGroupView(entry: GroupEntry): GroupView {
  return {
    id: entry.group.id,
    name: entry.group.name,
    description: entry.group.description,
    owner: entry.group.owner ?? null,
    openIssues: entry.openIssues,
    worstSeverity: entry.worstSeverity,
    members: entry.members.map(toMonitorView),
  };
}

export function toFindingView(f: Finding): FindingView {
  return {
    id: f.id,
    integrationId: f.integrationId,
    monitorId: f.monitorId,
    monitorName: f.monitorName,
    kind: f.kind,
    severity: f.severity,
    status: f.status,
    observedAt: f.observedAt,
    createdAt: f.createdAt,
    error: f.error,
    evaluation: f.evaluation && {
      metric: f.evaluation.metric,
      value: f.evaluation.value,
      operator: f.evaluation.operator,
      threshold: f.evaluation.threshold,
    },
    assessment: f.assessment && {
      summary: f.assessment.summary,
      decision: f.assessment.decision,
      cause: f.assessment.cause,
      complete: f.assessment.complete,
    },
  };
}

export function toApprovalView(r: ApprovalRequest): ApprovalView {
  return {
    id: r.id,
    findingId: r.findingId,
    actionId: r.actionId,
    reason: r.reason,
    status: r.status,
    requestedAt: r.requestedAt,
    expiresAt: r.expiresAt,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    result: r.result,
  };
}

export function toMessageView(m: ThreadMessage): MessageView {
  return { id: m.id, role: m.role, author: m.author, text: m.text, approvalId: m.approvalId, at: m.at };
}

export function toAuditView(e: AuditEntry): AuditView {
  return { id: e.id, at: e.at, actor: e.actor, event: e.event, subject: e.subject, detail: e.detail };
}

export function toFindingDetailView(d: FindingDetail): FindingDetailView {
  return {
    finding: toFindingView(d.finding),
    messages: d.messages.map(toMessageView),
    approvals: d.approvals.map(toApprovalView),
    audit: d.audit.map(toAuditView),
  };
}

export function toDryRunView(output: ActionOutput): DryRunView {
  return { exitCode: output.exitCode, stdout: output.stdout, stderr: output.stderr };
}
