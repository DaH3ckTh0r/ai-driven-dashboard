import type { ApprovalView, MessageView } from "../../../../src/http/contracts";
import { ApprovalPill } from "../../components/ui";
import { when } from "../../format";

export function MessageBubble({
  message: m,
  approval: a,
  busy,
  dryRunOutput,
  onDryRun,
  onApprove,
  onReject,
}: {
  message: MessageView;
  approval?: ApprovalView;
  busy: boolean;
  dryRunOutput?: string;
  onDryRun: (a: ApprovalView) => void;
  onApprove: (a: ApprovalView) => void;
  onReject: (a: ApprovalView) => void;
}) {
  const role = m.role === "user" ? "user" : m.role === "system" ? "system" : "agent";
  return (
    <div className={`bubble ${role}`}>
      <div className="meta">
        {m.author} · {when(m.at)}
      </div>
      <div className="text">{m.text}</div>
      {a && (
        <div className="approval">
          <div className="row">
            <span className="small">Approval {a.id.slice(0, 12)}</span>
            <ApprovalPill status={a.status} />
          </div>
          {a.status === "pending" && (
            <div className="actions">
              <button className="ghost" disabled={busy} onClick={() => onDryRun(a)}>
                Dry run
              </button>
              <button className="primary" disabled={busy} onClick={() => onApprove(a)}>
                Approve and run
              </button>
              <button className="ghost" disabled={busy} onClick={() => onReject(a)}>
                Reject
              </button>
            </div>
          )}
          {dryRunOutput && <pre className="preview">{dryRunOutput}</pre>}
        </div>
      )}
    </div>
  );
}
