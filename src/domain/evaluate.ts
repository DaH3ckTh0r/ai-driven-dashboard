import { DomainError } from "./errors.js";
import type { Evaluation, MonitorDef, Operator } from "./model.js";

const COMPARE: Record<Operator, (value: number, threshold: number) => boolean> = {
  gt: (v, t) => v > t,
  gte: (v, t) => v >= t,
  lt: (v, t) => v < t,
  lte: (v, t) => v <= t,
  eq: (v, t) => v === t,
  ne: (v, t) => v !== t,
};

/** Compares one metric with the monitor's condition. Pure. */
export function evaluateCondition(
  monitor: Pick<MonitorDef, "id" | "metric" | "operator" | "threshold">,
  metrics: Record<string, number>,
): Evaluation {
  const value = metrics[monitor.metric];
  if (value === undefined) {
    const available = Object.keys(metrics).join(", ") || "none";
    throw new DomainError(
      `monitor "${monitor.id}" expects metric "${monitor.metric}" but the signal produced: ${available}`,
      "bad-input",
    );
  }
  return {
    breached: COMPARE[monitor.operator](value, monitor.threshold),
    metric: monitor.metric,
    value,
    operator: monitor.operator,
    threshold: monitor.threshold,
  };
}
