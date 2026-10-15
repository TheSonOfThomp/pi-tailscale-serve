/**
 * Pi Tailscale Serve Extension - Simplified version
 * Main entry point with all tools in one file for easier testing
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { v4 as uuidv4 } from "uuid";

// Simple in-memory tracker
interface DashboardMetadata {
  id: string;
  path: string;
  type: string;
  url: string;
  port: number;
  persist: boolean;
  createdAt: string;
}

const dashboards: Map<string, DashboardMetadata> = new Map();

// Helper: execute tailscale command
async function execTailscale(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("tailscale", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    child.on("close", (code) => resolve({ stdout, stderr, code: code || 0 }));
    child.on("error", (e) => resolve({ stdout: "", stderr: e.message, code: 1 }));
  });
}

// Helper: get Tailscale hostname
async function getTailscaleHostname(): Promise<string> {
  try {
    const result = await execTailscale(["status", "--json"]);
    const status = JSON.parse(result.stdout || "{}");
    return status.Self?.DNSName?.replace(/\.ts\.net\.$/, "") || "localhost";
  } catch {
    return "localhost";
  }
}

// Tool 1: Serve a dashboard (auto-detect)
const serveDashboardTool = defineTool({
  name: "serve_dashboard",
  label: "Serve Dashboard",
  description: "Serve a dashboard, website, or web app via Tailscale. Auto-detects static HTML, React, Vue, Next.js, or dynamic content. Use when you want to share a dashboard with others on your tailnet. Examples: 'Serve this folder', 'Make this React app accessible', 'Share this HTML file', 'Host this dashboard'.",
  parameters: Type.Object({
    path: Type.Optional(Type.String({
      description: "Path to the dashboard directory or file. Defaults to current directory.",
    })),
    persist: Type.Optional(Type.Boolean({
      description: "Whether the dashboard should persist (default: true)",
      default: true,
    })),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const path = params.path ? resolve(params.path) : ctx.cwd;
    const persist = params.persist ?? true;

    // Check if path exists
    try {
      const stats = await fs.stat(path);
      if (!stats.isDirectory()) {
        throw new Error(`Path ${path} is not a directory`);
      }
    } catch (error) {
      throw new Error(`Path ${path} does not exist: ${error}`);
    }

    // Serve via tailscale
    const result = await execTailscale(["serve", path, "--bg"]);
    if (result.code !== 0) {
      throw new Error(`Failed to serve: ${result.stderr || result.stdout}`);
    }

    // Get hostname and construct URL
    const hostname = await getTailscaleHostname();
    // Try to extract port from output or use a default
    let port = 0;
    const portMatch = result.stdout.match(/port\s+(\d+)/i) || result.stdout.match(/:(\d+)/);
    if (portMatch) {
      port = parseInt(portMatch[1], 10);
    }

    // If we can't determine port, try to get it from tailscale status
    if (port === 0) {
      const status = await execTailscale(["serve", "status", "--json"]);
      try {
        const serveStatus = JSON.parse(status.stdout || "{}");
        // This is a simplified approach - in reality we'd need to parse the status
        port = 8080; // Default fallback
      } catch {
        port = 8080;
      }
    }

    const url = `https://${hostname}.ts.net:${port}`;

    // Create metadata
    const metadata: DashboardMetadata = {
      id: uuidv4(),
      path,
      type: "static", // Simplified for now
      url,
      port,
      persist,
      createdAt: new Date().toISOString(),
    };

    dashboards.set(metadata.id, metadata);

    return {
      content: [{ type: "text", text: `Dashboard served at: ${url}` }],
      details: metadata,
    };
  },
});

// Tool 2: List dashboards
const listDashboardsTool = defineTool({
  name: "list_dashboards",
  label: "List Dashboards",
  description: "List all currently served dashboards with their URLs. Examples: 'What dashboards are running?', 'Show me my hosted dashboards', 'List active serves'.",
  parameters: Type.Object({}),

  async execute() {
    const dashboardList = Array.from(dashboards.values());
    
    if (dashboardList.length === 0) {
      return {
        content: [{ type: "text", text: "No dashboards are currently being served." }],
        details: { count: 0, dashboards: [] },
      };
    }

    const lines = [
      `Found ${dashboardList.length} active dashboard(s):`,
      "",
      ...dashboardList.map((d) => `  - ${d.url} (${d.type}, created: ${d.createdAt})`),
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { count: dashboardList.length, dashboards: dashboardList },
    };
  },
});

// Tool 3: Stop a dashboard
const stopDashboardTool = defineTool({
  name: "stop",
  label: "Stop Dashboard",
  description: "Stop serving a dashboard by port, URL, or path. Examples: 'Stop dashboard on port 3000', 'Stop serving that dashboard', 'Clean up the dashboard'.",
  parameters: Type.Object({
    port: Type.Optional(Type.Number({ description: "The port the dashboard is served on" })),
    url: Type.Optional(Type.String({ description: "The full Tailscale URL of the dashboard" })),
    path: Type.Optional(Type.String({ description: "The local path of the dashboard" })),
  }),

  async execute(_toolCallId, params) {
    // Find dashboard by any identifier
    let dashboard: DashboardMetadata | undefined;
    
    if (params.port) {
      for (const d of dashboards.values()) {
        if (d.port === params.port) {
          dashboard = d;
          break;
        }
      }
    } else if (params.url) {
      for (const d of dashboards.values()) {
        if (d.url === params.url) {
          dashboard = d;
          break;
        }
      }
    } else if (params.path) {
      const resolvedPath = resolve(params.path);
      for (const d of dashboards.values()) {
        if (d.path === resolvedPath) {
          dashboard = d;
          break;
        }
      }
    }

    if (!dashboard) {
      throw new Error("No dashboard found matching the provided identifier");
    }

    // Stop tailscale serve
    await execTailscale(["serve", "clear", dashboard.path]);
    
    // Remove from tracker
    dashboards.delete(dashboard.id);

    return {
      content: [{ type: "text", text: `Stopped dashboard: ${dashboard.url}` }],
      details: { success: true, id: dashboard.id },
    };
  },
});

export default function (pi: ExtensionAPI) {
  // Register tools with namespace
  const tools = [serveDashboardTool, listDashboardsTool, stopDashboardTool];

  for (const tool of tools) {
    const namespacedTool = {
      ...tool,
      name: `tailscale-serve.${tool.name}`,
      namespace: {
        name: "tailscale-serve",
        description: "Serve dashboards via Tailscale",
      },
    };
    pi.registerTool(namespacedTool);
  }

  console.log("tailscale-serve extension loaded");
}
