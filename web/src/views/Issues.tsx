import { useState } from "react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { Empty, ErrorBanner, SeverityPill } from "../components/ui";
import { label, when, relative } from "../format";

export function Issues() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const findings = usePolling(() => api.findings(status), 5000, [status]);
  const now = Date.now();

  return (
    <section>
      <header className="page-head">
        <h1>Issues</h1>
        <div className="tabs">
          {(["open", "resolved"] as const).map((s) => (
            <button key={s} className={status === s ? "tab active" : "tab"} onClick={() => setStatus(s)}>
              {s}
            </button>
          ))}
        </div>
      </header>
      <ErrorBanner message={findings.error} />
      {findings.data && findings.data.length === 0 && <Empty>No {status} issues.</Empty>}
      {findings.data && findings.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Monitor</th>
              <th>Integration</th>
              <th>Kind</th>
              <th>Observed</th>
            </tr>
          </thead>
          <tbody>
            {findings.data.map((f) => (
              <tr key={f.id} onClick={() => (window.location.hash = `#/issues/${f.id}`)} className="clickable">
                <td>
                  <SeverityPill severity={f.severity} />
                </td>
                <td>{f.monitorName}</td>
                <td>{f.integrationId}</td>
                <td>{label(f.kind)}</td>
                <td title={when(f.observedAt)}>{relative(f.observedAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
