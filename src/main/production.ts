// Production adapters: the only place that picks real Azure, APIM, SQLite and process services.
import { DefaultAzureCredential } from "@azure/identity";
import type { Application } from "./wire.js";
import { wire } from "./wire.js";
import { StaticCatalog } from "../infrastructure/config/catalog.js";
import { loadGroups, loadIntegrationRecords } from "../infrastructure/config/loader.js";
import { createAzureClients } from "../infrastructure/azure/clients.js";
import { HttpHealthReader, KqlReader, QueueDepthReader, ServiceBusReader, SignalReaders } from "../infrastructure/signals/readers.js";
import { ApimChatClient } from "../infrastructure/llm/apim-chat.js";
import { ScriptRunner } from "../infrastructure/actions/script-runner.js";
import { openDatabase } from "../infrastructure/persistence/database.js";
import { createSqlitePersistence } from "../infrastructure/persistence/sqlite-repositories.js";
import { RandomIds, SystemClock } from "../infrastructure/system/clock-and-ids.js";
import { Approvers } from "../domain/approvers.js";

export interface ProductionOptions {
  integrationsRoot: string;
  apimChatUrl: string;
  apimSubscriptionKey?: string;
  dbPath: string;
  approvers: string[];
}

export interface Runtime {
  app: Application;
  catalog: StaticCatalog;
  persistence: ReturnType<typeof createSqlitePersistence>;
  close: () => void;
}

/** Loads the integration folder and wires real adapters. Throws ConfigValidationError on bad config. */
export async function buildRuntime(options: ProductionOptions): Promise<Runtime> {
  const records = await loadIntegrationRecords(options.integrationsRoot);
  const catalog = new StaticCatalog(records);
  const fileGroups = await loadGroups(options.integrationsRoot, records);
  const credential = new DefaultAzureCredential();
  const azure = createAzureClients(credential);
  const db = openDatabase(options.dbPath);

  const persistence = createSqlitePersistence(db);
  const app = wire({
    catalog,
    signals: new SignalReaders({
      http: new HttpHealthReader(),
      kql: new KqlReader(azure.logs),
      queues: new QueueDepthReader(azure.queues),
      bus: new ServiceBusReader(azure.bus),
    }),
    model: new ApimChatClient({
      endpoint: options.apimChatUrl,
      subscriptionKey: options.apimSubscriptionKey,
      bearerToken: async () => (await credential.getToken("https://cognitiveservices.azure.com/.default")).token,
    }),
    actions: new ScriptRunner(),
    persistence,
    clock: new SystemClock(),
    ids: new RandomIds(),
    approvers: new Approvers(options.approvers),
  });
  app.groups.seedFromFile(fileGroups);
  return { app, catalog, persistence, close: () => db.close() };
}
