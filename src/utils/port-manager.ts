/**
 * Port Manager
 * Manages port allocation and tracking
 */

import { createServer } from "node:http";
import { AddressInfo } from "node:net";

export interface PortRange {
  min?: number;
  max?: number;
}

export class PortManager {
  private usedPorts: Set<number> = new Set();
  private portRange: PortRange;

  constructor(portRange: PortRange = {}) {
    this.portRange = portRange;
  }

  /**
   * Find an available port
   * If portRange is specified, try ports in that range first
   * Otherwise, let the OS decide (port 0)
   */
  async findAvailablePort(): Promise<number> {
    // If no range specified, let OS decide
    if (!this.portRange.min && !this.portRange.max) {
      return await this.findOSSAssignedPort();
    }

    // Try ports in the specified range
    const min = this.portRange.min ?? 3000;
    const max = this.portRange.max ?? 11000;

    for (let port = min; port <= max; port++) {
      if (!this.usedPorts.has(port) && await this.isPortAvailable(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }

    // Fall back to OS-assigned port
    return await this.findOSSAssignedPort();
  }

  /**
   * Find a port assigned by the OS (port 0)
   */
  private async findOSSAssignedPort(): Promise<number> {
    return new Promise((resolve) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        const port = address.port;
        server.close();
        this.usedPorts.add(port);
        resolve(port);
      });
    });
  }

  /**
   * Check if a specific port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.on("error", () => {
        resolve(false);
      });
      server.listen(port, "127.0.0.1", () => {
        server.close();
        resolve(true);
      });
    });
  }

  /**
   * Mark a port as used
   */
  markPortUsed(port: number): void {
    this.usedPorts.add(port);
  }

  /**
   * Mark a port as available
   */
  markPortAvailable(port: number): void {
    this.usedPorts.delete(port);
  }

  /**
   * Check if a port is in use
   */
  isPortInUse(port: number): boolean {
    return this.usedPorts.has(port);
  }

  /**
   * Get all used ports
   */
  getUsedPorts(): number[] {
    return Array.from(this.usedPorts);
  }

  /**
   * Clear all tracked ports
   */
  clear(): void {
    this.usedPorts.clear();
  }
}
