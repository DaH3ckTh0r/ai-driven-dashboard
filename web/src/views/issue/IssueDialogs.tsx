import type { ApprovalView, IntegrationView } from "../../../../src/http/contracts";
import { ConfirmDialog } from "../../components/ui";

export function ApproveDialog({
  approval,
  integrationName,
  integration,
  onConfirm,
  onCancel,
}: {
  approval: ApprovalView;
  integrationName: string;
  integration?: IntegrationView;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      title="Run this action now?"
      confirmLabel="Approve and run"
      danger
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        <strong>{approval.actionId}</strong> on <strong>{integrationName}</strong> will run for real and change data.
      </p>
      {integration && <ActionDetail integration={integration} actionId={approval.actionId} />}
      <p className="small">
        Agent's reason: <em>{approval.reason}</em>
      </p>
      <p className="small muted">Approved as you. This is recorded in the audit log.</p>
    </ConfirmDialog>
  );
}

export function RejectDialog({
  reason,
  onReason,
  onConfirm,
  onCancel,
}: {
  reason: string;
  onReason: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog title="Reject this proposal?" confirmLabel="Reject" onCancel={onCancel} onConfirm={onConfirm}>
      <p>Nothing will run. You can add a reason for the audit log.</p>
      <label className="field">
        Reason (optional)
        <input value={reason} onChange={(e) => onReason(e.target.value)} maxLength={500} />
      </label>
    </ConfirmDialog>
  );
}

export function ResolveDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog title="Mark this issue resolved?" confirmLabel="Mark resolved" onCancel={onCancel} onConfirm={onConfirm}>
      <p>The issue moves to Resolved. Its messages and audit trail stay in place.</p>
    </ConfirmDialog>
  );
}

function ActionDetail({ integration, actionId }: { integration: IntegrationView; actionId: string }) {
  const action = integration.actions.find((a) => a.id === actionId);
  if (!action) return null;
  return (
    <div className="action-detail">
      <div>{action.description}</div>
      <div className="small muted">
        risk: {action.risk} · confirmation required: {action.requiresConfirmation ? "yes" : "no"}
      </div>
    </div>
  );
}
