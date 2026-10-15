/**
 * Serve React Dashboard Tool
 */

import { resolve, join } from "node:path";
import { promises as fs } from "node:fs";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DashboardTracker } from "../tracker";
import type { ExtensionConfig } from "../config";
import { TailscaleClient } from "../utils/tailscale";
import { validateDashboardPath, validateFrameworkDashboard } from "../utils/validation";
import { findProjectRoot, createTempDashboardDir } from "../utils/filesystem";
import { PortManager } from "../utils/port-manager";
import { ProcessManager } from "../utils/process-manager";

interface ServeReactParams {
  path: string;
  persist?: boolean;
  port?: number; // Optional: specific port to use
}

interface ServeReactResult {
  url: string;
  id: string;
  path: string;
  port: number;
  type: "react";
  persist: boolean;
  createdAt: string;
  frameworkPort?: number;
  warnings?: string[];
}

export function serveReactTool(
  tracker: DashboardTracker,
  config: ExtensionConfig
): ToolDefinition<ServeReactParams, ServeReactResult> {
  const tailscale = new TailscaleClient(config.retry);
  const portManager = new PortManager(config.tailscaleServe.portRange);
  const processManager = new ProcessManager();

  return {
    name: "serve_react",
    description: "Serve a React application as a dashboard via Tailscale. Auto-detects and starts the React dev server. Examples: 'Serve this React app', 'Host my React dashboard', 'Make this CRA/Vite app accessible'.",
    params: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the React app directory (containing package.json)",
        },
        persist: {
          type: "boolean",
          description: "Whether the dashboard should persist after session ends (default: true)",
          default: true,
        },
        port: {
          type: "number",
          description: "Optional: specific port to use for the React dev server",
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

      // Validate React app
      const warnings = await validateFrameworkDashboard(resolvedPath, "react");

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
        throw new Error(`React app directory ${resolvedPath} did not appear within 2 minutes`);
      }

      // Find available port for React dev server
      const frameworkPort = params.port ?? await portManager.findAvailablePort();

      // Start React dev server
      const reactProcess = processManager.spawn(
        "npm",
        ["run", "dev", "--", "--port", frameworkPort.toString()],
        {
          cwd: resolvedPath,
          dashboardId: "pending", // Will be updated after creation
        }
      );

      // Wait for React server to start
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Check if process is still running
      if (reactProcess.killed || reactProcess.exitCode !== null) {
        throw new Error("React dev server failed to start");
      }

      // Get the actual port (might differ from requested if port was in use)
      // For now, we'll use the requested port
      // In a more robust implementation, we'd parse the output to get the actual port

      // Serve via tailscale
      const result = await tailscale.serve(`${frameworkPort}`, true);
      if (!result.success) {
        // Clean up React process
        processManager.kill(reactProcess.pid!, "SIGTERM");
        throw new Error(`Failed to serve dashboard: ${result.error}`);
      }

      // Get hostname for URL construction
      const hostname = await tailscale.getHostname();
      const port = result.port || frameworkPort;
      const url = `https://${hostname}.ts.net:${port}`;

      // Update process manager with dashboard ID
      const processInfo = processManager.getByPid(reactProcess.pid!);
      if (processInfo) {
        processInfo.dashboardId = "pending"; // Will be updated below
      }

      // Create metadata
      const metadata = await tracker.create(
        resolvedPath,
        "react",
        url,
        port,
        persist,
        reactProcess.pid,
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
        type: "react",
        persist: metadata.persist,
        createdAt: metadata.createdAt,
        frameworkPort: metadata.frameworkPort,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    },
  };
}
