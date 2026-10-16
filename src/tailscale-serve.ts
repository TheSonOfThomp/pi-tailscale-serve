/**
 * Pi Tailscale Serve Extension - Simplified version
 * Main entry point with all tools in one file for easier testing
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { v4 as uuidv4 } from "uuid";

// Simple in-memory tracker
interface DashboardMetadata {
  id: string;
  path: string;
  type: "static" | "react" | "vue" | "next" | "dynamic";
  url: string;
  port: number;
  persist: boolean;
  createdAt: string;
  frameworkPort?: number;
  frameworkProcess?: ChildProcess;
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

// Helper: find available port
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = require("node:http").createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close();
      resolve(port);
    });
  });
}

// Helper: detect framework type
async function detectFramework(path: string): Promise<"static" | "react" | "vue" | "next" | null> {
  try {
    const pkgPath = join(path, "package.json");
    const pkgContent = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent);

    if (pkg.dependencies?.next) {
      return "next";
    }
    if (pkg.dependencies?.vue) {
      return "vue";
    }
    if (pkg.dependencies?.react) {
      return "react";
    }
  } catch {
    // No package.json or can't read it
  }

  // Check for framework-specific files
  try {
    const files = await fs.readdir(path);
    if (files.includes("next.config.js") || files.includes("next.config.ts")) {
      return "next";
    }
    if (files.includes("vue.config.js") || files.includes("vue.config.ts")) {
      return "vue";
    }
    if (files.includes("vite.config.js") || files.includes("vite.config.ts")) {
      // Could be React or Vue with Vite
      const pkgPath = join(path, "package.json");
      try {
        const pkgContent = await fs.readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(pkgContent);
        if (pkg.dependencies?.vue) return "vue";
        if (pkg.dependencies?.react) return "react";
      } catch {
        // Can't determine, default to static
      }
    }
  } catch {
    // Can't read directory
  }

  return "static";
}

// Helper: start framework dev server
async function startFrameworkServer(
  path: string,
  framework: "react" | "vue" | "next"
): Promise<{ process: ChildProcess; port: number }> {
  const port = await findAvailablePort();

  let command: string;
  let args: string[];

  switch (framework) {
    case "react":
      command = "npm";
      args = ["run", "dev", "--", "--port", port.toString()];
      break;
    case "vue":
      command = "npm";
      args = ["run", "dev", "--", "--port", port.toString()];
      break;
    case "next":
      command = "npm";
      args = ["run", "dev", "--", "--port", port.toString()];
      break;
    default:
      throw new Error(`Unknown framework: ${framework}`);
  }

  const child = spawn(command, args, {
    cwd: path,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Wait a bit for the server to start
  await new Promise((resolve) => setTimeout(resolve, 3000));

  return { process: child, port };
}

// Tool 1: Serve a dashboard (auto-detect)
const serveDashboardTool = defineTool({
  name: "serve_dashboard",
  label: "Serve Dashboard",
  description: "Serve a dashboard, website, or web app via Tailscale. Auto-detects static HTML, React, Vue, Next.js, or dynamic content. For framework apps (React/Vue/Next.js), automatically starts the dev server with HMR (Hot Module Replacement) enabled. Use when you want to share a dashboard with others on your tailnet. Examples: 'Serve this folder', 'Make this React app accessible', 'Share this HTML file', 'Host this dashboard with HMR'.",
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

    // Detect framework type
    const framework = await detectFramework(path) || "static";

    let tailscalePort: number;
    let frameworkProcess: ChildProcess | undefined;
    let frameworkPort: number | undefined;

    if (framework === "static") {
      // Serve static files directly
      const result = await execTailscale(["serve", path, "--bg"]);
      if (result.code !== 0) {
        throw new Error(`Failed to serve: ${result.stderr || result.stdout}`);
      }

      // Try to extract port from output
      const portMatch = result.stdout.match(/port\s+(\d+)/i) || result.stdout.match(/:(\d+)/);
      tailscalePort = portMatch ? parseInt(portMatch[1], 10) : 8080;
    } else {
      // Start framework dev server with HMR
      const { process: proc, port: fPort } = await startFrameworkServer(path, framework);
      frameworkProcess = proc;
      frameworkPort = fPort;

      // Expose the framework port via tailscale
      const result = await execTailscale(["serve", frameworkPort.toString(), "--bg"]);
      if (result.code !== 0) {
        // Clean up framework process
        frameworkProcess.kill("SIGTERM");
        throw new Error(`Failed to serve: ${result.stderr || result.stdout}`);
      }

      tailscalePort = frameworkPort;
    }

    // Get hostname and construct URL
    const hostname = await getTailscaleHostname();
    const url = `https://${hostname}.ts.net:${tailscalePort}`;

    // Create metadata
    const metadata: DashboardMetadata = {
      id: uuidv4(),
      path,
      type: framework === "static" ? "static" : framework === "react" ? "react" : framework === "vue" ? "vue" : "next",
      url,
      port: tailscalePort,
      persist,
      createdAt: new Date().toISOString(),
      frameworkPort,
      frameworkProcess,
    };

    dashboards.set(metadata.id, metadata);

    // Return HMR info for framework apps
    const hmrInfo = framework !== "static" 
      ? ` with HMR enabled on port ${frameworkPort}. Edit your files and see changes live!`
      : "";

    return {
      content: [{ type: "text", text: `Dashboard served at: ${url}${hmrInfo}` }],
      details: metadata,
    };
  },
});

// Tool 2: List dashboards
const listDashboardsTool = defineTool({
  name: "list_dashboards",
  label: "List Dashboards",
  description: "List all currently served dashboards with their URLs, types, and HMR status. Use to see what's currently hosted or to find a dashboard URL. Examples: 'What dashboards are running?', 'Show me my hosted dashboards', 'List active serves'.",
  parameters: Type.Object({}),

  async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
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
      ...dashboardList.map((d) => {
        const hmrInfo = d.type !== "static" && d.frameworkPort 
          ? ` (HMR on port ${d.frameworkPort})`
          : "";
        return `  - ${d.url} (${d.type}${hmrInfo}, created: ${d.createdAt})`;
      }),
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
  description: "Stop serving a dashboard by port, URL, or path. Also stops any running dev server. Examples: 'Stop dashboard on port 3000', 'Stop serving that dashboard', 'Clean up the React app I served earlier', 'Remove dashboard at /path/to/files'.",
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
        if (d.port === params.port || d.frameworkPort === params.port) {
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

    // Stop framework dev server if running
    if (dashboard.frameworkProcess) {
      try {
        dashboard.frameworkProcess.kill("SIGTERM");
      } catch (error) {
        console.warn(`Failed to stop framework process: ${error}`);
      }
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
        description: "Serve dashboards via Tailscale with HMR support for framework apps",
      },
    };
    pi.registerTool(namespacedTool);
  }

  console.log("tailscale-serve extension loaded");
}
