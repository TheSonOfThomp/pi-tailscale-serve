/**
 * Configuration loading for the Tailscale Serve extension
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

export interface PortRange {
  min?: number;
  max?: number;
}

export interface TailscaleServeConfig {
  inactivityTimeoutDays: number;
  portRange: PortRange;
}

export interface ExtensionConfig {
  tailscaleServe: TailscaleServeConfig;
  retry: RetryConfig;
}

const DEFAULT_CONFIG: ExtensionConfig = {
  tailscaleServe: {
    inactivityTimeoutDays: 7,
    portRange: {
      min: 3000,
      max: 11000,
    },
  },
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
  },
};

/**
 * Load configuration from Pi settings
 */
export function loadConfig(pi: ExtensionAPI): ExtensionConfig {
  // Get Pi's retry settings
  const piSettings = pi.settings.get();
  const retryConfig: RetryConfig = {
    maxAttempts: piSettings.retry?.maxRetries ?? DEFAULT_CONFIG.retry.maxAttempts,
    baseDelayMs: piSettings.retry?.baseDelayMs ?? DEFAULT_CONFIG.retry.baseDelayMs,
  };

  // Get Tailscale Serve specific settings
  const tailscaleServeSettings = piSettings.tailscaleServe ?? {};
  const tailscaleServeConfig: TailscaleServeConfig = {
    inactivityTimeoutDays:
      tailscaleServeSettings.inactivityTimeoutDays ??
      DEFAULT_CONFIG.tailscaleServe.inactivityTimeoutDays,
    portRange:
      tailscaleServeSettings.portRange ?? DEFAULT_CONFIG.tailscaleServe.portRange,
  };

  return {
    tailscaleServe: tailscaleServeConfig,
    retry: retryConfig,
  };
}
