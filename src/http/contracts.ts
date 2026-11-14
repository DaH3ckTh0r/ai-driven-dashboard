// Wire types shared by the server and the web app. Type-only: no runtime code lives here.

export type Severity = "low" | "medium" | "high" | "critical";
export type Risk = "read" | "write";

export interface IntegrationView {
  id: string;
  name: string;
  owner: string;
  description: string;
  signals: { id: string; type: string; intervalSec: number }[];
  actions: { id: string; description: string; risk: Risk; requiresConfirmation: boolean }[];
  monitors: { id: string; name: string; signal: string; severity: Severity; enabled: boolean; actions: string[] }[];
}

export interface MonitorView {
  id: string;
  name: string;
  integrationId: string;
  integrationName: string;
  severity: Severity;
  enabled: boolean;
  tags: string[];
  metric: string;
  operator: string;
  threshold: number;
  last: null | { lastRunAt: string; state: "healthy" | "breached" | "unavailable" | "error"; value?: number; metric?: string; error?: string };
}

export interface GroupView {
  id: string;
  name: string;
  description: string;
  owner: string | null;
  openIssues: number;
  worstSeverity: Severity | null;
  members: MonitorView[];
}

export interface AssessmentView {
  summary: string;
  decision: "informational" | "act_now" | "needs_approval";
  cause?: string;
  complete: boolean;
}

export interface FindingView {
  id: string;
  integrationId: string;
  monitorId: string;
  monitorName: string;
  kind: "threshold-breach" | "signal-unavailable";
  severity: Severity;
  status: "open" | "resolved";
  observedAt: string;
  createdAt: string;
  error?: string;
  evaluation?: { metric: string; value: number; operator: string; threshold: number };
  assessment?: AssessmentView;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "executing" | "executed" | "failed";

export interface ApprovalView {
  id: string;
  findingId: string;
  actionId: string;
  reason: string;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  decidedBy?: string;
  decidedAt?: string;
  result?: string;
}

export interface MessageView {
  id: number;
  role: "agent" | "user" | "system";
  author: string;
  text: string;
  approvalId?: string;
  at: string;
}

export interface AuditView {
  id: number;
  at: string;
  actor: string;
  event: string;
  subject: string;
  detail: unknown;
}

export interface FindingDetailView {
  finding: FindingView;
  messages: MessageView[];
  approvals: ApprovalView[];
  audit: AuditView[];
}

export interface DryRunView {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WhoAmIView {
  user: string;
  approver: boolean;
}

export interface ErrorView {
  error: string;
  code?: string;
}
