import { describe, it, expect, vi, beforeEach } from "vitest";
import { Tracker } from "../../src/analytics/tracker.js";
import type { AnalyticsConfig } from "../../src/types/index.js";

describe("Tracker", () => {
  it("does not queue events when disabled", () => {
    const config: AnalyticsConfig = { enabled: false };
    const tracker = new Tracker(config);
    tracker.track("test_event", { key: "value" });
    expect(tracker.getQueueSize()).toBe(0);
  });

  it("queues events when enabled", () => {
    const config: AnalyticsConfig = { enabled: true };
    const tracker = new Tracker(config);
    tracker.track("test_event", { key: "value" });
    expect(tracker.getQueueSize()).toBe(1);
  });

  it("flush returns and clears queue", () => {
    const config: AnalyticsConfig = { enabled: true };
    const tracker = new Tracker(config);
    tracker.track("event1", { a: 1 });
    tracker.track("event2", { b: 2 });

    const events = tracker.flush();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("event1");
    expect(events[1].type).toBe("event2");
    expect(tracker.getQueueSize()).toBe(0);
  });

  it("includes timestamp and server_id in events", () => {
    const config: AnalyticsConfig = { enabled: true };
    const tracker = new Tracker(config);
    tracker.track("test", {});

    const events = tracker.flush();
    expect(events[0].timestamp).toBeTruthy();
    expect(events[0].server_id).toBeTruthy();
  });
});
