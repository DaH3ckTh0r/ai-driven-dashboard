import { api } from "../api";
import { usePolling } from "../hooks";
import { Empty, ErrorBanner, SeverityPill } from "../components/ui";
import { label } from "../format";

export function Integrations() {
  const integrations = usePolling(() => api.integrations(), 60000);
  return (
    <section>
      <header className="page-head">
        <h1>Integrations</h1>
        <p>
          To add an integration, create a folder with an <code>integration.yaml</code> file and restart the monitor.
          Connection details are not shown here.
        </p>
      </header>
      <ErrorBanner message={integrations.error} />
      {integrations.data && integrations.data.length === 0 && <Empty>No integrations configured.</Empty>}
      <div className="grid">
        {(integrations.data ?? []).map((i) => (
          <article className="card wide" key={i.id}>
            <h3>{i.name}</h3>
            <div className="muted">
              {i.id} · owner {i.owner}
            </div>
            {i.description && <p>{i.description}</p>}

            <h4>Signals</h4>
            <ul className="plain">
              {i.signals.map((s) => (
                <li key={s.id}>
                  {s.id} <span className="muted">({label(s.type)}, every {s.intervalSec}s)</span>
                </li>
              ))}
            </ul>

            <h4>Monitors</h4>
            <table className="table compact">
              <tbody>
                {i.monitors.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <SeverityPill severity={m.severity} />
                    </td>
                    <td>{m.name}</td>
                    <td className="muted small">{m.enabled ? "enabled" : "disabled"}</td>
                    <td className="muted small">agent actions: {m.actions.join(", ") || "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4>Actions</h4>
            <table className="table compact">
              <tbody>
                {i.actions.map((a) => (
                  <tr key={a.id}>
                    <td>{a.id}</td>
                    <td>{a.description}</td>
                    <td>
                      <span className={`pill tone-${a.risk === "write" ? "red" : "green"}`}>{a.risk}</span>
                    </td>
                    <td className="small muted">{a.requiresConfirmation ? "needs approval" : "runs without approval"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </section>
  );
}
