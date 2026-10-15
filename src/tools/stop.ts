/**
 * Stop Dashboard Tool
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DashboardTracker } from "../tracker";
import { moveToTrash } from "../utils/filesystem";
import { TailscaleClient } from "../utils/tailscale";

interface StopParams {
  port?: number;
  url?: string;
  pid?: number;
  path?: string;
}

interface StopResult {
  success: boolean;
  message: string;
  id?: string;
}

export function stopTool(tracker: DashboardTracker): ToolDefinition<StopParams, StopResult> {
  const tailscale = new TailscaleClient({ maxAttempts: 3, baseDelayMs: 1000 });

  return {
    name: "stop",
    description: "Stop serving a dashboard and clean up its resources. Can identify by port, URL, PID, or local path. Examples: 'Stop dashboard on port 3000', 'Stop serving that dashboard', 'Clean up the React app I served earlier', 'Remove dashboard at /path/to/files'.",
    params: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "The port the dashboard is served on",
        },
        url: {
          type: "string",
          description: "The full Tailscale URL of the dashboard",
        },
        pid: {
          type: "number",
          description: "The process ID of the dashboard server",
        },
        path: {
          type: "string",
          description: "The local path of the dashboard",
        },
      },
      // At least one identifier must be provided
      required: [],
    },
    handler: async (params, ctx) => {
      // Validate that at least one identifier is provided
      if (!params.port && !params.url && !params.pid && !params.path) {
        throw new Error("At least one of port, url, pid, or path must be provided");
      }

      // Find the dashboard
      const identifier = {
        port: params.port,
        url: params.url,
        pid: params.pid,
        path: params.path,
      };

      const metadata = tracker.getByIdentifier(identifier);
      if (!metadata) {
        throw new Error(`No dashboard found matching the provided identifier`);
      }

      // Stop tailscale serve
      try {
        await tailscale.clear(metadata.path);
      } catch (error) {
        // Log but don't fail - might already be stopped
        ctx.logger?.warn(`Failed to stop tailscale serve: ${error}`);
      }

      // Kill framework process if still running
      if (metadata.pid) {
        try {
          process.kill(metadata.pid, "SIGTERM");
        } catch (error) {
          // Process might already be dead
          ctx.logger?.debug(`Process ${metadata.pid} already dead or couldn't be killed: ${error}`);
        }
      }

      // Move dashboard files to trash
      try {
        await moveToTrash(metadata.path);
      } catch (error) {
        ctx.logger?.warn(`Failed to move dashboard files to trash: ${error}`);
      }

      // Remove from tracker
      await tracker.delete(metadata.id);

      return {
        success: true,
        message: `Dashboard ${metadata.id} stopped and cleaned up`,
        id: metadata.id,
      };
    },
  };
}
