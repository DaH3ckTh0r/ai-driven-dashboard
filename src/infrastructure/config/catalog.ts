import type { IntegrationCatalog, IntegrationRecord } from "../../application/ports.js";

/** The integrations and groups loaded from disk at startup. Read-only for the life of the process. */
export class StaticCatalog implements IntegrationCatalog {
  constructor(private readonly records: IntegrationRecord[]) {}

  list(): IntegrationRecord[] {
    return [...this.records];
  }

  find(integrationId: string): IntegrationRecord | undefined {
    return this.records.find((r) => r.integration.id === integrationId);
  }
}
