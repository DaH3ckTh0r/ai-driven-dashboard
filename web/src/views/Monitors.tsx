import { useState } from "react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { Empty, ErrorBanner, SeverityPill } from "../components/ui";
import { label, relative } from "../format";
import type { FindingView, MonitorView } from "../../../src/http/contracts";

const STATE_TONE: Record<string, string> = {
  healthy: "green",
  breached: "red",
  unavailable: "amber",
  error: "amber",
};

export function Monitors() {
  const monitors = usePolling(() => api.monitors(), 5000);
  const open = usePolling(() => api.findings("open"), 5000);
  const [tag, setTag] = useState<string | null>(null);
  const now = Date.now();

  const all = monitors.data ?? [];
  const tags = [...new Set(all.flatMap((m) => m.tags))].sort();
  const shown = all.filter((m) => tag === null || m.tags.includes(tag));

  const openByMonitor = new Map<string, number>();
  for (const f of (open.data ?? []) as FindingView[]) {
    openByMonitor.set(f.monitorId, (openByMonitor.get(f.monitorId) ?? 0) + 1);
  }

  return (
    <section>
      <header className="page-head">
        <h1>Monitors</h1>
        <p>Each monitor has an agent. Breaches open an issue, and any change waits for your approval.</p>
      </header>
      <ErrorBanner message={monitors.error} />
      {tags.length > 0 && (
        <div className="chips" role="group" aria-label="Filter by tag">
          <button type="button" className="chip" aria-pressed={tag === null} onClick={() => setTag(null)}>
            All
          </button>
          {tags.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={tag === t} onClick={() => setTag(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {monitors.data && all.length === 0 && <Empty>No monitors configured yet.</Empty>}
      {monitors.data && all.length > 0 && shown.length === 0 && <Empty>No monitors carry the tag "{tag}".</Empty>}
      <div className="grid">
        {shown.map((m) => (
          <MonitorCard key={`${m.integrationId}/${m.id}`} monitor={m} openIssues={openByMonitor.get(m.id) ?? 0} now={now} />
        ))}
      </div>
    </section>
  );
}

function MonitorCard({ monitor: m, openIssues, now }: { monitor: MonitorView; openIssues: number; now: number }) {
  const state = !m.enabled ? "disabled" : m.last?.state ?? "never-run";
  const tone = !m.enabled || !m.last ? "grey" : STATE_TONE[m.last.state] ?? "grey";
  return (
    <article className="card">
      <div className="card-head">
        <div>
          <h3>{m.name}</h3>
          <div className="muted">{m.integrationName}</div>
          {m.tags.length > 0 && (
            <div className="tags">
              {m.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <SeverityPill severity={m.severity} />
      </div>
      <div className="row">
        <span className={`pill tone-${tone}`}>{label(state)}</span>
        {openIssues > 0 && <a className="badge" href="#/issues">{openIssues} open</a>}
      </div>
      <dl className="facts">
        <dt>Condition</dt>
        <dd>
          {m.metric} {m.operator} {m.threshold}
        </dd>
        <dt>Last value</dt>
        <dd>{m.last?.value !== undefined ? `${m.last.value} (${m.last.metric})` : "-"}</dd>
        <dt>Last run</dt>
        <dd>{relative(m.last?.lastRunAt, now)}</dd>
      </dl>
      {m.last?.error && <div className="muted small">{m.last.error}</div>}
    </article>
  );
}
