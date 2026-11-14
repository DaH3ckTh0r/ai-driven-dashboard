import type { AuditView } from "../../../../src/http/contracts";
import { when } from "../../format";

export function AuditTrail({ events }: { events: AuditView[] }) {
  return (
    <details className="audit-box">
      <summary>Audit trail ({events.length})</summary>
      <ul className="audit-list">
        {events.map((e) => (
          <li key={e.id}>
            <span className="muted">{when(e.at)}</span> <strong>{e.event}</strong> by {e.actor}
          </li>
        ))}
      </ul>
    </details>
  );
}
