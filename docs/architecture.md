# Architecture

Integration Monitor watches the integrations a company runs, such as APIs, queues and health endpoints. When a monitor detects a problem, an AI agent investigates it with read-only actions and proposes fixes. Nothing changes until a named approver confirms the proposal.

## Layers

The code follows clean architecture. Dependencies point inward: outer layers know about inner ones, never the reverse.

```mermaid
flowchart TB
    subgraph outer["Entry points and adapters"]
        direction LR
        HTTP["HTTP server<br/>src/http"]
        INFRA["Infrastructure<br/>src/infrastructure"]
        MAIN["Composition root<br/>src/main"]
    end
    subgraph app["Application: use cases and ports"]
        direction LR
        MON["MonitoringService<br/>and MonitorScheduler"]
        APPR["ApprovalWorkflow"]
        INV["Investigation agent"]
        SIGNIN["SignIn"]
    end
    subgraph domain["Domain: pure rules, no I/O"]
        direction LR
        EVAL["evaluateCondition"]
        STATE["Approval state machine"]
        APPRV["Approvers allowlist"]
        SESS["Session rules"]
    end

    HTTP --> app
    MAIN --> app
    MAIN --> INFRA
    INFRA -. implements ports .-> app
    app --> domain
```

| Layer | Folder | Contents | Depends on |
| --- | --- | --- | --- |
| Domain | `src/domain` | Monitor condition evaluation, approval states, approver rules, session rules, error codes | nothing |
| Application | `src/application` | Monitoring, scheduling, approvals, the investigation agent, sign-in, read models; the ports they need | domain |
| Infrastructure | `src/infrastructure` | Config loader, signal readers, action script runner, APIM chat client, SQLite, Entra and PKCE, system clock | application ports |
| HTTP | `src/http` | JSON API, auth routes, security headers, static web app, rate limiter | application |
| Composition root | `src/main` | Settings from environment, wiring, `serve.ts`, `validate.ts` | everything |

## Components

```mermaid
flowchart LR
    subgraph config["Configuration on disk"]
        YAML["integrations/&lt;id&gt;/integration.yaml"]
        SCRIPTS["integrations/&lt;id&gt;/scripts/*.ts"]
    end
    subgraph server["Node server"]
        LOADER["Config loader<br/>Zod schemas, env interpolation"]
        CATALOG["StaticCatalog"]
        SCHED["MonitorScheduler<br/>one timer per enabled monitor"]
        MONSVC["MonitoringService"]
        READERS["Signal readers"]
        AGENT["Investigation agent"]
        RUNNER["Script runner"]
        WORKFLOW["ApprovalWorkflow"]
        API["JSON API /api"]
        AUTHR["Auth routes /auth"]
        STATIC["Static web app"]
    end
    subgraph external["External services"]
        AZ["Azure Monitor, Log Analytics,<br/>App Insights, Storage Queue,<br/>Service Bus"]
        HTTPEP["HTTP health endpoints"]
        APIM["APIM chat endpoint<br/>model for the agent"]
        ENTRA["Microsoft Entra ID"]
    end
    DB[("SQLite<br/>findings, approvals, messages,<br/>audit, sessions")]
    WEB["React dashboard"]

    YAML --> LOADER --> CATALOG --> SCHED
    SCRIPTS --> RUNNER
    SCHED --> MONSVC
    MONSVC --> READERS
    READERS --> AZ
    READERS --> HTTPEP
    MONSVC --> AGENT
    AGENT --> APIM
    AGENT --> RUNNER
    AGENT --> WORKFLOW
    WORKFLOW --> RUNNER
    API --> MONSVC
    API --> WORKFLOW
    AUTHR --> ENTRA
    MONSVC --> DB
    WORKFLOW --> DB
    AUTHR --> DB
    WEB --> API
    WEB --> AUTHR
    STATIC --> WEB
```

## Deployment targets

The same server code runs in two wrappers. Only the wrapper and the sign-in mode differ.

```mermaid
flowchart LR
    subgraph web["Web: container behind Azure App Service"]
        BROWSER1["Browser"] --> EASY["App Service<br/>Easy Auth"]
        EASY -->|"x-ms-client-principal-name"| C1["Container<br/>Node server :8080"]
        C1 --> V1[("/data volume<br/>monitor.db")]
    end
    subgraph desk["Desktop: Tauri app"]
        WIN["Monitor window<br/>http://localhost:47831"] --> SIDE["Node runtime<br/>started by the Tauri shell"]
        SET["Settings window"] --> SHELL["Tauri shell (Rust)"]
        SHELL -->|"starts, stops, reloads"| SIDE
        SHELL --> FILES[("settings.env<br/>+ OS keychain")]
        SHELL -->|"merged env"| SIDE
        SIDE --> V2[("app data dir<br/>monitor.db")]
    end
```

- **Web**: App Service authenticates users with Easy Auth and passes the identity in a header. The server must be reachable only through App Service or the gateway.
- **Desktop**: the shell runs the server on `127.0.0.1` and opens the monitor window. Users sign in with Microsoft inside the window, through the server's Entra flow.

## Data model

Five SQLite tables back the application. Each state change writes its audit entry in the same transaction.

```mermaid
erDiagram
    FINDINGS ||--o{ APPROVALS : "may propose"
    FINDINGS ||--o{ MESSAGES : "discussed in"
    FINDINGS {
        text id PK
        text integration_id
        text monitor_id
        text monitor_name
        text kind
        text severity
        text status "for example open or resolved"
        text observed_at
        text created_at
        text details
    }
    APPROVALS {
        text id PK
        text finding_id FK
        text integration_id
        text monitor_id
        text action_id
        text reason
        text status "see approval states"
        text requested_at
        text expires_at
        text decided_by
        text decided_at
        text result
    }
    MESSAGES {
        integer id PK
        text finding_id FK
        text role
        text author
        text text
        text approval_id
        text at
    }
    AUDIT {
        integer id PK
        text at
        text actor
        text event
        text subject
        text detail
    }
    SESSIONS {
        text id PK "SHA-256 digest of cookie value"
        text user_name
        text expires_at
        text last_seen_at
    }
```

The audit table is append-only. Sessions store only the digest of the cookie value, never the cookie itself.

## API

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/whoami` | signed in | the current user and whether they are an approver |
| GET | `/api/integrations` | signed in | integrations and their monitors |
| GET | `/api/monitors`, optionally `?tag=` | signed in | monitor status, filtered by tag |
| GET | `/api/groups` | signed in | groups with their members and open issues |
| POST | `/api/groups` | approvers | create a group (`id`, `name`, `owner`, `description`, `monitors`) |
| POST | `/api/groups/:id/update` | approvers | replace a group's fields and members |
| POST | `/api/groups/:id/delete` | approvers | delete a group; its monitors are not changed |
| GET | `/api/findings`, `/api/findings/:id` | signed in | open issues and their threads |
| POST | `/api/findings/:id/resolve` | approvers | close an issue |
| GET | `/api/audit` | signed in | audit log |
| POST | `/api/approvals/:id/approve` | approvers | run the proposed write once |
| POST | `/api/approvals/:id/reject` | approvers | reject a proposal |
| POST | `/api/approvals/:id/dry-run` | approvers | preview a proposal without approving it |
| GET | `/auth/login`, `/auth/callback` | anyone | Microsoft sign-in |
| POST | `/auth/logout` | signed in | end the session |

Requests from the web app must send JSON, which doubles as the CSRF guard. The auth routes are rate limited per client address.
