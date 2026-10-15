/**
 * Serve Next.js Dashboard Tool
 */

import { resolve } from "node:path";
import { promises as fs } from "node:fs";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DashboardTracker } from "../tracker";
import type { ExtensionConfig } from "../config";
import { TailscaleClient } from "../utils/tailscale";
import { validateDashboardPath, validateFrameworkDashboard } from "../utils/validation";
import { findProjectRoot } from "../utils/filesystem";
import { PortManager } from "../utils/port-manager";
import { ProcessManager } from "../utils/process-manager";

interface ServeNextParams {
  path: string;
  persist?: boolean;
  port?: number;
}

interface ServeNextResult {
  url: string;
  id: string;
  path: string;
  port: number;
  type: "next";
  persist: boolean;
  createdAt: string;
  frameworkPort?: number;
  warnings?: string[];
}

export function serveNextTool(
  tracker: DashboardTracker,
  config: ExtensionConfig
): ToolDefinition<ServeNextParams, ServeNextResult> {
  const tailscale = new TailscaleClient(config.retry);
  const portManager = new PortManager(config.tailscaleServe.portRange);
  const processManager = new ProcessManager();

  return {
    name: "serve_next",
    description: "Serve a Next.js app as a dashboard via Tailscale",
    params: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the Next.js app directory (containing package.json)",
        },
        persist: {
          type: "boolean",
          description: "Whether the dashboard should persist after session ends (default: true)",
          default: true,
        },
        port: {
          type: "number",
          description: "Optional: specific port to use for the Next.js dev server",
        },
      },
      required: ["path"],
    },
    handler: async (params, ctx) => {
      const resolvedPath = resolve(params.path);
      const persist = params.persist ?? true;

      // Find project root
      const projectRoot = await findProjectRoot(ctx.cwd);

      // Validate path is within project root
      const validation = await validateDashboardPath(resolvedPath, projectRoot);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Validate Next.js app
      const warnings = await validateFrameworkDashboard(resolvedPath, "next");

      // Check if directory exists, wait if not
      let directoryExists = false;
      const startTime = Date.now();
      const timeout = 120000; // 2 minutes

      while (Date.now() - startTime < timeout) {
        try {
          const stats = await fs.stat(resolvedPath);
          if (stats.isDirectory()) {
            directoryExists = true;
            break;
          }
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!directoryExists) {
        throw new Error(`Next.js app directory ${resolvedPath} did not appear within 2 minutes`);
      }

      // Find available port for Next.js dev server
      const frameworkPort = params.port ?? await portManager.findAvailablePort();

      // Start Next.js dev server
      const nextProcess = processManager.spawn(
        "npm",
        ["run", "dev", "--", "--port", frameworkPort.toString()],
        {
          cwd: resolvedPath,
          dashboardId: "pending",
        }
      );

      // Wait for Next.js server to start
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Check if process is still running
      if (nextProcess.killed || nextProcess.exitCode !== null) {
        throw new Error("Next.js dev server failed to start");
      }

      // Serve via tailscale
      const result = await tailscale.serve(`${frameworkPort}`, true);
      if (!result.success) {
        // Clean up Next.js process
        processManager.kill(nextProcess.pid!, "SIGTERM");
        throw new Error(`Failed to serve dashboard: ${result.error}`);
      }

      // Get hostname for URL construction
      const hostname = await tailscale.getHostname();
      const port = result.port || frameworkPort;
      const url = `https://${hostname}.ts.net:${port}`;

      // Update process manager with dashboard ID
      const processInfo = processManager.getByPid(nextProcess.pid!);
      if (processInfo) {
        processInfo.dashboardId = "pending";
      }

      // Create metadata
      const metadata = await tracker.create(
        resolvedPath,
        "next",
        url,
        port,
        persist,
        nextProcess.pid,
        result.pid,
        frameworkPort
      );

      // Update process dashboard ID
      if (processInfo) {
        processInfo.dashboardId = metadata.id;
      }

      return {
        url: metadata.url,
        id: metadata.id,
        path: metadata.path,
        port: metadata.port,
        type: "next",
        persist: metadata.persist,
        createdAt: metadata.createdAt,
        frameworkPort: metadata.frameworkPort,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    },
  };
}
