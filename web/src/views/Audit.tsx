import { api } from "../api";
import { usePolling } from "../hooks";
import { ErrorBanner, Empty } from "../components/ui";
import { when } from "../format";

export function Audit() {
  const events = usePolling(() => api.audit(), 10000);
  return (
    <section>
      <header className="page-head">
        <h1>Audit log</h1>
        <p>Every finding, proposal, approval and execution, in order. Entries are never edited or deleted.</p>
      </header>
      <ErrorBanner message={events.error} />
      {events.data && events.data.length === 0 && <Empty>No events yet.</Empty>}
      {events.data && events.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Event</th>
              <th>Subject</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.data.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{when(e.at)}</td>
                <td>{e.actor}</td>
                <td>
                  <code>{e.event}</code>
                </td>
                <td className="small muted mono">{e.subject}</td>
                <td className="small mono">{JSON.stringify(e.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
