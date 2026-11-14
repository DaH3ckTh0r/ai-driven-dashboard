import type { DatabaseSync } from "node:sqlite";
import type { ApprovalRequest, ApprovalStatus } from "../../domain/approval.js";
import type { AuditEntry, Finding, FindingStatus, GroupDef, ThreadMessage } from "../../domain/model.js";
import type { ApprovalRepository, AuditLog, FindingRepository, GroupRepository, SessionRepository, ThreadRepository, UnitOfWork } from "../../application/ports.js";
import type { Session } from "../../domain/session.js";

type Row = Record<string, string | number | null>;
const rowsOf = (rows: unknown[]) => rows as Row[];

export interface SqlitePersistence {
  findings: FindingRepository;
  approvals: ApprovalRepository;
  threads: ThreadRepository;
  audit: AuditLog;
  sessions: SessionRepository;
  groups: GroupRepository;
  uow: UnitOfWork;
}

export function createSqlitePersistence(db: DatabaseSync): SqlitePersistence {
  return {
    findings: new SqliteFindings(db),
    approvals: new SqliteApprovals(db),
    threads: new SqliteThreads(db),
    audit: new SqliteAudit(db),
    sessions: new SqliteSessions(db),
    groups: new SqliteGroups(db),
    uow: new SqliteUnitOfWork(db),
  };
}

class SqliteGroups implements GroupRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): GroupDef[] {
    return rowsOf(this.db.prepare("SELECT * FROM monitor_groups ORDER BY name, id").all()).map(toGroup);
  }

  get(id: string): GroupDef | undefined {
    const row = this.db.prepare("SELECT * FROM monitor_groups WHERE id = ?").get(id) as Row | undefined;
    return row ? toGroup(row) : undefined;
  }

  insert(group: GroupDef): void {
    this.db
      .prepare("INSERT INTO monitor_groups (id, name, description, owner, monitors) VALUES (?, ?, ?, ?, ?)")
      .run(group.id, group.name, group.description, group.owner ?? null, JSON.stringify(group.monitors));
  }

  update(group: GroupDef): void {
    this.db
      .prepare("UPDATE monitor_groups SET name = ?, description = ?, owner = ?, monitors = ? WHERE id = ?")
      .run(group.name, group.description, group.owner ?? null, JSON.stringify(group.monitors), group.id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM monitor_groups WHERE id = ?").run(id);
  }
}

function toGroup(row: Row): GroupDef {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    owner: row.owner === null ? undefined : String(row.owner),
    monitors: JSON.parse(String(row.monitors)) as string[],
  };
}

/** BEGIN IMMEDIATE transactions. Re-entrant: nested calls join the outer transaction. */
class SqliteUnitOfWork implements UnitOfWork {
  private depth = 0;

  constructor(private readonly db: DatabaseSync) {}

  run<T>(work: () => T): T {
    if (this.depth > 0) return work();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth++;
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    } finally {
      this.depth--;
    }
  }
}

class SqliteFindings implements FindingRepository {
  constructor(private readonly db: DatabaseSync) {}

  save(f: Finding): void {
    // Only status can change after creation; everything else is a record of what was seen.
    this.db
      .prepare(
        `INSERT INTO findings (id, integration_id, monitor_id, monitor_name, kind, severity, status, observed_at, created_at, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
      )
      .run(
        f.id,
        f.integrationId,
        f.monitorId,
        f.monitorName,
        f.kind,
        f.severity,
        f.status,
        f.observedAt,
        f.createdAt,
        JSON.stringify({ error: f.error, evaluation: f.evaluation, measurement: f.measurement, assessment: f.assessment }),
      );
  }

  get(id: string): Finding | undefined {
    const row = this.db.prepare("SELECT * FROM findings WHERE id = ?").get(id);
    return row ? toFinding(row as Row) : undefined;
  }

  list(status?: FindingStatus): Finding[] {
    const rows = status
      ? this.db.prepare("SELECT * FROM findings WHERE status = ? ORDER BY created_at DESC").all(status)
      : this.db.prepare("SELECT * FROM findings ORDER BY created_at DESC").all();
    return rowsOf(rows).map(toFinding);
  }
}

class SqliteApprovals implements ApprovalRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): ApprovalRequest | undefined {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id);
    return row ? toApproval(row as Row) : undefined;
  }

  insert(r: ApprovalRequest): void {
    this.db
      .prepare(
        `INSERT INTO approvals (id, finding_id, integration_id, monitor_id, action_id, reason, status, requested_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.id, r.findingId, r.integrationId, r.monitorId, r.actionId, r.reason, r.status, r.requestedAt, r.expiresAt);
  }

  replace(next: ApprovalRequest, expected: ApprovalStatus): boolean {
    const result = this.db
      .prepare(
        `UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, result = ?
         WHERE id = ? AND status = ?`,
      )
      .run(next.status, next.decidedBy ?? null, next.decidedAt ?? null, next.result ?? null, next.id, expected);
    return Number(result.changes) === 1;
  }

  list(filter: { status?: ApprovalStatus; findingId?: string } = {}): ApprovalRequest[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.findingId) {
      where.push("finding_id = ?");
      params.push(filter.findingId);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return rowsOf(this.db.prepare(`SELECT * FROM approvals ${clause} ORDER BY requested_at`).all(...params)).map(toApproval);
  }
}

class SqliteThreads implements ThreadRepository {
  constructor(private readonly db: DatabaseSync) {}

  append(m: Omit<ThreadMessage, "id">): ThreadMessage {
    const result = this.db
      .prepare("INSERT INTO messages (finding_id, role, author, text, approval_id, at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(m.findingId, m.role, m.author, m.text, m.approvalId ?? null, m.at);
    return { ...m, id: Number(result.lastInsertRowid) };
  }

  list(findingId: string): ThreadMessage[] {
    return rowsOf(this.db.prepare("SELECT * FROM messages WHERE finding_id = ? ORDER BY id").all(findingId)).map((r) => ({
      id: Number(r.id),
      findingId: String(r.finding_id),
      role: r.role as ThreadMessage["role"],
      author: String(r.author),
      text: String(r.text),
      approvalId: r.approval_id ? String(r.approval_id) : undefined,
      at: String(r.at),
    }));
  }
}

/** Append-only: there is deliberately no update or delete. */
class SqliteAudit implements AuditLog {
  constructor(private readonly db: DatabaseSync) {}

  append(e: Omit<AuditEntry, "id">): void {
    this.db
      .prepare("INSERT INTO audit (at, actor, event, subject, detail) VALUES (?, ?, ?, ?, ?)")
      .run(e.at, e.actor, e.event, e.subject, JSON.stringify(e.detail ?? {}));
  }

  list(filter: { subject?: string; limit?: number } = {}): AuditEntry[] {
    const limit = filter.limit ?? 100;
    const rows = filter.subject
      ? this.db.prepare("SELECT * FROM audit WHERE subject = ? ORDER BY id DESC LIMIT ?").all(filter.subject, limit)
      : this.db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?").all(limit);
    return rowsOf(rows).map((r) => ({
      id: Number(r.id),
      at: String(r.at),
      actor: String(r.actor),
      event: String(r.event),
      subject: String(r.subject),
      detail: JSON.parse(String(r.detail)),
    }));
  }
}

function toFinding(r: Row): Finding {
  const details = JSON.parse(String(r.details)) as Pick<Finding, "error" | "evaluation" | "measurement" | "assessment">;
  return {
    id: String(r.id),
    integrationId: String(r.integration_id),
    monitorId: String(r.monitor_id),
    monitorName: String(r.monitor_name),
    kind: r.kind as Finding["kind"],
    severity: r.severity as Finding["severity"],
    status: r.status as FindingStatus,
    observedAt: String(r.observed_at),
    createdAt: String(r.created_at),
    ...details,
  };
}

function toApproval(r: Row): ApprovalRequest {
  return {
    id: String(r.id),
    findingId: String(r.finding_id),
    integrationId: String(r.integration_id),
    monitorId: String(r.monitor_id),
    actionId: String(r.action_id),
    reason: String(r.reason),
    requestedAt: String(r.requested_at),
    expiresAt: String(r.expires_at),
    status: r.status as ApprovalStatus,
    decidedBy: r.decided_by ? String(r.decided_by) : undefined,
    decidedAt: r.decided_at ? String(r.decided_at) : undefined,
    result: r.result ? String(r.result) : undefined,
  };
}

class SqliteSessions implements SessionRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(session: Session): void {
    this.db
      .prepare("INSERT INTO sessions (id, user_name, expires_at, last_seen_at) VALUES (?, ?, ?, ?)")
      .run(session.id, session.user, session.expiresAt, session.lastSeenAt);
  }

  get(id: string): Session | undefined {
    const row = this.db.prepare("SELECT id, user_name, expires_at, last_seen_at FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return row
      ? { id: String(row.id), user: String(row.user_name), expiresAt: String(row.expires_at), lastSeenAt: String(row.last_seen_at) }
      : undefined;
  }

  touch(id: string, lastSeenAt: string): void {
    this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(lastSeenAt, id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }
}
