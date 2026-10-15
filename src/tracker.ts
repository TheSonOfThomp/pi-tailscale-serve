/**
 * Dashboard Tracker
 * Manages metadata and state for all active dashboards
 */

import { promises as fs } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type DashboardType = "static" | "react" | "vue" | "next" | "dynamic";

export interface DashboardMetadata {
  id: string;
  path: string;
  type: DashboardType;
  url: string;
  port: number;
  pid?: number;
  tailscalePid?: number;
  persist: boolean;
  createdAt: string;
  lastAccessAt: string;
  accessCount: number;
  servedBy: string;
  frameworkPort?: number;
  logsPath?: string;
}

export interface DashboardIdentifier {
  port?: number;
  url?: string;
  pid?: number;
  path?: string;
}

export class DashboardTracker {
  private pi: ExtensionAPI;
  private dashboards: Map<string, DashboardMetadata> = new Map();

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  /**
   * Create a new dashboard metadata entry
   */
  async create(
    path: string,
    type: DashboardType,
    url: string,
    port: number,
    persist: boolean,
    pid?: number,
    tailscalePid?: number,
    frameworkPort?: number,
    logsPath?: string
  ): Promise<DashboardMetadata> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const metadata: DashboardMetadata = {
      id,
      path: resolve(path),
      type,
      url,
      port,
      pid,
      tailscalePid,
      persist,
      createdAt: now,
      lastAccessAt: now,
      accessCount: 0,
      servedBy: "tailscale-serve",
      frameworkPort,
      logsPath,
    };

    this.dashboards.set(id, metadata);
    await this.saveMetadata(metadata);

    this.pi.logger.debug(`Created dashboard ${id} at ${url}`);

    return metadata;
  }

  /**
   * Update access timestamp for a dashboard
   */
  async updateAccess(id: string): Promise<void> {
    const metadata = this.dashboards.get(id);
    if (!metadata) {
      this.pi.logger.warn(`Dashboard ${id} not found for access update`);
      return;
    }

    metadata.lastAccessAt = new Date().toISOString();
    metadata.accessCount++;

    await this.saveMetadata(metadata);
    this.pi.logger.debug(`Updated access for dashboard ${id}, count: ${metadata.accessCount}`);
  }

  /**
   * Get dashboard by ID
   */
  getById(id: string): DashboardMetadata | undefined {
    return this.dashboards.get(id);
  }

  /**
   * Get dashboard by port
   */
  getByPort(port: number): DashboardMetadata | undefined {
    for (const metadata of this.dashboards.values()) {
      if (metadata.port === port) {
        return metadata;
      }
    }
    return undefined;
  }

  /**
   * Get dashboard by URL
   */
  getByUrl(url: string): DashboardMetadata | undefined {
    for (const metadata of this.dashboards.values()) {
      if (metadata.url === url) {
        return metadata;
      }
    }
    return undefined;
  }

  /**
   * Get dashboard by local path
   */
  getByPath(path: string): DashboardMetadata | undefined {
    const resolvedPath = resolve(path);
    for (const metadata of this.dashboards.values()) {
      if (metadata.path === resolvedPath) {
        return metadata;
      }
    }
    return undefined;
  }

  /**
   * Get dashboard by PID (either framework PID or tailscale PID)
   */
  getByPid(pid: number): DashboardMetadata | undefined {
    for (const metadata of this.dashboards.values()) {
      if (metadata.pid === pid || metadata.tailscalePid === pid) {
        return metadata;
      }
    }
    return undefined;
  }

  /**
   * Get dashboard by any identifier
   */
  getByIdentifier(identifier: DashboardIdentifier): DashboardMetadata | undefined {
    if (identifier.port !== undefined) {
      return this.getByPort(identifier.port);
    }
    if (identifier.url !== undefined) {
      return this.getByUrl(identifier.url);
    }
    if (identifier.pid !== undefined) {
      return this.getByPid(identifier.pid);
    }
    if (identifier.path !== undefined) {
      return this.getByPath(identifier.path);
    }
    return undefined;
  }

  /**
   * List all active dashboards
   */
  list(): DashboardMetadata[] {
    return Array.from(this.dashboards.values());
  }

  /**
   * Delete a dashboard and its metadata
   */
  async delete(id: string): Promise<void> {
    const metadata = this.dashboards.get(id);
    if (!metadata) {
      this.pi.logger.warn(`Dashboard ${id} not found for deletion`);
      return;
    }

    this.dashboards.delete(id);
    await this.deleteMetadata(metadata);
    this.pi.logger.debug(`Deleted dashboard ${id}`);
  }

  /**
   * Save metadata to disk
   */
  private async saveMetadata(metadata: DashboardMetadata): Promise<void> {
    const metaPath = join(dirname(metadata.path), ".tailscale-dashboard-meta.json");
    try {
      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
      this.pi.logger.debug(`Saved metadata for dashboard ${metadata.id} to ${metaPath}`);
    } catch (error) {
      this.pi.logger.error(`Failed to save metadata for dashboard ${metadata.id}: ${error}`);
    }
  }

  /**
   * Delete metadata file from disk
   */
  private async deleteMetadata(metadata: DashboardMetadata): Promise<void> {
    const metaPath = join(dirname(metadata.path), ".tailscale-dashboard-meta.json");
    try {
      await fs.unlink(metaPath);
      this.pi.logger.debug(`Deleted metadata file for dashboard ${metadata.id}`);
    } catch (error) {
      this.pi.logger.debug(`Metadata file not found for dashboard ${metadata.id}: ${error}`);
    }
  }

  /**
   * Load all dashboards from disk metadata files
   * Called during extension initialization
   */
  async loadFromDisk(): Promise<void> {
    // This would require scanning the filesystem for .tailscale-dashboard-meta.json files
    // For now, we rely on in-memory tracking
    this.pi.logger.debug("Dashboard tracker initialized (in-memory only)");
  }

  /**
   * Check if a port is already in use
   */
  isPortInUse(port: number): boolean {
    for (const metadata of this.dashboards.values()) {
      if (metadata.port === port) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all dashboards that should be cleaned up (non-persistent or expired)
   */
  getDashboardsForCleanup(inactivityTimeoutMs: number): DashboardMetadata[] {
    const now = Date.now();
    const result: DashboardMetadata[] = [];

    for (const metadata of this.dashboards.values()) {
      // Non-persistent dashboards are always candidates
      if (!metadata.persist) {
        result.push(metadata);
        continue;
      }

      // Check inactivity timeout
      const lastAccess = new Date(metadata.lastAccessAt).getTime();
      const inactiveMs = now - lastAccess;

      if (inactiveMs > inactivityTimeoutMs) {
        result.push(metadata);
      }
    }

    return result;
  }
}
