import { describe, it, expect } from "vitest";
import { GitSync } from "../src/core/git-sync.js";

describe("GitSync", () => {
  it("can be instantiated", () => {
    const sync = new GitSync(
      "https://github.com/test/repo.git",
      "main",
      "/tmp/test-skills",
    );
    expect(sync).toBeInstanceOf(GitSync);
    expect(sync.getLocalPath()).toBe("/tmp/test-skills");
    expect(sync.getLastSyncTime()).toBeNull();
  });

  it("emits content-updated event", async () => {
    const sync = new GitSync(
      "https://github.com/test/repo.git",
      "main",
      "/tmp/test-skills",
    );
    let emitted = false;
    sync.on("content-updated", () => {
      emitted = true;
    });
    sync.emit("content-updated");
    expect(emitted).toBe(true);
  });

  it("stops periodic refresh", () => {
    const sync = new GitSync(
      "https://github.com/test/repo.git",
      "main",
      "/tmp/test-skills",
    );
    // Should not throw
    sync.stopPeriodicRefresh();
  });
});
