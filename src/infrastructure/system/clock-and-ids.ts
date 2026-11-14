import { randomUUID } from "node:crypto";
import type { Clock, IdGenerator } from "../../application/ports.js";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class RandomIds implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}
