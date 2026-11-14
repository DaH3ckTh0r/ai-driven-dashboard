# Monitoring flow

This document follows one monitor from its scheduled check to an executed action.

## 1. From configuration to timers

At start-up the server loads every `integrations/<id>/integration.yaml`, validates it, and starts one timer per enabled monitor. The timer interval is the `intervalSec` of the monitor's signal.

```mermaid
flowchart LR
    F["integration.yaml files"] --> V{"Validate<br/>strict schemas,<br/>env vars, scripts,<br/>unique ids"}
    V -- problems --> X["Server does not start<br/>and lists every problem"]
    V -- ok --> C["StaticCatalog"]
    C --> S["MonitorScheduler"]
    S --> T1["timer: orders-5xx-spike<br/>every 300 s"]
    S --> T2["timer: orders-down<br/>every 60 s"]
    S --> T3["timer: orders-dlq-backlog<br/>every 120 s"]
```

Disabled monitors (`enabled: false`) get no timer.

## 2. One tick

Each tick reads the signal, evaluates the monitor's condition, and records the result.

```mermaid
sequenceDiagram
    autonumber
    participant S as MonitorScheduler
    participant M as MonitoringService
    participant R as Signal reader
    participant E as evaluateCondition
    participant D as SQLite
    S->>M: tick(integration, monitor)
    M->>R: read(signal)
    alt signal read fails
        R-->>M: error
        M->>D: open finding (signal unreadable)
    else signal read succeeds
        R-->>M: metrics, for example serverErrors = 73
        M->>E: compare metric with operator and threshold
        E-->>M: breached or not
        alt not breached
            M->>M: record healthy status only
        else breached
            M->>D: open finding
            M->>M: start investigation agent
        end
    end
```

A healthy monitor only records its status. A breach or an unreadable signal opens a finding and starts the agent. If the tick itself throws, the monitor's status becomes `error` and a `monitor.error` entry is written to the audit log.

## 3. Investigation

The agent is a bounded loop. It can read evidence, and it can propose writes. It cannot run writes itself.

```mermaid
flowchart TB
    START(["Finding opened"]) --> LOOP{"Step < maxSteps?"}
    LOOP -- no --> END(["Stop and summarise"])
    LOOP -- yes --> ASK["Model chooses a step<br/>via APIM"]
    ASK --> KIND{"Which action?"}
    KIND -- "not in agent.actions" --> REFUSE["Not run"] --> LOOP
    KIND -- "read action" --> RUN["Run script, dry run off<br/>result added to thread"] --> LOOP
    KIND -- "write action" --> PROP["Propose write<br/>approval pending"] --> END
    KIND -- "finish" --> END
```

The agent may only use the actions listed under `agent.actions` for its monitor. Every step and result is posted to the finding's thread.

## 4. Approval

A proposed write waits for a named approver. The state machine lives in `src/domain/approval.ts`, and every transition is applied by the `ApprovalWorkflow`.

```mermaid
stateDiagram-v2
    [*] --> pending: agent proposes
    pending --> approved: approver approves
    pending --> rejected: approver rejects
    pending --> expired: 24 hours pass
    approved --> executing: run starts
    executing --> executed: script succeeds
    executing --> failed: script fails or server stopped
    rejected --> [*]
    expired --> [*]
    executed --> [*]
    failed --> [*]
```

Rules that hold at every step:

- Only an approver (see `APPROVERS`) can approve, reject, dry-run or resolve. Everyone signed in can view.
- A dry run previews the action in dry mode and leaves the approval pending.
- Only the `approved` to `executing` transition starts a write. It runs once.
- An approval left in `executing` when the server stops is marked `failed` at the next start for review. It is never retried automatically.

The sequence for an approval:

```mermaid
sequenceDiagram
    autonumber
    actor U as Approver
    participant W as Web app
    participant API as /api
    participant AW as ApprovalWorkflow
    participant SR as Script runner
    participant D as SQLite
    U->>W: open issue, read proposal
    U->>W: click dry run
    W->>API: POST /api/approvals/:id/dry-run
    API->>AW: dryRun(id, user)
    AW->>SR: run script with dryRun true
    SR-->>AW: preview output
    AW-->>W: preview, still pending
    U->>W: click approve
    W->>API: POST /api/approvals/:id/approve
    API->>AW: approve(id, user)
    AW->>D: status approved, audit entry
    AW->>D: status executing, audit entry
    AW->>SR: run script
    SR-->>AW: output, ok or failed
    AW->>D: status executed or failed, audit entry
    AW-->>W: final state
```

Each arrow that changes state writes its audit entry in the same transaction. A non-approver receives a 403 at the approve step, before anything runs.
