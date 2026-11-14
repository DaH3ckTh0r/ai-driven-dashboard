import type { FindingView } from "../../../../src/http/contracts";
import { SeverityPill } from "../../components/ui";
import { label, when } from "../../format";

export function IssueHeader({
  finding,
  busy,
  onResolve,
}: {
  finding: FindingView;
  busy: boolean;
  onResolve: () => void;
}) {
  const open = finding.status === "open";
  return (
    <header className="page-head">
      <div className="row">
        <SeverityPill severity={finding.severity} />
        <h1>{finding.monitorName}</h1>
      </div>
      <div className="muted">
        {finding.integrationId} · {label(finding.kind)} · observed {when(finding.observedAt)} ·{" "}
        {open ? "open" : "resolved"}
      </div>
      {finding.kind === "signal-unavailable" && finding.error && (
        <div className="banner warn">The signal could not be read: {finding.error}</div>
      )}
      {finding.evaluation && (
        <div className="muted small">
          {finding.evaluation.metric} = {finding.evaluation.value} (condition {finding.evaluation.operator}{" "}
          {finding.evaluation.threshold})
        </div>
      )}
      {open && (
        <button className="ghost" disabled={busy} onClick={onResolve}>
          Mark resolved
        </button>
      )}
    </header>
  );
}
