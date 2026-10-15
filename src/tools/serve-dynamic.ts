/**
 * Serve Dynamic Content Tool
 */

import { resolve, join } from "node:path";
import { promises as fs } from "node:fs";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DashboardTracker } from "../tracker";
import type { ExtensionConfig } from "../config";
import { TailscaleClient } from "../utils/tailscale";
import { createTempDashboardDir, writeFileWithDirs } from "../utils/filesystem";
import { validateDynamicContent } from "../utils/validation";
import { findProjectRoot } from "../utils/filesystem";

interface ServeDynamicParams {
  content: string;
  type: "json" | "markdown" | "md";
  persist?: boolean;
}

interface ServeDynamicResult {
  url: string;
  id: string;
  path: string;
  port: number;
  type: "dynamic";
  persist: boolean;
  createdAt: string;
  warnings?: string[];
}

export function serveDynamicTool(
  tracker: DashboardTracker,
  config: ExtensionConfig
): ToolDefinition<ServeDynamicParams, ServeDynamicResult> {
  const tailscale = new TailscaleClient(config.retry);

  return {
    name: "serve_dynamic",
    description: "Serve dynamic content (JSON, Markdown) as a dashboard via Tailscale",
    params: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The content to serve (JSON or Markdown)",
        },
        type: {
          type: "string",
          enum: ["json", "markdown", "md"],
          description: "The type of content",
        },
        persist: {
          type: "boolean",
          description: "Whether the dashboard should persist after session ends (default: true)",
          default: true,
        },
      },
      required: ["content", "type"],
    },
    handler: async (params, ctx) => {
      const persist = params.persist ?? true;
      const contentType = params.type === "md" ? "markdown" : params.type;

      // Validate content
      const warnings = await validateDynamicContent(params.content, contentType);

      // Create temporary directory
      const tempDir = await createTempDashboardDir("pi-dynamic-dashboard");

      // Convert content to HTML based on type
      let htmlContent: string;
      if (contentType === "json") {
        htmlContent = createJsonViewerHtml(params.content);
      } else {
        htmlContent = createMarkdownViewerHtml(params.content);
      }

      // Write index.html
      const indexPath = join(tempDir, "index.html");
      await writeFileWithDirs(indexPath, htmlContent);

      // Serve via tailscale
      const result = await tailscale.serve(tempDir, true);
      if (!result.success) {
        throw new Error(`Failed to serve dashboard: ${result.error}`);
      }

      // Get hostname for URL construction
      const hostname = await tailscale.getHostname();
      const port = result.port || 0;
      const url = `https://${hostname}.ts.net:${port}`;

      // Create metadata
      const metadata = await tracker.create(
        tempDir,
        "dynamic",
        url,
        port,
        persist,
        undefined,
        result.pid
      );

      return {
        url: metadata.url,
        id: metadata.id,
        path: metadata.path,
        port: metadata.port,
        type: "dynamic",
        persist: metadata.persist,
        createdAt: metadata.createdAt,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    },
  };
}

function createJsonViewerHtml(jsonContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JSON Dashboard</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      background: #f8f8f8;
      padding: 15px;
      border-radius: 4px;
      overflow-x: auto;
    }
    h1 {
      color: #333;
      margin-top: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>JSON Dashboard</h1>
    <pre>${escapeHtml(jsonContent)}</pre>
  </div>
</body>
</html>`;
}

function createMarkdownViewerHtml(markdownContent: string): string {
  // Simple markdown to HTML conversion (no external dependencies)
  const htmlContent = simpleMarkdownToHtml(markdownContent);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Dashboard</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
      line-height: 1.6;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1, h2, h3 {
      color: #333;
    }
    code {
      background: #f8f8f8;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    }
    pre {
      background: #f8f8f8;
      padding: 15px;
      border-radius: 4px;
      overflow-x: auto;
    }
    pre code {
      background: transparent;
      padding: 0;
    }
    blockquote {
      border-left: 3px solid #ccc;
      padding-left: 15px;
      margin-left: 0;
      color: #666;
    }
    a {
      color: #0066cc;
    }
  </style>
</head>
<body>
  <div class="container">
    ${htmlContent}
  </div>
</body>
</html>`;
}

function simpleMarkdownToHtml(markdown: string): string {
  // Very basic markdown to HTML conversion
  return markdown
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^> (.*$)/gm, "<blockquote>$1</blockquote>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/^```([\s\S]*?)```$/gm, "<pre><code>$1</code></pre>")
    .replace(/^\[(.*?)\]\((.*?)\)/gm, "<a href="$2">$1</a>")
    .replace(/^\- (.*$)/gm, "<li>$1</li>")
    .replace(/^\d+\. (.*$)/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
