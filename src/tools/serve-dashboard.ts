/**
 * Serve Dashboard Tool (Auto-detection)
 */

import { resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DashboardTracker, DashboardType } from "../tracker";
import type { ExtensionConfig } from "../config";
import { detectDashboardType, validateDashboardPath } from "../utils/validation";
import { findProjectRoot } from "../utils/filesystem";

interface ServeDashboardParams {
  path: string;
  persist?: boolean;
}

interface ServeDashboardResult {
  url: string;
  id: string;
  path: string;
  port: number;
  type: DashboardType;
  persist: boolean;
  createdAt: string;
  warnings?: string[];
  options?: DashboardType[]; // If auto-detection was ambiguous
}

interface ServeDashboardToolDefinition extends ToolDefinition<ServeDashboardParams, ServeDashboardResult> {
  name: "serve_dashboard";
}

export function serveDashboardTool(
  tracker: DashboardTracker,
  config: ExtensionConfig
): ServeDashboardToolDefinition {
  return {
    name: "serve_dashboard",
    description: "Auto-detect and serve a dashboard via Tailscale. Supports static HTML, React, Vue, Next.js, and dynamic content.",
    params: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the dashboard directory or file",
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

      // Detect dashboard type
      const detectedType = await detectDashboardType(resolvedPath);

      if (!detectedType) {
        // Could not detect type - return options
        const possibleTypes: DashboardType[] = ["static", "react", "vue", "next", "dynamic"];
        return {
          url: "",
          id: "",
          path: resolvedPath,
          port: 0,
          type: "static", // default
          persist,
          createdAt: new Date().toISOString(),
          options: possibleTypes,
        };
      }

      // Delegate to the appropriate tool
      // Import dynamically to avoid circular dependencies
      const { serveStaticTool } = await import("./serve-static");
      const { serveReactTool } = await import("./serve-react");
      const { serveVueTool } = await import("./serve-vue");
      const { serveNextTool } = await import("./serve-next");
      const { serveDynamicTool } = await import("./serve-dynamic");

      const toolMap: Record<DashboardType, any> = {
        static: serveStaticTool(tracker, config),
        react: serveReactTool(tracker, config),
        vue: serveVueTool(tracker, config),
        next: serveNextTool(tracker, config),
        dynamic: serveDynamicTool(tracker, config),
      };

      const tool = toolMap[detectedType];
      if (!tool || !tool.handler) {
        throw new Error(`No handler for detected type: ${detectedType}`);
      }

      // Call the appropriate handler
      const result = await tool.handler(
        { path: params.path, persist: params.persist } as any,
        ctx
      );

      return result as ServeDashboardResult;
    },
  };
}
