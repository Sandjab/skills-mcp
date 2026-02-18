import type { AnalyticsConfig, AnalyticsEvent } from "../types/index.js";

export class Tracker {
  private queue: AnalyticsEvent[] = [];
  private serverId: string;

  constructor(private config: AnalyticsConfig) {
    this.serverId = `dev-${process.env.USER ?? process.env.USERNAME ?? "unknown"}`;
  }

  track(type: string, data: Record<string, unknown>): void {
    if (!this.config.enabled) return;

    const event: AnalyticsEvent = {
      type,
      timestamp: new Date().toISOString(),
      server_id: this.serverId,
      data,
    };

    this.queue.push(event);
    console.error(`[skills-mcp] [analytics] ${type}: ${JSON.stringify(data)}`);
  }

  flush(): AnalyticsEvent[] {
    const events = [...this.queue];
    this.queue = [];
    return events;
  }

  getQueueSize(): number {
    return this.queue.length;
  }
}
