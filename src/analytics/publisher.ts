import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AnalyticsConfig, AnalyticsEvent } from "../types/index.js";
import type { Tracker } from "./tracker.js";

const BUFFER_FILE = path.join(os.homedir(), ".skills-mcp", "analytics-buffer.jsonl");

export class Publisher {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private tracker: Tracker,
    private config: AnalyticsConfig,
  ) {}

  start(intervalMs: number = 30_000): void {
    if (!this.config.enabled || !this.config.endpoint) return;

    this.intervalId = setInterval(() => {
      this.publish().catch(err => {
        console.error("[skills-mcp] [publisher] Error:", err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async publish(): Promise<void> {
    const events = this.tracker.flush();
    if (events.length === 0) return;

    // Try to flush local buffer first
    const buffered = await this.readBuffer();
    const allEvents = [...buffered, ...events];

    if (this.config.endpoint) {
      try {
        const response = await fetch(this.config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: allEvents }),
        });
        if (response.ok) {
          // Clear the buffer file on success
          await this.clearBuffer();
          console.error(`[skills-mcp] [publisher] Published ${allEvents.length} events`);
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (err) {
        console.error("[skills-mcp] [publisher] HTTP failed, falling back to file:", err);
      }
    }

    // Fallback: write to local file
    await this.writeBuffer(events);
  }

  private async readBuffer(): Promise<AnalyticsEvent[]> {
    try {
      const content = await readFile(BUFFER_FILE, "utf-8");
      return content
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  private async writeBuffer(events: AnalyticsEvent[]): Promise<void> {
    const lines = events.map(e => JSON.stringify(e)).join("\n") + "\n";
    try {
      await appendFile(BUFFER_FILE, lines);
    } catch (err) {
      console.error("[skills-mcp] [publisher] Failed to write buffer:", err);
    }
  }

  private async clearBuffer(): Promise<void> {
    try {
      await writeFile(BUFFER_FILE, "");
    } catch {
      // Ignore
    }
  }
}
