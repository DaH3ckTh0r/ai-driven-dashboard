import { DomainError } from "./errors.js";

/**
 * Who may change state: approve, reject, dry-run and resolve. Everyone signed in may view.
 * Least privilege: the list is explicit, and an empty list allows nobody.
 */
export class Approvers {
  private readonly names: ReadonlySet<string>;

  constructor(names: readonly string[]) {
    this.names = new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean));
  }

  allows(user: string): boolean {
    return this.names.has(user.trim().toLowerCase());
  }

  require(user: string): void {
    if (!this.allows(user)) throw new DomainError(`"${user}" is not allowed to approve or change issues`, "forbidden");
  }
}
