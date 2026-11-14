# Security and sign-in

The full mapping of OWASP Top 10 controls is in the [top-level README](../README.md#security-controls-owasp-top-10-2021). This document covers how sign-in and sessions work, and where the trust boundaries are.

## Trust boundaries

```mermaid
flowchart LR
    subgraph untrusted["Untrusted"]
        BR["Browser"]
        NET["Network"]
    end
    subgraph edge["Edge"]
        AS["App Service Easy Auth<br/>web only"]
        TLS["HTTPS, HSTS"]
    end
    subgraph trusted["Server"]
        SRV["Node server<br/>CSP, rate limits,<br/>approver checks"]
        CFG["Config files<br/>written by operators"]
    end
    subgraph secret["Secret stores"]
        KC["OS keychain<br/>desktop secrets"]
        APP["App Service settings<br/>web secrets"]
    end
    subgraph remote["Remote systems"]
        ENTRA["Microsoft Entra ID"]
        AZ["Azure and HTTP signal sources"]
        LLM["APIM chat endpoint"]
    end

    BR --> NET --> TLS --> AS --> SRV
    BR -. "sign-in redirect" .-> ENTRA
    ENTRA -. "ID token" .-> SRV
    SRV --> AZ
    SRV --> LLM
    CFG --> SRV
    KC --> SRV
    APP --> SRV
```

Three rules follow from the boundaries:

- Anything a browser sends is checked on the server. Hiding a button is never the only control.
- The server trusts the identity header only when App Service sits in front of it. Make sure nothing else can reach the container.
- Config files are written by operators, so signal URLs are trusted input. Users cannot enter URLs through the UI.

## Sign-in

Sign-in uses OpenID Connect with the authorization code flow and PKCE. The server checks for an existing session first, so a returning user is not asked to sign in again.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant B as Browser
    participant S as Server
    participant D as SQLite
    participant E as Microsoft Entra ID
    U->>B: open the app
    B->>S: GET /api/whoami with session cookie
    alt live session
        S->>D: look up digest of cookie
        S->>D: touch last_seen_at
        S-->>B: signed-in user
    else no session
        S-->>B: 401, show Sign in with Microsoft
        B->>S: GET /auth/login
        S->>S: create state, nonce, PKCE verifier (10 min)
        S-->>B: redirect to Entra with S256 challenge
        B->>E: sign in
        E-->>B: redirect to /auth/callback with code and state
        B->>S: GET /auth/callback
        S->>S: state accepted once, else refused
        S->>E: exchange code with verifier
        E-->>S: ID token
        S->>S: verify issuer, audience, signature, nonce
        S->>D: store digest of new session
        S->>D: audit auth.signed-in
        S-->>B: Set-Cookie im_session, redirect to /
    end
```

Failures give generic messages. A provider outage returns 503 with no internal detail. A replayed or forged state is refused and audited as `auth.refused`.

## Session lifecycle

A session ends in one of three ways: it sits idle for 30 minutes, it reaches 12 hours since sign-in, or the user signs out.

```mermaid
stateDiagram-v2
    [*] --> Active: sign-in completes
    Active --> Active: request arrives, last_seen_at updated
    Active --> IdleExpired: 30 minutes without a request
    Active --> AbsoluteExpired: 12 hours since sign-in
    Active --> SignedOut: POST /auth/logout
    IdleExpired --> [*]: row deleted on next check
    AbsoluteExpired --> [*]: row deleted on next check
    SignedOut --> [*]: row deleted, audit auth.signed-out
```

Cookies are HttpOnly and SameSite=Lax. On https the name is `__Host-im_session`, which requires Secure, Path=/ and no Domain. The database stores only a SHA-256 digest of the cookie value, so a leaked database does not reveal live sessions.

## Authorization

Every state change goes through an approver check in the use case:

```mermaid
flowchart LR
    REQ["Request to approve, reject,<br/>dry run or resolve"] --> SIGNED{"Signed in?"}
    SIGNED -- no --> R401["401"]
    SIGNED -- yes --> NAMED{"Named user?"}
    NAMED -- empty --> R400["400 bad input"]
    NAMED -- yes --> ALLOW{"In APPROVERS?"}
    ALLOW -- no --> R403["403 forbidden"]
    ALLOW -- yes --> DO["Use case runs<br/>and is audited"]
```

Viewing the dashboard is open to everyone who is signed in. Changing anything requires being listed in `APPROVERS`. The list is required in `entra` and `easy-auth` modes, so the server will not start without it.

## Audit events

| Event | When |
| --- | --- |
| `auth.signed-in` | sign-in completes |
| `auth.refused` | a sign-in response is refused |
| `auth.signed-out` | the user signs out |
| `finding.opened` | a breach or unreadable signal opens an issue |
| `finding.resolved` | an issue is closed |
| `monitor.error` | a tick itself throws |
| `approval.requested` | the agent proposes a write |
| `approval.dry_run` | a dry run is previewed |
| `approval.approved`, `approval.rejected`, `approval.expired` | the approver decides, or the proposal times out |
| `approval.executing`, `approval.executed`, `approval.failed` | the write runs, and its outcome |

Entries are append-only and are shown in the dashboard's audit view.
