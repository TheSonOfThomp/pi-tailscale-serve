/**
 * Dashboard Validation Utilities
 */

import { promises as fs } from "node:fs";
import { join, extname } from "node:path";
import type { DashboardType } from "../tracker";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings: string[];
}

/**
 * Validate that a dashboard path is within the project root
 */
export async function validateDashboardPath(
  path: string,
  projectRoot: string
): Promise<ValidationResult> {
  const { isPathWithin } = await import("./filesystem");

  if (!isPathWithin(path, projectRoot)) {
    return {
      valid: false,
      error: `Path ${path} is outside the project root ${projectRoot}`,
      warnings: [],
    };
  }

  return { valid: true, warnings: [] };
}

/**
 * Validate static dashboard content
 */
export async function validateStaticDashboard(path: string): Promise<string[]> {
  const warnings: string[] = [];

  try {
    const files = await fs.readdir(path);

    // Check for index file
    const indexFiles = ["index.html", "index.htm", "index.md", "index.php"];
    const hasIndex = files.some((f) => indexFiles.includes(f.toLowerCase()));
    if (!hasIndex) {
      warnings.push("No index file found (index.html, index.htm, index.md, or index.php)");
    }

    // Check for common web files
    const webExtensions = [".html", ".htm", ".css", ".js", ".json", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".md"];
    const nonWebFiles = files.filter((f) => {
      const ext = extname(f).toLowerCase();
      return !webExtensions.includes(ext) && !f.startsWith(".");
    });

    if (nonWebFiles.length > 0) {
      warnings.push(`Found non-web files: ${nonWebFiles.join(", ")}`);
    }

    // Check for sensitive files
    const sensitiveFiles = [".env", ".env.local", ".env.*", "*.pem", "*.key", "*.secret"];
    for (const pattern of sensitiveFiles) {
      const matched = files.filter((f) => {
        if (pattern.startsWith(".") && pattern.endsWith("*")) {
          const prefix = pattern.slice(0, -1);
          return f.startsWith(prefix);
        }
        if (pattern.startsWith("*")) {
          const suffix = pattern.slice(1);
          return f.endsWith(suffix);
        }
        return f === pattern;
      });
      if (matched.length > 0) {
        warnings.push(`Found sensitive files matching ${pattern}: ${matched.join(", ")}`);
      }
    }
  } catch (error) {
    warnings.push(`Could not validate dashboard content: ${error}`);
  }

  return warnings;
}

/**
 * Detect the type of dashboard based on path and content
 */
export async function detectDashboardType(path: string): Promise<DashboardType | null> {
  try {
    const stats = await fs.stat(path);

    if (!stats.isDirectory()) {
      // Single file - determine by extension
      const ext = extname(path).toLowerCase();
      if ([".html", ".htm"].includes(ext)) {
        return "static";
      }
      if ([".json", ".md", ".markdown"].includes(ext)) {
        return "dynamic";
      }
      return null;
    }

    // Directory - check for framework indicators
    const files = await fs.readdir(path);

    // Check for React
    if (files.includes("package.json")) {
      try {
        const pkgContent = await fs.readFile(join(path, "package.json"), "utf-8");
        const pkg = JSON.parse(pkgContent);
        if (pkg.dependencies?.react || pkg.dependencies?.["react-dom"]) {
          return "react";
        }
        if (pkg.dependencies?.vue) {
          return "vue";
        }
        if (pkg.dependencies?.next) {
          return "next";
        }
      } catch {
        // Couldn't read package.json
      }
    }

    // Check for Vue-specific files
    if (files.includes("vue.config.js") || files.includes("vue.config.ts")) {
      return "vue";
    }

    // Check for Next.js-specific files
    if (files.includes("next.config.js") || files.includes("next.config.ts") || files.includes("pages")) {
      return "next";
    }

    // Default to static for directories
    return "static";
  } catch (error) {
    return null;
  }
}

/**
 * Validate framework dashboard
 */
export async function validateFrameworkDashboard(
  path: string,
  framework: DashboardType
): Promise<string[]> {
  const warnings: string[] = [];

  if (framework === "react") {
    // Check for package.json
    try {
      await fs.access(join(path, "package.json"));
    } catch {
      warnings.push("No package.json found for React app");
    }

    // Check for required scripts
    try {
      const pkgContent = await fs.readFile(join(path, "package.json"), "utf-8");
      const pkg = JSON.parse(pkgContent);
      if (!pkg.scripts?.dev && !pkg.scripts?.start) {
        warnings.push("No 'dev' or 'start' script found in package.json");
      }
    } catch {
      // Couldn't validate package.json
    }
  }

  if (framework === "vue") {
    try {
      await fs.access(join(path, "package.json"));
    } catch {
      warnings.push("No package.json found for Vue app");
    }
  }

  if (framework === "next") {
    try {
      await fs.access(join(path, "package.json"));
    } catch {
      warnings.push("No package.json found for Next.js app");
    }
  }

  return warnings;
}

/**
 * Validate dynamic content
 */
export async function validateDynamicContent(
  content: string,
  contentType: string
): Promise<string[]> {
  const warnings: string[] = [];

  if (contentType === "json") {
    try {
      JSON.parse(content);
    } catch {
      warnings.push("Invalid JSON content");
    }
  }

  if (contentType === "markdown" || contentType === "md") {
    // Markdown is always valid
  }

  return warnings;
}
