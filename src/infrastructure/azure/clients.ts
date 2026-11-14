import type { TokenCredential } from "@azure/identity";
import { LogsQueryClient, LogsQueryResultStatus } from "@azure/monitor-query";
import { QueueServiceClient } from "@azure/storage-queue";
import { ServiceBusAdministrationClient } from "@azure/service-bus";

/** Narrow views of the Azure SDK, so readers can be tested without Azure. */
export interface LogsClient {
  query(workspaceId: string, kql: string, windowMinutes: number): Promise<{ columns: string[]; rows: unknown[][] }>;
}

export interface QueueClient {
  approximateMessageCount(accountUrl: string, queueName: string): Promise<number>;
}

export interface ServiceBusClient {
  runtimeCounts(namespace: string, queueName: string): Promise<{ active: number; deadLetter: number; scheduled: number; total: number }>;
}

export interface AzureClients {
  logs: LogsClient;
  queues: QueueClient;
  bus: ServiceBusClient;
}

export function createAzureClients(credential: TokenCredential): AzureClients {
  const logs = new LogsQueryClient(credential);
  return {
    logs: {
      async query(workspaceId, kql, windowMinutes) {
        const result = await logs.queryWorkspace(workspaceId, kql, { duration: `PT${windowMinutes}M` });
        if (result.status !== LogsQueryResultStatus.Success) {
          throw new Error(result.partialError?.message ?? "query failed");
        }
        const table = result.tables[0];
        return {
          columns: (table?.columnDescriptors ?? []).map((c) => c.name ?? ""),
          rows: table?.rows ?? [],
        };
      },
    },
    queues: {
      async approximateMessageCount(accountUrl, queueName) {
        const props = await new QueueServiceClient(accountUrl, credential).getQueueClient(queueName).getProperties();
        return props.approximateMessagesCount ?? 0;
      },
    },
    bus: {
      async runtimeCounts(namespace, queueName) {
        const props = await new ServiceBusAdministrationClient(namespace, credential).getQueueRuntimeProperties(queueName);
        return {
          active: props.activeMessageCount,
          deadLetter: props.deadLetterMessageCount,
          scheduled: props.scheduledMessageCount ?? 0,
          total: props.totalMessageCount ?? 0,
        };
      },
    },
  };
}
