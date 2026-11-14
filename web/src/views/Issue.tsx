import { useState } from "react";
import { api } from "../api";
import { useAction, usePolling } from "../hooks";
import { Empty, ErrorBanner } from "../components/ui";
import type { ApprovalView } from "../../../src/http/contracts";
import { IssueHeader } from "./issue/IssueHeader";
import { MessageBubble } from "./issue/MessageBubble";
import { AuditTrail } from "./issue/AuditTrail";
import { ApproveDialog, RejectDialog, ResolveDialog } from "./issue/IssueDialogs";

type Pending =
  | { kind: "approve"; approval: ApprovalView }
  | { kind: "reject"; approval: ApprovalView }
  | { kind: "resolve" };

export function Issue({ id }: { id: string }) {
  const detail = usePolling(() => api.finding(id), 4000, [id]);
  const integrations = usePolling(() => api.integrations(), 60000);
  const action = useAction(detail.reload);
  const [pending, setPending] = useState<Pending>();
  const [rejectReason, setRejectReason] = useState("");
  const [dryRunOutput, setDryRunOutput] = useState<{ approvalId: string; text: string }>();

  if (detail.error && !detail.data) {
    return (
      <section>
        <ErrorBanner message={detail.error} />
        <a href="#/issues">Back to issues</a>
      </section>
    );
  }
  if (!detail.data) return <p className="muted">Loading issue...</p>;

  const { finding, messages, approvals, audit } = detail.data;
  const approvalById = new Map(approvals.map((a) => [a.id, a]));
  const integration = integrations.data?.find((i) => i.id === finding.integrationId);
  const close = () => setPending(undefined);

  const dryRun = async (approval: ApprovalView) => {
    const out = await action.run(() => api.dryRun(approval.id));
    if (out) setDryRunOutput({ approvalId: approval.id, text: out.stdout || out.stderr || `exit ${out.exitCode}` });
  };

  const confirm = async (change: () => Promise<unknown>) => {
    await action.run(change);
    close();
  };

  return (
    <section className="issue">
      <a href="#/issues" className="back">
        Back to issues
      </a>
      <IssueHeader finding={finding} busy={action.busy} onResolve={() => setPending({ kind: "resolve" })} />
      <ErrorBanner message={action.error} />

      <div className="chat">
        {messages.length === 0 && <Empty>No messages yet.</Empty>}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            approval={m.approvalId ? approvalById.get(m.approvalId) : undefined}
            busy={action.busy}
            dryRunOutput={dryRunOutput && dryRunOutput.approvalId === m.approvalId ? dryRunOutput.text : undefined}
            onDryRun={dryRun}
            onApprove={(approval) => setPending({ kind: "approve", approval })}
            onReject={(approval) => {
              setRejectReason("");
              setPending({ kind: "reject", approval });
            }}
          />
        ))}
      </div>

      <AuditTrail events={audit} />

      {pending?.kind === "approve" && (
        <ApproveDialog
          approval={pending.approval}
          integration={integration}
          integrationName={integration?.name ?? finding.integrationId}
          onCancel={close}
          onConfirm={() => confirm(() => api.approve(pending.approval.id))}
        />
      )}
      {pending?.kind === "reject" && (
        <RejectDialog
          reason={rejectReason}
          onReason={setRejectReason}
          onCancel={close}
          onConfirm={() => confirm(() => api.reject(pending.approval.id, rejectReason || undefined))}
        />
      )}
      {pending?.kind === "resolve" && (
        <ResolveDialog onCancel={close} onConfirm={() => confirm(() => api.resolve(finding.id))} />
      )}
    </section>
  );
}
