/**
 * Get Dashboard Logs Tool
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DashboardTracker } from "../tracker";

interface GetLogsParams {
  id: string;
  tail?: number; // Number of lines to tail
}

interface GetLogsResult {
  logs: string;
  id: string;
  path?: string;
}

export function getLogsTool(tracker: DashboardTracker): ToolDefinition<GetLogsParams, GetLogsResult> {
  return {
    name: "get_dashboard_logs",
    description: "Get the logs for a specific dashboard by its ID. Useful for debugging framework dev servers or access issues. Examples: 'Show me the logs for dashboard abc123', 'Get logs for that React app', 'What are the errors for my dashboard?'.",
    params: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The dashboard ID",
        },
        tail: {
          type: "number",
          description: "Number of lines to return from the end (default: 100)",
          default: 100,
        },
      },
      required: ["id"],
    },
    handler: async (params, ctx) => {
      const metadata = tracker.getById(params.id);
      if (!metadata) {
        throw new Error(`Dashboard ${params.id} not found`);
      }

      const tail = params.tail ?? 100;

      // Check if we have a logs path
      if (metadata.logsPath) {
        try {
          const logs = await fs.readFile(metadata.logsPath, "utf-8");
          const lines = logs.split("\n");
          const tailLines = lines.slice(-tail);
          return {
            logs: tailLines.join("\n"),
            id: metadata.id,
            path: metadata.logsPath,
          };
        } catch (error) {
          throw new Error(`Failed to read logs: ${error}`);
        }
      }

      // No dedicated logs path - return empty
      return {
        logs: "",
        id: metadata.id,
        path: undefined,
      };
    },
  };
}
