/**
 * List Dashboards Tool
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DashboardTracker, DashboardMetadata } from "../tracker";

interface ListDashboardsResult {
  dashboards: DashboardMetadata[];
  count: number;
}

export function listDashboardsTool(
  tracker: DashboardTracker
): ToolDefinition<{}, ListDashboardsResult> {
  return {
    name: "list_dashboards",
    description: "List all active dashboards served via Tailscale",
    params: {
      type: "object",
      properties: {},
    },
    handler: async (_, ctx) => {
      const dashboards = tracker.list();

      // Sort by creation date, newest first
      dashboards.sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      return {
        dashboards,
        count: dashboards.length,
      };
    },
  };
}
