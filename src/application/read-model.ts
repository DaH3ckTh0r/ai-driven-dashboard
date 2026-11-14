import type { ApprovalRequest } from "../domain/approval.js";
import { DomainError } from "../domain/errors.js";
import type { AuditEntry, Finding, FindingStatus, GroupDef, MonitorDef, Severity, ThreadMessage } from "../domain/model.js";
import { monitorKey, type MonitorStatusBook, type TickStatus } from "./monitor-status.js";
import type { ApprovalRepository, AuditLog, FindingRepository, GroupRepository, IntegrationCatalog, IntegrationRecord, ThreadRepository } from "./ports.js";

export interface MonitorEntry {
  record: IntegrationRecord;
  monitor: MonitorDef;
  last?: TickStatus;
}

export interface GroupEntry {
  group: GroupDef;
  members: MonitorEntry[];
  /** Open issues raised by any member. */
  openIssues: number;
  /** Highest severity among those open issues, or null when there are none. */
  worstSeverity: Severity | null;
}

const RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export interface FindingDetail {
  finding: Finding;
  messages: ThreadMessage[];
  approvals: ApprovalRequest[];
  audit: AuditEntry[];
}

export interface ReadModelDeps {
  catalog: IntegrationCatalog;
  groups: GroupRepository;
  statuses: MonitorStatusBook;
  findings: FindingRepository;
  approvals: ApprovalRepository;
  threads: ThreadRepository;
  audit: AuditLog;
}

/** Read-only queries for the UI. Nothing here changes state. */
export class ReadModel {
  constructor(private readonly deps: ReadModelDeps) {}

  integrations(): IntegrationRecord[] {
    return this.deps.catalog.list();
  }

  /** Every monitor, or only those carrying the tag. */
  monitors(tag?: string): MonitorEntry[] {
    return this.allMonitors().filter(({ monitor }) => tag === undefined || monitor.tags.includes(tag));
  }

  /** Each group with its members and the open issues they raise. */
  groups(): GroupEntry[] {
    const entries = new Map(this.allMonitors().map((e) => [`${e.record.integration.id}/${e.monitor.id}`, e]));
    const open = this.deps.findings.list("open");
    return this.deps.groups.list().map((group) => {
      const members = group.monitors.flatMap((ref) => entries.get(ref) ?? []);
      const memberIds = new Set(group.monitors);
      const raised = open.filter((f) => memberIds.has(`${f.integrationId}/${f.monitorId}`));
      const worst = raised.reduce<Severity | null>(
        (best, f) => (best === null || RANK[f.severity] > RANK[best] ? f.severity : best),
        null,
      );
      return { group, members, openIssues: raised.length, worstSeverity: worst };
    });
  }

  private allMonitors(): MonitorEntry[] {
    return this.deps.catalog.list().flatMap((record) =>
      record.integration.monitors.map((monitor) => ({
        record,
        monitor,
        last: this.deps.statuses.get(monitorKey(record.integration.id, monitor.id)),
      })),
    );
  }

  findings(status?: FindingStatus): Finding[] {
    return this.deps.findings.list(status);
  }

  findingDetail(findingId: string): FindingDetail {
    const finding = this.deps.findings.get(findingId);
    if (!finding) throw new DomainError(`finding "${findingId}" not found`, "not-found");
    return {
      finding,
      messages: this.deps.threads.list(findingId),
      approvals: this.deps.approvals.list({ findingId }),
      audit: this.deps.audit.list({ subject: findingId, limit: 100 }),
    };
  }

  audit(limit: number): AuditEntry[] {
    return this.deps.audit.list({ limit });
  }
}
