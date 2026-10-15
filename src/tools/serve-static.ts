/**
 * Serve Static Dashboard Tool
 */

import { resolve } from "node:path";
import { promises as fs } from "node:fs";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DashboardTracker } from "../tracker";
import type { ExtensionConfig } from "../config";
import { TailscaleClient } from "../utils/tailscale";
import { validateDashboardPath, validateStaticDashboard } from "../utils/validation";
import { findProjectRoot } from "../utils/filesystem";

interface ServeStaticParams {
  path: string;
  persist?: boolean;
}

interface ServeStaticResult {
  url: string;
  id: string;
  path: string;
  port: number;
  type: "static";
  persist: boolean;
  createdAt: string;
  warnings?: string[];
}

export function serveStaticTool(
  tracker: DashboardTracker,
  config: ExtensionConfig
): ToolDefinition<ServeStaticParams, ServeStaticResult> {
  const tailscale = new TailscaleClient(config.retry);

  return {
    name: "serve_static",
    description: "Serve static HTML, CSS, and JavaScript files as a dashboard via Tailscale. Use for plain HTML websites, single-page apps, or static site generators like Hugo/Jekyll. Examples: 'Serve these static files', 'Host this HTML directory'.",
    params: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the directory containing static files",
        },
        persist: {
          type: "boolean",
          description: "Whether the dashboard should persist after session ends (default: true)",
          default: true,
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
        throw new Error(`Directory ${resolvedPath} did not appear within 2 minutes`);
      }

      // Validate dashboard content
      const warnings = await validateStaticDashboard(resolvedPath);

      // Check for port conflicts
      if (tracker.isPortInUse(0)) {
        // We'll let tailscale choose the port, but we need to track it
      }

      // Serve via tailscale
      const result = await tailscale.serve(resolvedPath, true);
      if (!result.success) {
        throw new Error(`Failed to serve dashboard: ${result.error}`);
      }

      // Get hostname for URL construction
      const hostname = await tailscale.getHostname();
      const port = result.port || 0;
      const url = `https://${hostname}.ts.net:${port}`;

      // Create metadata
      const metadata = await tracker.create(
        resolvedPath,
        "static",
        url,
        port,
        persist,
        undefined,
        result.pid
      );

      return {
        url: metadata.url,
        id: metadata.id,
        path: metadata.path,
        port: metadata.port,
        type: "static",
        persist: metadata.persist,
        createdAt: metadata.createdAt,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    },
  };
}
