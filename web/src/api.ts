import type {
  ApprovalView,
  DryRunView,
  FindingDetailView,
  FindingView,
  AuditView,
  IntegrationView,
  GroupView,
  MonitorView,
  WhoAmIView,
} from "../../src/http/contracts";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: { method?: "POST"; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    credentials: "same-origin",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `request failed (${res.status})`, res.status);
  return data as T;
}

const enc = encodeURIComponent;

/** Fields of a group as the dashboard sends them. The id is only set when creating a group. */
export interface GroupInput {
  id?: string;
  name: string;
  owner?: string;
  description?: string;
  monitors: string[];
}

export const api = {
  whoami: () => request<WhoAmIView>("/api/whoami"),
  monitors: () => request<MonitorView[]>("/api/monitors"),
  groups: () => request<GroupView[]>("/api/groups"),
  integrations: () => request<IntegrationView[]>("/api/integrations"),
  findings: (status: "open" | "resolved") => request<FindingView[]>(`/api/findings?status=${status}`),
  finding: (id: string) => request<FindingDetailView>(`/api/findings/${enc(id)}`),
  audit: () => request<AuditView[]>("/api/audit?limit=200"),
  approve: (id: string) => request<ApprovalView>(`/api/approvals/${enc(id)}/approve`, { method: "POST", body: {} }),
  reject: (id: string, reason?: string) =>
    request<ApprovalView>(`/api/approvals/${enc(id)}/reject`, { method: "POST", body: { reason } }),
  dryRun: (id: string) => request<DryRunView>(`/api/approvals/${enc(id)}/dry-run`, { method: "POST", body: {} }),
  resolve: (id: string) => request<FindingView>(`/api/findings/${enc(id)}/resolve`, { method: "POST", body: {} }),
  createGroup: (body: GroupInput) => request<{ id: string }>("/api/groups", { method: "POST", body }),
  updateGroup: (id: string, body: Omit<GroupInput, "id">) =>
    request<{ id: string }>(`/api/groups/${enc(id)}/update`, { method: "POST", body }),
  deleteGroup: (id: string) => request<{ id: string }>(`/api/groups/${enc(id)}/delete`, { method: "POST", body: {} }),
};
