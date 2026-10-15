/**
 * Pi Tailscale Serve Extension
 * Main entry point
 *
 * Enables Pi agents to serve temporary dashboards via Tailscale.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { serveStaticTool } from "./tools/serve-static";
import { serveReactTool } from "./tools/serve-react";
import { serveVueTool } from "./tools/serve-vue";
import { serveNextTool } from "./tools/serve-next";
import { serveDynamicTool } from "./tools/serve-dynamic";
import { serveDashboardTool } from "./tools/serve-dashboard";
import { listDashboardsTool } from "./tools/list-dashboards";
import { stopTool } from "./tools/stop";
import { getLogsTool } from "./tools/get-logs";

import { DashboardTracker } from "./tracker";
import { DashboardCleaner } from "./cleaner";
import { loadConfig, type ExtensionConfig } from "./config";

export default function (pi: ExtensionAPI) {
  // Load configuration
  const config: ExtensionConfig = loadConfig(pi);

  // Initialize tracker and cleaner
  const tracker = new DashboardTracker(pi);
  const cleaner = new DashboardCleaner(tracker, config);

  // Register tools with namespace
  const tools = [
    serveStaticTool(tracker, config),
    serveReactTool(tracker, config),
    serveVueTool(tracker, config),
    serveNextTool(tracker, config),
    serveDynamicTool(tracker, config),
    serveDashboardTool(tracker, config),
    listDashboardsTool(tracker),
    stopTool(tracker),
    getLogsTool(tracker),
  ];

  for (const tool of tools) {
    // Add namespace prefix to tool names
    const namespacedTool = {
      ...tool,
      name: `tailscale-serve.${tool.name}`,
    };
    pi.registerTool(namespacedTool);
  }

  // Register lifecycle hooks
  pi.on("session_start", () => {
    cleaner.start();
  });

  pi.on("session_shutdown", () => {
    cleaner.stop();
  });

  // Log initialization
  pi.logger.info("tailscale-serve extension loaded");
}
