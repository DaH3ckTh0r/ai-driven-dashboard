# integration-monitor

Documentation with diagrams: [docs/](docs/README.md) (architecture, monitoring flow, monitor configuration, security, desktop app).

An AI-assisted monitor for integrations. Each integration is a folder of YAML plus action scripts.
Monitors read signals, and when one breaches, an agent investigates with read-only actions and may
propose a write. A write runs only after the signed-in user approves it.

## Layout

    src/
      domain/           pure rules: model, evaluation, approval state machine (no I/O)
      application/      use cases and ports (interfaces the outside world implements)
      infrastructure/   adapters: config loader, Azure signal readers, APIM model client,
                        script runner, SQLite persistence, system clock
      http/             HTTP routes, auth, presenters, wire contracts (shared with the web app)
      main/             composition root (wire.ts), production wiring, serve and validate entry points
    web/                React dashboard (imports types from src/http/contracts, type-only)
    examples/integrations/orders-api/   a sample integration
    test/               domain, application, infrastructure and http tests

Dependencies point inward: domain <- application <- infrastructure and http <- main.

## Adding an integration

Create `integrations/<id>/integration.yaml` with `signals`, `actions` and `monitors`. Put action
scripts in `integrations/<id>/scripts/`. Run `npm run validate -- integrations` to check the
configuration, environment variables and script paths before starting the server.

Write actions must set `requiresConfirmation: true`; the loader rejects them otherwise.
Environment placeholders (`${NAME}`) are resolved at load time. Secrets never go in files.

Signal types: `log-analytics` and `app-insights` (KQL must summarize to one row), `http-health`,
`storage-queue`, `service-bus`.

## Commands

    npm install
    npm test                                  # TDD: unit and integration tests (node:test)
    npm run bdd                               # BDD: Gherkin scenarios in features/
    npm run check                             # typecheck, tests and scenarios
    npm run e2e                               # Entra sign-in against a fake OIDC provider, incl. restart and sign-out
    npm run validate -- examples/integrations # check configs, env vars and script paths
    npm run build:all                         # compile the server and build the web app
    npm run serve -- examples/integrations    # scheduler + web app + API on HOST:PORT

## Two ways to run the same code

Both targets run the same compiled server (`dist/`), the same React build (`web/dist/`) and the same
production dependencies. Only the packaging and the identity source differ.

| target | identity | how the monitor is reached |
| --- | --- | --- |
| web app (container) | Easy Auth header (`AUTH_MODE=easy-auth`) | HTTP on port 8080 behind App Service or a gateway |
| desktop app (Tauri) | the OS user name (`AUTH_MODE=local`) | a window on a random 127.0.0.1 port |

Container:

    npm run docker:build
    docker run -p 8080:8080 -v monitor-data:/data \
      -e APIM_CHAT_URL=https://<apim>/chat -e APIM_SUBSCRIPTION_KEY=... \
      -e LA_WORKSPACE_ID=... -e SB_NAMESPACE=... \
      -v "$PWD/integrations:/app/integrations:ro" integration-monitor:latest

Desktop (needs Rust, and on Linux WebKitGTK 4.1; see the Tauri prerequisites):

    npm run desktop:build      # writes desktop/src-tauri/target/release/bundle/

Set the values in the app's **Settings** window (menu: Settings…, or Cmd/Ctrl+,). It works like the application settings of an Azure Function App:

- **Settings** (plain values such as `APIM_CHAT_URL`, `APPROVERS`, `PUBLIC_BASE_URL`) are saved in `settings.env` in the app data folder.
- **Secrets** (tick "Secret") such as `ENTRA_CLIENT_SECRET` and `APIM_SUBSCRIPTION_KEY` are saved in the operating system keychain. The settings window shows only that they are set, never their values.

Any name works, as long as it uses capital letters, digits and underscores, so integration variables referenced by the YAML can be added the same way. Each save restarts only the monitor server with the new settings (a short pause groups several edits), and the monitor window reloads. Your sign-in session is kept. If the server cannot start, the Settings window opens with the error.

The settings files live in the app data folder, because a GUI launch does not inherit shell variables:

    Linux:   ~/.local/share/com.integrations.monitor/     (secrets: Secret Service, e.g. GNOME Keyring or KWallet, must be running)
    macOS:   ~/Library/Application Support/com.integrations.monitor/     (secrets: Keychain)
    Windows: %APPDATA%\com.integrations.monitor\     (secrets: Credential Manager)

`settings.env` may also be edited by hand, one `NAME=value` per line. Secrets are never written to it.

The desktop server exits when the app quits, because it reads a pipe from the app and stops when the pipe closes.

Limits of the desktop build: it has been built and run on Linux only; macOS and Windows bundles are untested.
Sign-in state for a pending sign-in is kept in memory, so the server must run as a single instance.

## Sign-in with Microsoft

With `AUTH_MODE=entra` the app checks for an existing session cookie first. A returning user with a live session
goes straight to the monitor. Everyone else sees "Sign in with Microsoft" and is sent to Entra (OpenID Connect, authorization
code with PKCE). A session ends after 30 minutes without use or 12 hours after sign-in, whichever comes first, and survives
server restarts. On https the cookie is `__Host-im_session` (Secure, HttpOnly, SameSite=Lax); only a digest of its value is stored.

Register the app once in Microsoft Entra admin center (App registrations > New registration):

- Desktop: add a platform "Mobile and desktop applications" with the redirect URI `http://localhost:47831/auth/callback`,
  and set "Allow public client flows" to Yes. No client secret is needed.
- Container behind a public HTTPS address: add a platform "Web" with `https://<your-host>/auth/callback`,
  set `ENTRA_CLIENT_SECRET` for the confidential client, and set `PUBLIC_BASE_URL` to `https://<your-host>`.

Azure App Service with Easy Auth already signs users in at the platform level, so keep `AUTH_MODE=easy-auth` there.
`ENTRA_AUTHORITY` overrides the login host for sovereign clouds.

## Environment

| name | purpose |
| --- | --- |
| `APIM_CHAT_URL`, `APIM_SUBSCRIPTION_KEY` | OpenAI-compatible chat endpoint behind APIM |
| `DB_PATH` | SQLite file (default `monitor.db`) |
| `AUTH_MODE` | `easy-auth` (default, behind App Service), `entra` (Microsoft sign-in), or `local` (named user, development) |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_AUTHORITY` | Microsoft sign-in (`entra` mode); the secret is optional |
| `PUBLIC_BASE_URL` | the address users open; the sign-in returns to `<this>/auth/callback` (`entra` mode) |
| `APPROVERS` | comma-separated names allowed to approve, dry-run and close issues. Required; `local` mode defaults to `LOCAL_USER`. Everyone signed in can still view |
| `LOCAL_USER` | the name recorded for `local` mode |
| `HOST`, `PORT` | listen address (default `127.0.0.1:8080`) |
| integration variables | e.g. `LA_WORKSPACE_ID`, `SB_NAMESPACE`, referenced by the YAML |

Azure access uses `DefaultAzureCredential`.

## Behaviour

- A healthy monitor only records its status. A breach or an unreadable signal opens a finding and starts the agent.
- The agent may call read actions and propose writes. A proposal waits for approval and expires after 24 hours.
- Approve runs the write once. Dry run runs it in dry mode and leaves the approval pending.
- Every state change is written to the audit log in the same transaction as the change.

## Security controls (OWASP Top 10 2021)

| Risk | Control in this app |
| --- | --- |
| A01 Broken access control | Only names in `APPROVERS` can approve, reject, dry-run or close an issue, and each check runs in the use case, not only in the UI. Every `/api` call needs an identity. |
| A02 Cryptographic failures | Session values are 256-bit random tokens; only their SHA-256 digest is stored. PKCE (S256) is used for sign-in. Secrets come from environment variables, never from source. |
| A03 Injection | Config is validated with Zod at load time. The SQLite layer uses bound statements. Action output shown to users is clipped. |
| A04 Insecure design | A write runs only after an explicit approval, once, with an audit entry in the same transaction. Proposals expire after 24 hours. An approval interrupted by a crash is failed for review, never retried. |
| A05 Security misconfiguration | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` with camera, microphone and geolocation off, COOP and CORP `same-origin`, `Cache-Control: no-store`. HSTS is sent when served over https. The desktop window has its own CSP. |
| A06 Vulnerable components | `npm audit --omit=dev` reports no vulnerabilities. Seven moderate findings remain in dev tooling (Cucumber, glob, minimatch, uuid); fixing them needs a breaking `npm audit fix --force`. |
| A07 Authentication failures | Entra OIDC with `state`, `nonce` and PKCE. Each sign-in state is accepted once and expires after 10 minutes. Idle timeout 30 minutes, absolute 12 hours, server-side revocation on sign-out. Cookie is HttpOnly, SameSite=Lax, and `__Host-` prefixed on https. Sign-in endpoints allow 20 requests per minute per client address. Provider outages return 503 without internal detail. |
| A08 Integrity failures | ID tokens are verified with `jose` against the tenant's keys: issuer, audience, signature, and nonce. Container builds use `npm ci` from the lockfile. |
| A09 Logging failures | The audit log records sign-in, refused sign-in, sign-out, approvals, dry runs, resolutions and monitor errors. Entries are append-only. |
| A10 Server-side request forgery | Signal URLs come from integration configs that operators write. Configs are trusted input; users cannot enter URLs through the UI. |

Gaps and assumptions:

- Easy Auth trusts the `x-ms-client-principal-name` header. The app must be reachable only through App Service or the gateway.
- Pending sign-ins and the rate limiter live in memory, and SQLite is a single file. Run one instance.
- `settings.env` on the desktop stores `APIM_SUBSCRIPTION_KEY` in plain text. An OS keychain would be stronger.
- The Docker base image is pinned by tag, not digest. Pin it by digest in production.
- The real Entra tenant, macOS and Windows desktop builds, and visual rendering of the desktop window have not been tested.

## Known limits

- An approval interrupted by a crash is marked `failed` at startup for review and is never retried automatically.
- `node:sqlite` is experimental in the Node version used here and prints a warning.
- The example action scripts are placeholders and must be replaced with real queries and reprocessing logic.
- Real Azure and APIM endpoints have not been exercised; the tests use fake services.
