/**
 * Pi Tailscale Serve Extension
 * Serves dashboards via Tailscale with proper port management
 * NEVER uses port 443 to avoid conflicts with Caddy
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { v4 as uuidv4 } from "uuid";


// State file for persistence - use process.cwd since this is loaded by Pi directly
const STATE_FILE = join(process.env.HOME || "/tmp", ".pi", "agent", "tailscale-serve", "state.json");

// Ensure state directory exists
async function ensureStateDir(): Promise<void> {
  const stateDir = dirname(STATE_FILE);
  try {
    await fs.mkdir(stateDir, { recursive: true });
  } catch {
    // Directory already exists
  }
}

// Load state from file
async function loadState(): Promise<Map<string, DashboardMetadata>> {
  try {
    await ensureStateDir();
    const data = await fs.readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return new Map(parsed.dashboards || []);
  } catch {
    return new Map();
  }
}

// Save state to file
async function saveState(dashboards: Map<string, DashboardMetadata>): Promise<void> {
  await ensureStateDir();
  const data = JSON.stringify({ dashboards: Array.from(dashboards.entries()) }, null, 2);
  await fs.writeFile(STATE_FILE, data, "utf-8");
}

// Interface for dashboard metadata
interface DashboardMetadata {
  id: string;
  path: string;
  type: "static" | "react" | "vue" | "next" | "dynamic";
  url: string;
  port: number;
  httpsPort: number;
  persist: boolean;
  createdAt: string;
  frameworkPid?: number;
  tailscaleConfigName?: string;
}

// In-memory tracker (loaded from file on startup)
let dashboards: Map<string, DashboardMetadata> = new Map();

// Load state on module load
(async () => {
  dashboards = await loadState();
})();

// Helper: execute tailscale command with timeout
async function execTailscale(args: string[], timeoutMs = 5000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("tailscale", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ stdout: "", stderr: `tailscale command timed out after ${timeoutMs}ms`, code: 124 });
    }, timeoutMs);
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code: code || 0 });
    });
    child.on("error", (e: any) => {
      clearTimeout(timeout);
      resolve({ stdout: "", stderr: e.message, code: 1 });
    });
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

// Helper: find available port (high port to avoid conflicts)
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve) => {
    const { createServer } = require("node:http");
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close();
      resolve(port);
    });
  });
}

// Helper: check if port is available by trying to connect
async function waitForPort(port: number, timeoutMs = 10000): Promise<boolean> {
  const startTime = Date.now();
  const { createConnection } = require("node:net");
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const connected = await new Promise<boolean>((resolveInner) => {
        const socket = createConnection({ port, host: "127.0.0.1" });
        const timeout = setTimeout(() => {
          socket.destroy();
          resolveInner(false);
        }, 1000);
        
        socket.on("connect", () => {
          clearTimeout(timeout);
          socket.destroy();
          resolveInner(true);
        });
        
        socket.on("error", () => {
          clearTimeout(timeout);
          socket.destroy();
          resolveInner(false);
        });
      });
      
      if (connected) return true;
    } catch {
      // Connection failed, retry
    }
    
    await new Promise((resolveInner) => setTimeout(resolveInner, 100));
  }
  return false;
}

// Helper: check if port 443 is already in use by Caddy or other services
async function isPort443InUse(): Promise<boolean> {
  try {
    const result = await execTailscale(["serve", "status", "--json"]);
    const status = JSON.parse(result.stdout || "{}");
    // Check if any config uses port 443
    for (const config of status.HTTP?.Servers || []) {
      if (config.Port === 443) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Helper: check if a specific port is already configured in tailscale serve
async function isPortConfigured(port: number): Promise<boolean> {
  try {
    const result = await execTailscale(["serve", "status", "--json"]);
    const status = JSON.parse(result.stdout || "{}");
    for (const config of status.HTTP?.Servers || []) {
      if (config.Port === port) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Helper: start static file server
async function startStaticServer(servePath: string): Promise<{ process: ChildProcess; port: number }> {
  const port = await findAvailablePort();
  
  // Get the directory of this file - use __dirname since Pi loads TS directly
  // For the built version, we'd use import.meta.url, but Pi uses jiti which handles this
  const staticServerPath = resolve(__dirname, "static-server.js");
  const child = spawn(
    "node",
    [staticServerPath, servePath, port.toString()],
    {
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  // Wait for server to actually start and accept connections
  const success = await waitForPort(port, 10000);
  if (!success) {
    child.kill("SIGTERM");
    throw new Error(`Static server failed to start on port ${port}`);
  }

  return { process: child, port };
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
    stdio: ["ignore", "pipe", "pipe"]
  });

  // Wait for server to actually start and accept connections
  const success = await waitForPort(port, 10000);
  if (!success) {
    child.kill("SIGTERM");
    throw new Error(`Framework dev server failed to start on port ${port}`);
  }

  return { process: child, port };
}

// Helper: detect framework type
async function detectFramework(path: string): Promise<"static" | "react" | "vue" | "next"> {
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
      try {
        const pkgPath = join(path, "package.json");
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

// Helper: generate a unique config name for tailscale serve
function generateConfigName(): string {
  return `pi-tailscale-serve-${uuidv4().slice(0, 8)}`;
}

// Tool 1: Serve a dashboard (auto-detect)
const serveDashboardTool = defineTool({
  name: "serve_dashboard",
  label: "Serve Dashboard",
  description: "Serve a dashboard, website, or web app via Tailscale. Auto-detects static HTML, React, Vue, Next.js, or dynamic content. For framework apps (React/Vue/Next.js), automatically starts the dev server with HMR (Hot Module Replacement) enabled. NEVER uses port 443 to avoid conflicts with existing services. Use when you want to share a dashboard with others on your tailnet. Examples: 'Serve this folder', 'Make this React app accessible', 'Share this HTML file', 'Host this dashboard with HMR'.",
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
    const servePath = params.path ? resolve(params.path) : ctx.cwd;
    const persist = params.persist ?? true;

    // Check if path exists
    try {
      const stats = await fs.stat(servePath);
      if (!stats.isDirectory()) {
        throw new Error(`Path ${servePath} is not a directory`);
      }
    } catch (error) {
      throw new Error(`Path ${servePath} does not exist: ${error}`);
    }

    // Check for port 443 conflict
    const port443InUse = await isPort443InUse();
    if (port443InUse) {
      throw new Error("Port 443 is in use by another service (likely Caddy). This extension will never use port 443.");
    }

    // Detect framework type
    const framework = await detectFramework(servePath);

    let tailscalePort: number;
    let httpsPort: number;
    let frameworkPid: number | undefined;
    let configName: string;

    if (framework === "static") {
      // Start a local static file server
      const { process: staticProc, port: staticPort } = await startStaticServer(servePath);
      const staticPid = staticProc.pid;
      frameworkPid = staticPid;
      tailscalePort = staticPort;
      httpsPort = staticPort;
      configName = generateConfigName();

      // Expose via tailscale with HTTPS on the same port
      const result = await execTailscale(["serve", "--bg", `--https=${httpsPort}`, `http://127.0.0.1:${httpsPort}`]);
      if (result.code !== 0) {
        try { process.kill(staticPid!, "SIGTERM"); } catch {}
        throw new Error(`Failed to expose via tailscale: ${result.stderr || result.stdout}`);
      }
    } else {
      // Start framework dev server with HMR
      const { process: proc, port: fPort } = await startFrameworkServer(servePath, framework);
      const frameworkPidVal = proc.pid;
      frameworkPid = frameworkPidVal;
      tailscalePort = fPort;
      httpsPort = fPort;
      configName = generateConfigName();

      // Expose the framework port via tailscale with HTTPS
      const result = await execTailscale(["serve", "--bg", `--https=${httpsPort}`, `http://127.0.0.1:${httpsPort}`]);
      if (result.code !== 0) {
        try { proc.kill("SIGTERM"); } catch {}
        throw new Error(`Failed to expose via tailscale: ${result.stderr || result.stdout}`);
      }
    }

    // Get hostname and construct URL
    const hostname = await getTailscaleHostname();
    const url = `https://${hostname}.ts.net:${httpsPort}`;

    // Create metadata
    const metadata: DashboardMetadata = {
      id: uuidv4(),
      path: servePath,
      type: framework,
      url,
      port: tailscalePort,
      httpsPort,
      persist,
      createdAt: new Date().toISOString(),
      frameworkPid,
      tailscaleConfigName: configName,
    };

    dashboards.set(metadata.id, metadata);
    await saveState(dashboards);

    // Return HMR info for framework apps
    const hmrInfo = framework !== "static" 
      ? ` with HMR enabled on port ${httpsPort}. Edit your files and see changes live!`
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
        const hmrInfo = d.type !== "static" && d.httpsPort 
          ? ` (HMR on port ${d.httpsPort})`
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
        if (d.port === params.port || d.httpsPort === params.port) {
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
    if (dashboard.frameworkPid !== undefined) {
      try {
        process.kill(dashboard.frameworkPid, "SIGTERM");
      } catch (error) {
        console.warn(`Failed to stop framework process: ${error}`);
      }
    }

    // Stop tailscale serve for this specific config
    if (dashboard.httpsPort) {
      const result = await execTailscale(["serve", `--https=${dashboard.httpsPort}`, "off"]);
      if (result.code !== 0) {
        console.warn(`Failed to stop tailscale serve: ${result.stderr || result.stdout}`);
      }
    }

    // Remove from tracker
    dashboards.delete(dashboard.id);
    await saveState(dashboards);

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
}
