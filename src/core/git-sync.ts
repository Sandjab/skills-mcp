import { EventEmitter } from "node:events";
import { stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import type { RefreshResult } from "../types/index.js";

export class GitSync extends EventEmitter {
  private git: SimpleGit;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRefreshing = false;
  private lastSyncTime: Date | null = null;

  constructor(
    private repoUrl: string,
    private branch: string,
    private localPath: string,
    private token?: string,
  ) {
    super();
    this.git = simpleGit();
  }

  async initialize(): Promise<void> {
    const repoExists = await this.isRepo();

    if (repoExists) {
      // Pull latest
      this.git = simpleGit(this.localPath);
      try {
        await this.git.fetch("origin", this.branch);
        await this.git.checkout(this.branch);
        await this.git.pull("origin", this.branch);
        this.lastSyncTime = new Date();
        console.error("[skills-mcp] [git] Pulled latest changes");
      } catch (err) {
        console.error("[skills-mcp] [git] Pull failed, using local cache:", err);
      }
    } else {
      // Clone
      await mkdir(path.dirname(this.localPath), { recursive: true });
      const cloneUrl = this.getAuthenticatedUrl();
      await simpleGit().clone(cloneUrl, this.localPath, ["--branch", this.branch, "--single-branch"]);
      this.git = simpleGit(this.localPath);
      this.lastSyncTime = new Date();
      console.error("[skills-mcp] [git] Cloned repository");
    }
  }

  startPeriodicRefresh(intervalMs: number): void {
    this.stopPeriodicRefresh();
    this.intervalId = setInterval(() => {
      this.forceRefresh().catch(err => {
        console.error("[skills-mcp] [git] Periodic refresh failed:", err);
      });
    }, intervalMs);
  }

  stopPeriodicRefresh(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async forceRefresh(): Promise<RefreshResult> {
    if (this.isRefreshing) {
      return {
        success: false,
        commitHash: "",
        filesChanged: 0,
        timestamp: new Date(),
      };
    }

    this.isRefreshing = true;
    try {
      const beforeHash = await this.git.revparse(["HEAD"]);

      await this.git.fetch("origin", this.branch);
      await this.git.pull("origin", this.branch);

      const afterHash = await this.git.revparse(["HEAD"]);
      const changed = beforeHash !== afterHash;

      let filesChanged = 0;
      if (changed) {
        try {
          const diff = await this.git.diffSummary([beforeHash, afterHash]);
          filesChanged = diff.files.length;
        } catch {
          filesChanged = -1; // Unknown
        }
      }

      this.lastSyncTime = new Date();

      if (changed) {
        this.emit("content-updated");
      }

      return {
        success: true,
        commitHash: afterHash.trim(),
        filesChanged,
        timestamp: this.lastSyncTime,
      };
    } catch (err) {
      console.error("[skills-mcp] [git] Refresh failed:", err);
      return {
        success: false,
        commitHash: "",
        filesChanged: 0,
        timestamp: new Date(),
      };
    } finally {
      this.isRefreshing = false;
    }
  }

  getLastSyncTime(): Date | null {
    return this.lastSyncTime;
  }

  getLocalPath(): string {
    return this.localPath;
  }

  private getAuthenticatedUrl(): string {
    if (!this.token) return this.repoUrl;

    try {
      const url = new URL(this.repoUrl);
      url.username = "x-access-token";
      url.password = this.token;
      return url.toString();
    } catch {
      // Not a valid URL, return as-is
      return this.repoUrl;
    }
  }

  private async isRepo(): Promise<boolean> {
    try {
      const s = await stat(path.join(this.localPath, ".git"));
      return s.isDirectory();
    } catch {
      return false;
    }
  }
}
