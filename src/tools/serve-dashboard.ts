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
  path?: string;
  content?: string;
  type?: "static" | "react" | "vue" | "next" | "dynamic" | "markdown" | "json";
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
    description: "Serve a dashboard, website, or web app via Tailscale. Auto-detects static HTML, React, Vue, Next.js, or dynamic content. Use when you want to share a dashboard with others on your tailnet. Examples: 'Serve this folder', 'Make this React app accessible', 'Share this HTML file', 'Host this dashboard'.",
    params: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the dashboard directory or file. Defaults to current directory if omitted. If content is provided instead, creates a temporary dashboard.",
        },
        content: {
          type: "string",
          description: "Raw content to serve (HTML, Markdown, or JSON). If provided without path, creates a temporary file/dashboard.",
        },
        type: {
          type: "string",
          enum: ["static", "react", "vue", "next", "dynamic", "markdown", "json"],
          description: "Explicit type override. Auto-detected if not provided.",
        },
        persist: {
          type: "boolean",
          description: "Whether the dashboard should persist after session ends (default: true)",
          default: true,
        },
      },
      // Either path or content must be provided
      required: [],
    },
    handler: async (params, ctx) => {
      const persist = params.persist ?? true;
      
      // Handle content-only mode (no path provided)
      if (!params.path && params.content) {
        // Create a temporary dashboard from the content
        const { serveDynamicTool } = await import("./serve-dynamic");
        const dynamicTool = serveDynamicTool(tracker, config);
        
        // Determine type from content or explicit type
        let contentType: "json" | "markdown" | "md" = "markdown";
        if (params.type === "json") {
          contentType = "json";
        } else if (params.type === "markdown" || params.type === "md") {
          contentType = "md";
        } else if (params.content.trim().startsWith("{") || params.content.trim().startsWith("[")) {
          contentType = "json";
        }
        
        const result = await dynamicTool.handler(
          { content: params.content, type: contentType, persist } as any,
          ctx
        );
        return result as ServeDashboardResult;
      }

      // Path-based mode
      let resolvedPath: string;
      if (!params.path) {
        // Default to current working directory if no path specified
        resolvedPath = ctx.cwd;
      } else {
        resolvedPath = resolve(params.path);
      }

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
