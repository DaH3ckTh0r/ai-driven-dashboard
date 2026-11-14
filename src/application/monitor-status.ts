export interface TickStatus {
  lastRunAt: string;
  state: "healthy" | "breached" | "unavailable" | "error";
  value?: number;
  metric?: string;
  error?: string;
}

export function monitorKey(integrationId: string, monitorId: string): string {
  return `${integrationId}/${monitorId}`;
}

/** Latest tick result per monitor. Held in memory: it describes the running process, not history. */
export class MonitorStatusBook {
  private readonly entries = new Map<string, TickStatus>();

  set(key: string, status: TickStatus): void {
    this.entries.set(key, status);
  }

  get(key: string): TickStatus | undefined {
    return this.entries.get(key);
  }
}
