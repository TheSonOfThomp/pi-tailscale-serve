/**
 * Tailscale CLI Wrapper
 * Handles interaction with the tailscale command-line tool
 */

import { spawn, type ChildProcess } from "node:child_process";
import { platform } from "node:os";

export interface TailscaleServeResult {
  success: boolean;
  url?: string;
  port?: number;
  pid?: number;
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

export class TailscaleClient {
  private retryConfig: RetryConfig;
  private activeProcesses: Map<number, ChildProcess> = new Map();

  constructor(retryConfig: RetryConfig) {
    this.retryConfig = retryConfig;
  }

  /**
   * Serve a target (directory, port, or file) via Tailscale
   */
  async serve(target: string, bg: boolean = true): Promise<TailscaleServeResult> {
    const args = ["serve", target];
    if (bg) args.push("--bg");

    let lastError: string | undefined;
    let lastResult: TailscaleServeResult | undefined;

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        const result = await this.execTailscale(args);
        lastResult = {
          success: true,
          stdout: result.stdout,
          stderr: result.stderr,
        };

        // Try to extract URL from output
        const urlMatch = result.stdout.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          lastResult.url = urlMatch[0];
        }

        // Try to extract port from output
        const portMatch = result.stdout.match(/port\s+(\d+)/i) ||
                          result.stdout.match(/:(\d+)\s/);
        if (portMatch) {
          lastResult.port = parseInt(portMatch[1], 10);
        }

        return lastResult;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < this.retryConfig.maxAttempts) {
          const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    return {
      success: false,
      error: lastError,
      stdout: lastResult?.stdout,
      stderr: lastResult?.stderr,
    };
  }

  /**
   * Clear a specific serve target
   */
  async clear(target: string): Promise<boolean> {
    try {
      await this.execTailscale(["serve", "clear", target]);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get serve status
   */
  async status(): Promise<any> {
    try {
      const result = await this.execTailscale(["serve", "status", "--json"]);
      return JSON.parse(result.stdout || "{}");
    } catch {
      return {};
    }
  }

  /**
   * Reset all serve configurations
   */
  async reset(): Promise<boolean> {
    try {
      await this.execTailscale(["serve", "reset"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Tailscale is installed and logged in
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.execTailscale(["status", "--json"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the Tailscale hostname for this machine
   */
  async getHostname(): Promise<string | null> {
    try {
      const result = await this.execTailscale(["status", "--json"]);
      const status = JSON.parse(result.stdout || "{}");
      return status.Self?.DNSName?.replace(/\.ts\.net\.$/, "") ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get the Tailscale IP addresses for this machine
   */
  async getIPs(): Promise<string[]> {
    try {
      const result = await this.execTailscale(["status", "--json"]);
      const status = JSON.parse(result.stdout || "{}");
      return status.TailscaleIPs ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Execute a tailscale command
   */
  private async execTailscale(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.getTailscaleCommand(), args, {
        stdio: ["ignore", "pipe", "pipe"],
        // On Windows, we need to specify the shell
        ...(platform() === "win32" ? { shell: true } : {}),
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (error) => {
        reject(new Error(`Failed to spawn tailscale: ${error.message}`));
      });

      child.on("close", (code) => {
        if (code !== 0) {
          const errorMsg = stderr.trim() || `tailscale exited with code ${code}`;
          reject(new Error(errorMsg));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /**
   * Get the tailscale command name
   */
  private getTailscaleCommand(): string {
    // On Windows, it might be tailscale.exe
    if (platform() === "win32") {
      return "tailscale.exe";
    }
    return "tailscale";
  }
}
