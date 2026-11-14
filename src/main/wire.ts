// Composition: connects use cases to their ports. Production and tests both call this, so
// the wiring is written once. It contains no logic and no infrastructure choices.
import { ApprovalWorkflow } from "../application/approval-workflow.js";
import { MonitoringService } from "../application/monitoring.js";
import { MonitorStatusBook } from "../application/monitor-status.js";
import { ReadModel } from "../application/read-model.js";
import type { Approvers } from "../domain/approvers.js";
import { GroupService } from "../application/groups.js";
import type { ActionRunner, ApprovalRepository, AuditLog, Clock, FindingRepository, GroupRepository, IdGenerator, IntegrationCatalog, ModelClient, SignalReader, ThreadRepository, UnitOfWork } from "../application/ports.js";

export interface Persistence {
  findings: FindingRepository;
  approvals: ApprovalRepository;
  threads: ThreadRepository;
  audit: AuditLog;
  groups: GroupRepository;
  uow: UnitOfWork;
}

export interface WireDeps {
  catalog: IntegrationCatalog;
  signals: SignalReader;
  model: ModelClient;
  actions: ActionRunner;
  persistence: Persistence;
  clock: Clock;
  ids: IdGenerator;
  approvers: Approvers;
}

export interface Application {
  monitoring: MonitoringService;
  approvals: ApprovalWorkflow;
  groups: GroupService;
  reads: ReadModel;
}

export function wire(deps: WireDeps): Application {
  const { persistence: p } = deps;
  const statuses = new MonitorStatusBook();
  const approvals = new ApprovalWorkflow({
    uow: p.uow,
    approvals: p.approvals,
    threads: p.threads,
    audit: p.audit,
    catalog: deps.catalog,
    actions: deps.actions,
    clock: deps.clock,
    ids: deps.ids,
    approvers: deps.approvers,
  });
  const monitoring = new MonitoringService({
    catalog: deps.catalog,
    signals: deps.signals,
    model: deps.model,
    actions: deps.actions,
    findings: p.findings,
    approvals: p.approvals,
    threads: p.threads,
    audit: p.audit,
    uow: p.uow,
    clock: deps.clock,
    ids: deps.ids,
    statuses,
    propose: (input) => approvals.propose(input),
    approvers: deps.approvers,
  });
  const groups = new GroupService({
    uow: p.uow,
    groups: p.groups,
    audit: p.audit,
    catalog: deps.catalog,
    approvers: deps.approvers,
    clock: deps.clock,
  });
  const reads = new ReadModel({
    catalog: deps.catalog,
    groups: p.groups,
    statuses,
    findings: p.findings,
    approvals: p.approvals,
    threads: p.threads,
    audit: p.audit,
  });
  return { monitoring, approvals, groups, reads };
}
