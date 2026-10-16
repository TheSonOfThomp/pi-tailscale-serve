/**
 * Test suite for pi-tailscale-serve extension
 * Ensures safety constraints are maintained
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const srcDir = resolve(__dirname, "..");

// Helper to get the current tailscale serve status
async function getTailscaleStatus(): Promise<any> {
  // This would use spawn in a real test, but for unit tests we just return empty
  return {};
}

describe("pi-tailscale-serve extension", () => {
  beforeEach(async () => {
    // Load the module fresh for each test
  });

  afterEach(async () => {
    // Cleanup any test configs
  });

  describe("Port 443 Protection", () => {
    it("should NEVER use port 443 for tailscale serve", async () => {
      const source = await fs.readFile(resolve(srcDir, "tailscale-serve.ts"), "utf-8");
      
      // Check that we don't have hardcoded port 443 in execTailscale calls with serve
      // Look for the pattern: execTailscale(["serve", ...443...])
      // But allow it in comments and checks
      
      // Check that we use --https flag
      expect(source).toMatch(/--https=/);
      
      // Check that we have port 443 guard
      expect(source).toMatch(/isPort443InUse|Port 443/);
      
      // Check that we never pass 443 as a port argument to tailscale serve
      // This regex looks for: execTailscale\(\[.*"serve".*443.*\]\)
      const serveWith443 = /execTailscale\(\[[^\]]*"serve"[^\]]*443[^\]]*\]\)/;
      expect(source).not.toMatch(serveWith443);
    });

    it("should use --https flag for tailscale serve", async () => {
      const source = await fs.readFile(resolve(srcDir, "tailscale-serve.ts"), "utf-8");
      
      // Check that tailscale serve commands use --https flag
      expect(source).toMatch(/execTailscale\(\[[^\]]*"serve"[^\]]*--https=/);
      
      // Check that we're mapping to http://127.0.0.1:port
      expect(source).toMatch(/http:\/\/127\.0\.0\.1:/);
    });
  });

  describe("Stop Command", () => {
    it("should use tailscale serve --https=<port> off not clear", async () => {
      const source = await fs.readFile(resolve(srcDir, "tailscale-serve.ts"), "utf-8");
      
      // Check that we use the correct stop command
      expect(source).toMatch(/execTailscale\(\[[^\]]*"serve"[^\]]*--https=[^\]]*"off"[^\]]*\]\)/);
      
      // Check that we don't use 'clear' in execTailscale calls
      const clearPattern = /execTailscale\(\[[^\]]*"serve"[^\]]*"clear"[^\]]*\]\)/;
      expect(source).not.toMatch(clearPattern);
    });
  });

  describe("Static Server", () => {
    it("should not contain TypeScript syntax in .js file", async () => {
      const staticServerPath = resolve(srcDir, "static-server.js");
      const content = await fs.readFile(staticServerPath, "utf-8");
      
      // Check for TypeScript-only syntax
      expect(content).not.toMatch(/\.url!/); // Non-null assertion
      expect(content).not.toMatch(/as const/);
      expect(content).not.toMatch(/type\s+/);
      expect(content).not.toMatch(/interface\s+/);
    });

    it("should have directory traversal protection", async () => {
      const staticServerPath = resolve(srcDir, "static-server.js");
      const content = await fs.readFile(staticServerPath, "utf-8");
      
      // Check for path resolution and validation
      expect(content).toMatch(/path\.resolve/);
      expect(content).toMatch(/path\.normalize/);
      expect(content).toMatch(/startsWith/);
      expect(content).toMatch(/Forbidden/);
    });

    it("should pass node --check", async () => {
      // Use child_process instead of execa
      const { execSync } = await import("node:child_process");
      
      const staticServerPath = resolve(srcDir, "static-server.js");
      try {
        execSync(`node --check ${staticServerPath}`, { encoding: "utf-8" });
        // If we get here, node --check passed
      } catch (error: any) {
        throw new Error(`node --check failed: ${error.message}`);
      }
    });
  });

  describe("Static Dashboards", () => {
    it("should expose static dashboards via tailscale serve", async () => {
      const source = await fs.readFile(resolve(srcDir, "tailscale-serve.ts"), "utf-8");
      
      // Find the static branch
      const staticMatch = source.match(/if\s*\([\s\S]*?framework\s*===\s*["']static["'][\s\S]*?\)/);
      expect(staticMatch).toBeTruthy();
      
      // Check that within the static branch, we call execTailscale
      const staticBlock = source.slice(staticMatch!.index!);
      const nextElse = staticBlock.match(/\s*}\s*else\s*{/);
      const staticCode = staticBlock.slice(0, nextElse?.index);
      
      expect(staticCode).toMatch(/execTailscale/);
      expect(staticCode).toMatch(/--https=/);
    });
  });

  describe("Startup Verification", () => {
    it("should verify server startup with port polling", async () => {
      const source = await fs.readFile(resolve(srcDir, "tailscale-serve.ts"), "utf-8");
      
      // Check for waitForPort function
      expect(source).toMatch(/waitForPort/);
      
      // Check for connection attempts
      expect(source).toMatch(/createConnection/);
      
      // Check for timeout
      expect(source).toMatch(/timeoutMs/);
    });
  });

  describe("State Persistence", () => {
    it("should save state to file", async () => {
      const source = await fs.readFile(resolve(srcDir, "tailscale-serve.ts"), "utf-8");
      
      // Check for state file operations
      expect(source).toMatch(/STATE_FILE/);
      expect(source).toMatch(/saveState/);
      expect(source).toMatch(/loadState/);
      expect(source).toMatch(/\.pi.*tailscale-serve/);
    });
  });

  describe("Build", () => {
    it("should build without errors", async () => {
      const { execSync } = await import("node:child_process");
      
      try {
        execSync("npm run build", { 
          cwd: resolve(__dirname, "..", ".."),
          encoding: "utf-8",
          stdio: "pipe"
        });
      } catch (error: any) {
        throw new Error(`Build failed: ${error.message}`);
      }
    });
  });
});

describe("Integration Tests", () => {
  // These tests require tailscale to be running
  // They should be run manually or in CI with tailscale available
  
  describe("Caddy Protection", () => {
    it.skip("should not affect Caddy on port 443", async () => {
      // This test requires tailscale and Caddy running
      // Manual test steps:
      // 1. Verify Caddy is serving on 443: curl -sS -o /dev/null -w '%{http_code}\n' https://omni.adamt.cc/
      // 2. Serve a dashboard with this extension
      // 3. Verify Caddy still works
      // 4. Stop the dashboard
      // 5. Verify Caddy still works
    });
  });

  describe("Tailscale Config Management", () => {
    it.skip("should create and remove tailscale serve configs", async () => {
      // This test requires tailscale running
      // Manual test steps:
      // 1. Check tailscale serve status (should be empty or have existing configs)
      // 2. Serve a dashboard
      // 3. Check tailscale serve status (should have new config on high port)
      // 4. Stop the dashboard
      // 5. Check tailscale serve status (should be back to original state)
    });
  });

  describe("Port 443 Never Used", () => {
    it.skip("should never configure port 443", async () => {
      // Manual test: tailscale serve status should never show port 443
    });
  });
});
