/**
 * Process Manager
 * Tracks child processes and their metadata
 */

import { spawn, type ChildProcess } from "node:child_process";
import { platform } from "node:os";

export interface ProcessInfo {
  pid: number;
  command: string;
  args: string[];
  process: ChildProcess;
  dashboardId?: string;
  createdAt: Date;
}

export class ProcessManager {
  private processes: Map<number, ProcessInfo> = new Map();

  /**
   * Spawn a new process and track it
   */
  spawn(
    command: string,
    args: string[] = [],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      dashboardId?: string;
    } = {}
  ): ChildProcess {
    const { cwd, env, dashboardId } = options;

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      ...(platform() === "win32" ? { shell: true } : {}),
    });

    // Store process info
    if (child.pid) {
      const processInfo: ProcessInfo = {
        pid: child.pid,
        command,
        args,
        process: child,
        dashboardId,
        createdAt: new Date(),
      };
      this.processes.set(child.pid, processInfo);
    }

    return child;
  }

  /**
   * Get process info by PID
   */
  getByPid(pid: number): ProcessInfo | undefined {
    return this.processes.get(pid);
  }

  /**
   * Get all processes for a specific dashboard
   */
  getByDashboardId(dashboardId: string): ProcessInfo[] {
    const result: ProcessInfo[] = [];
    for (const info of this.processes.values()) {
      if (info.dashboardId === dashboardId) {
        result.push(info);
      }
    }
    return result;
  }

  /**
   * Kill a process by PID
   */
  kill(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
    const info = this.processes.get(pid);
    if (!info) {
      return false;
    }

    try {
      info.process.kill(signal);
      this.processes.delete(pid);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill all processes for a dashboard
   */
  killByDashboardId(dashboardId: string, signal: NodeJS.Signals = "SIGTERM"): number {
    const processes = this.getByDashboardId(dashboardId);
    let killed = 0;

    for (const info of processes) {
      try {
        info.process.kill(signal);
        this.processes.delete(info.pid);
        killed++;
      } catch {
        // Process might already be dead
      }
    }

    return killed;
  }

  /**
   * Kill all tracked processes
   */
  killAll(signal: NodeJS.Signals = "SIGTERM"): number {
    let killed = 0;
    for (const info of this.processes.values()) {
      try {
        info.process.kill(signal);
        killed++;
      } catch {
        // Process might already be dead
      }
    }
    this.processes.clear();
    return killed;
  }

  /**
   * Remove a process from tracking (without killing it)
   */
  remove(pid: number): boolean {
    return this.processes.delete(pid);
  }

  /**
   * Get all tracked PIDs
   */
  getAllPids(): number[] {
    return Array.from(this.processes.keys());
  }

  /**
   * Check if a PID is tracked
   */
  has(pid: number): boolean {
    return this.processes.has(pid);
  }

  /**
   * Clean up finished processes
   * Remove processes that have already exited
   */
  cleanupFinished(): void {
    for (const [pid, info] of this.processes.entries()) {
      if (info.process.killed || info.process.exitCode !== null) {
        this.processes.delete(pid);
      }
    }
  }
}
