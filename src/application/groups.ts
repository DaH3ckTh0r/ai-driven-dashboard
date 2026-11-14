// Groups are managed in the database. Only approvers may change them, every change is audited,
// and a group may only name monitors that exist in the loaded integrations.
import type { Approvers } from "../domain/approvers.js";
import { DomainError } from "../domain/errors.js";
import { requireActor, type GroupDef } from "../domain/model.js";
import type { AuditLog, Clock, GroupRepository, IntegrationCatalog, UnitOfWork } from "./ports.js";

const GROUP_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** The fields a user edits. The id is fixed when the group is created. */
export interface GroupFields {
  name: string;
  description?: string;
  owner?: string;
  monitors: string[];
}

export interface GroupServiceDeps {
  uow: UnitOfWork;
  groups: GroupRepository;
  audit: AuditLog;
  catalog: IntegrationCatalog;
  approvers: Approvers;
  clock: Clock;
}

export class GroupService {
  constructor(private readonly deps: GroupServiceDeps) {}

  create(input: GroupFields & { id: string }, user: string): GroupDef {
    this.authorise(user);
    if (!GROUP_ID.test(input.id)) {
      throw new DomainError("group id: 2 to 63 lowercase letters, digits or dashes, starting with a letter or digit", "bad-input");
    }
    return this.deps.uow.run(() => {
      if (this.deps.groups.get(input.id)) throw new DomainError(`group "${input.id}" already exists`, "conflict");
      const group = this.build(input.id, input);
      this.deps.groups.insert(group);
      this.record("group.created", user, group.id, { monitors: group.monitors });
      return group;
    });
  }

  update(id: string, input: GroupFields, user: string): GroupDef {
    this.authorise(user);
    return this.deps.uow.run(() => {
      if (!this.deps.groups.get(id)) throw new DomainError(`group "${id}" not found`, "not-found");
      const group = this.build(id, input);
      this.deps.groups.update(group);
      this.record("group.updated", user, id, { monitors: group.monitors });
      return group;
    });
  }

  remove(id: string, user: string): void {
    this.authorise(user);
    this.deps.uow.run(() => {
      if (!this.deps.groups.get(id)) throw new DomainError(`group "${id}" not found`, "not-found");
      this.deps.groups.delete(id);
      this.record("group.deleted", user, id, {});
    });
  }

  /**
   * Adds the groups from groups.yaml that the database does not have yet. A group already in the
   * database is left alone, so edits made in the dashboard are never overwritten at start-up.
   */
  seedFromFile(defs: GroupDef[]): void {
    this.deps.uow.run(() => {
      for (const def of defs) {
        if (this.deps.groups.get(def.id)) continue;
        this.deps.groups.insert(def);
        this.record("group.imported", "system", def.id, { source: "groups.yaml" });
      }
    });
  }

  private authorise(user: string): void {
    requireActor(user);
    this.deps.approvers.require(user);
  }

  private build(id: string, input: GroupFields): GroupDef {
    const name = input.name.trim();
    if (!name) throw new DomainError("a group needs a name", "bad-input");
    const monitors = [...new Set(input.monitors)];
    if (monitors.length === 0) throw new DomainError("a group needs at least one monitor", "bad-input");
    const known = this.knownMonitors();
    const unknown = monitors.filter((ref) => !known.has(ref));
    if (unknown.length > 0) {
      throw new DomainError(`these monitors do not exist: ${unknown.join(", ")}`, "bad-input");
    }
    return {
      id,
      name,
      description: input.description?.trim() ?? "",
      owner: input.owner?.trim() || undefined,
      monitors,
    };
  }

  private knownMonitors(): Set<string> {
    return new Set(
      this.deps.catalog.list().flatMap(({ integration }) => integration.monitors.map((m) => `${integration.id}/${m.id}`)),
    );
  }

  private record(event: string, actor: string, subject: string, detail: Record<string, unknown>): void {
    this.deps.audit.append({ at: this.deps.clock.now().toISOString(), actor, event, subject, detail });
  }
}
