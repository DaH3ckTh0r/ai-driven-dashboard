import { useState, type FormEvent } from "react";
import { api, type GroupInput } from "../api";
import { useAction, usePolling } from "../hooks";
import { ConfirmDialog, Empty, ErrorBanner, SeverityPill } from "../components/ui";
import { label } from "../format";
import type { GroupView, MonitorView } from "../../../src/http/contracts";

type Editing = { mode: "create" } | { mode: "edit"; group: GroupView } | null;

/**
 * Groups bring monitors together, possibly from several integrations. Open issues in any member show here.
 * Groups are stored in the database. Only approvers see the controls that change them; the server checks again.
 */
export function Groups() {
  const groups = usePolling(() => api.groups(), 5000);
  const me = usePolling(() => api.whoami(), 60000);
  const monitors = usePolling(() => api.monitors(), 60000);
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<GroupView | null>(null);
  const canEdit = me.data?.approver === true;
  const removeAction = useAction(() => groups.reload());

  return (
    <section>
      <header className="page-head">
        <h1>Groups</h1>
        <p>A group brings monitors together, possibly from several integrations. Open issues in any member appear here.</p>
        {canEdit && editing === null && (
          <button type="button" className="primary" onClick={() => setEditing({ mode: "create" })}>
            New group
          </button>
        )}
      </header>
      <ErrorBanner message={groups.error ?? removeAction.error} />
      {editing && (
        <GroupForm
          key={editing.mode === "edit" ? editing.group.id : "new"}
          editing={editing}
          monitors={monitors.data ?? []}
          onSaved={() => {
            setEditing(null);
            groups.reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {groups.data && groups.data.length === 0 && !editing && <Empty>No groups yet.</Empty>}
      <div className="grid">
        {(groups.data ?? []).map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            canEdit={canEdit}
            onEdit={() => setEditing({ mode: "edit", group: g })}
            onRemove={() => setRemoving(g)}
          />
        ))}
      </div>
      {removing && (
        <ConfirmDialog
          title={`Delete group ${removing.name}?`}
          confirmLabel="Delete group"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const target = removing;
            setRemoving(null);
            await removeAction.run(() => api.deleteGroup(target.id));
          }}
        >
          <p>The group is removed. Its monitors and their issues are not changed.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function GroupCard({
  group: g,
  canEdit,
  onEdit,
  onRemove,
}: {
  group: GroupView;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <article className="card">
      <div className="card-head">
        <div>
          <h3>{g.name}</h3>
          {g.owner && <div className="muted">Owner: {g.owner}</div>}
        </div>
        {g.worstSeverity && <SeverityPill severity={g.worstSeverity} />}
      </div>
      {g.description && <p className="muted">{g.description}</p>}
      <div className="row">
        {g.openIssues > 0 ? (
          <a className="badge" href="#/issues">
            {g.openIssues} open
          </a>
        ) : (
          <span className="pill tone-green">No open issues</span>
        )}
      </div>
      <ul className="members">
        {g.members.map((m) => (
          <MemberLine key={`${m.integrationId}/${m.id}`} monitor={m} />
        ))}
      </ul>
      {canEdit && (
        <div className="row">
          <button type="button" className="ghost" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="danger" onClick={onRemove}>
            Delete
          </button>
        </div>
      )}
    </article>
  );
}

function MemberLine({ monitor: m }: { monitor: MonitorView }) {
  const state = m.enabled ? m.last?.state ?? "never-run" : "disabled";
  return (
    <li>
      {m.name} <span className="muted small">{m.integrationName}</span> <span className="pill tone-grey">{label(state)}</span>
    </li>
  );
}

interface GroupFormProps {
  editing: Exclude<Editing, null>;
  monitors: MonitorView[];
  onSaved: () => void;
  onCancel: () => void;
}

function GroupForm({ editing, monitors, onSaved, onCancel }: GroupFormProps) {
  const existing = editing.mode === "edit" ? editing.group : undefined;
  const [id, setId] = useState(existing?.id ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [owner, setOwner] = useState(existing?.owner ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [picked, setPicked] = useState<string[]>(
    existing ? existing.members.map((m) => `${m.integrationId}/${m.id}`) : [],
  );
  const action = useAction(() => undefined);

  const toggle = (ref: string) =>
    setPicked((current) => (current.includes(ref) ? current.filter((r) => r !== ref) : [...current, ref]));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body: Omit<GroupInput, "id"> = {
      name,
      owner: owner || undefined,
      description: description || undefined,
      monitors: picked,
    };
    const saved = await action.run(() =>
      existing ? api.updateGroup(existing.id, body) : api.createGroup({ ...body, id }),
    );
    if (saved !== undefined) onSaved();
  }

  return (
    <form className="card group-form" onSubmit={submit}>
      <h3>{existing ? `Edit ${existing.name}` : "New group"}</h3>
      <ErrorBanner message={action.error} />
      <label>
        Identifier
        {existing ? (
          <input value={existing.id} disabled />
        ) : (
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="checkout" required pattern="[a-z0-9][a-z0-9-]{1,62}" />
        )}
      </label>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Owner
        <input value={owner} onChange={(e) => setOwner(e.target.value)} />
      </label>
      <label>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <fieldset>
        <legend>Monitors (at least one)</legend>
        {monitors.map((m) => {
          const ref = `${m.integrationId}/${m.id}`;
          return (
            <label key={ref} className="check">
              <input type="checkbox" checked={picked.includes(ref)} onChange={() => toggle(ref)} />
              {m.name} <span className="muted small">{ref}</span>
            </label>
          );
        })}
      </fieldset>
      <div className="row">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={action.busy || picked.length === 0}>
          {existing ? "Save changes" : "Create group"}
        </button>
      </div>
    </form>
  );
}
