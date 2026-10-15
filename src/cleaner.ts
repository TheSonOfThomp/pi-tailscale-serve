/**
 * Dashboard Cleaner
 * Handles inactivity-based cleanup of dashboards
 */

import { setTimeout as sleep } from "node:timers/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { moveToTrash } from "./utils/filesystem";
import { TailscaleClient } from "./utils/tailscale";
import type { DashboardTracker, DashboardMetadata } from "./tracker";
import type { ExtensionConfig } from "./config";

export class DashboardCleaner {
  private tracker: DashboardTracker;
  private config: ExtensionConfig;
  private pi: ExtensionAPI;
  private tailscale: TailscaleClient;
  
  private cleanupInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;

  constructor(tracker: DashboardTracker, config: ExtensionConfig) {
    // We need access to pi for logging, but it's passed in start()
    // This is a workaround for the circular dependency
    this.tracker = tracker;
    this.config = config;
    this.tailscale = new TailscaleClient(config.retry);
    // @ts-ignore - pi is set in start()
    this.pi = null;
  }

  /**
   * Start the cleanup scheduler
   */
  start(pi: ExtensionAPI): void {
    this.pi = pi;
    this.running = true;

    // Initial cleanup
    this.cleanup().catch((error) => {
      this.pi.logger.error(`Initial cleanup failed: ${error}`);
    });

    // Schedule periodic cleanup (every 6 hours)
    const intervalMs = 6 * 60 * 60 * 1000; // 6 hours
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch((error) => {
        this.pi.logger.error(`Periodic cleanup failed: ${error}`);
      });
    }, intervalMs);

    this.pi.logger.info(`Dashboard cleaner started, checking every ${intervalMs / 1000 / 60 / 60} hours`);
  }

  /**
   * Stop the cleanup scheduler
   */
  stop(): void {
    this.running = false;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.pi.logger.info("Dashboard cleaner stopped");
  }

  /**
   * Perform cleanup of expired dashboards
   */
  private async cleanup(): Promise<void> {
    if (!this.running) return;

    const inactivityTimeoutMs = this.config.tailscaleServe.inactivityTimeoutDays * 24 * 60 * 60 * 1000;
    const dashboardsToClean = this.tracker.getDashboardsForCleanup(inactivityTimeoutMs);

    this.pi.logger.debug(`Found ${dashboardsToClean.length} dashboards to clean up`);

    for (const dashboard of dashboardsToClean) {
      await this.cleanupDashboard(dashboard).catch((error) => {
        this.pi.logger.error(`Failed to clean up dashboard ${dashboard.id}: ${error}`);
      });
    }
  }

  /**
   * Clean up a single dashboard
   */
  private async cleanupDashboard(metadata: DashboardMetadata): Promise<void> {
    this.pi.logger.info(`Cleaning up dashboard ${metadata.id} (${metadata.url})`);

    // Stop tailscale serve
    try {
      await this.tailscale.clear(metadata.path);
      this.pi.logger.debug(`Stopped tailscale serve for dashboard ${metadata.id}`);
    } catch (error) {
      this.pi.logger.warn(`Failed to stop tailscale serve for dashboard ${metadata.id}: ${error}`);
    }

    // Kill framework process if still running
    if (metadata.pid) {
      try {
        process.kill(metadata.pid, "SIGTERM");
        this.pi.logger.debug(`Sent SIGTERM to framework process ${metadata.pid}`);
      } catch (error) {
        this.pi.logger.warn(`Failed to kill framework process ${metadata.pid}: ${error}`);
      }
    }

    // Move dashboard files to trash
    try {
      await moveToTrash(metadata.path);
      this.pi.logger.debug(`Moved dashboard files to trash: ${metadata.path}`);
    } catch (error) {
      this.pi.logger.warn(`Failed to move dashboard files to trash: ${error}`);
    }

    // Remove from tracker
    await this.tracker.delete(metadata.id);
    this.pi.logger.info(`Successfully cleaned up dashboard ${metadata.id}`);
  }

  /**
   * Manually clean up a specific dashboard by ID
   */
  async cleanupById(id: string): Promise<boolean> {
    const metadata = this.tracker.getById(id);
    if (!metadata) {
      this.pi.logger.warn(`Dashboard ${id} not found for manual cleanup`);
      return false;
    }

    await this.cleanupDashboard(metadata);
    return true;
  }

  /**
   * Manually clean up a dashboard by identifier
   */
  async cleanupByIdentifier(identifier: { port?: number; url?: string; pid?: number; path?: string }): Promise<boolean> {
    const metadata = this.tracker.getByIdentifier(identifier);
    if (!metadata) {
      this.pi.logger.warn(`Dashboard not found for identifier: ${JSON.stringify(identifier)}`);
      return false;
    }

    await this.cleanupDashboard(metadata);
    return true;
  }
}
