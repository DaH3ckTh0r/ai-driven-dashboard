import { useEffect, useRef, type ReactNode } from "react";
import type { ApprovalStatus, Severity } from "../../../src/http/contracts";
import { label } from "../format";

export function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`pill sev-${severity}`}>{severity}</span>;
}

const APPROVAL_TONE: Record<ApprovalStatus, string> = {
  pending: "amber",
  approved: "blue",
  executing: "blue",
  executed: "green",
  failed: "red",
  rejected: "grey",
  expired: "grey",
};

export function ApprovalPill({ status }: { status: ApprovalStatus }) {
  return <span className={`pill tone-${APPROVAL_TONE[status]}`}>{label(status)}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="banner error" role="alert">
      {message}
    </div>
  );
}

interface ConfirmProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation. Escape and clicking outside cancel. Used before any change is applied. */
export function ConfirmDialog({ title, children, confirmLabel, danger, onConfirm, onCancel }: ConfirmProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="confirm"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onCancel();
      }}
    >
      <h2>{title}</h2>
      <div className="confirm-body">{children}</div>
      <div className="confirm-actions">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={danger ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
