import type { MonitoringService } from "./monitoring.js";
import type { IntegrationCatalog } from "./ports.js";

export type Cancel = () => void;
/** Runs `task` every `everyMs` milliseconds until cancelled. Injected so the policy is testable. */
export type Schedule = (task: () => void, everyMs: number) => Cancel;

export interface SchedulerDeps {
  monitoring: MonitoringService;
  catalog: IntegrationCatalog;
  schedule: Schedule;
  onError: (err: unknown, where: string) => void;
}

/** Starts one recurring tick per enabled monitor, at the interval of its signal. */
export class MonitorScheduler {
  private cancels: Cancel[] = [];

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    for (const { integration } of this.deps.catalog.list()) {
      for (const monitor of integration.monitors.filter((m) => m.enabled)) {
        const signal = integration.signals.find((s) => s.id === monitor.signal);
        if (!signal) continue;
        const where = `${integration.id}/${monitor.id}`;
        this.cancels.push(
          this.deps.schedule(() => {
            this.deps.monitoring.tick(integration.id, monitor.id).catch((err: unknown) => this.deps.onError(err, where));
          }, signal.intervalSec * 1000),
        );
      }
    }
  }

  stop(): void {
    for (const cancel of this.cancels.splice(0)) cancel();
  }
}
