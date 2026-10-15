/**
 * Filesystem Utilities
 * Handles file operations including trash management
 */

import { promises as fs } from "node:fs";
import { join, dirname, basename } from "node:path";
import { platform, homedir } from "node:os";
import { spawn } from "node:child_process";

/**
 * Move a file or directory to the system trash
 */
export async function moveToTrash(path: string): Promise<void> {
  const resolvedPath = join(path);

  try {
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory() && !stats.isFile()) {
      throw new Error(`Path is not a file or directory: ${path}`);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      // Path doesn't exist, nothing to trash
      return;
    }
    throw error;
  }

  const trashPath = getTrashPath();

  // Create trash directory if it doesn't exist
  try {
    await fs.mkdir(trashPath, { recursive: true });
  } catch {
    // Trash directory already exists or can't be created
  }

  // Generate a unique name for the trashed item
  const timestamp = Date.now();
  const itemName = basename(resolvedPath);
  const trashedName = `${timestamp}-${itemName}`;
  const destination = join(trashPath, trashedName);

  // Use system move command for better reliability
  await moveToTrashSystem(resolvedPath, destination);
}

/**
 * Get the system trash path
 */
function getTrashPath(): string {
  switch (platform()) {
    case "darwin": // macOS
      return join(homedir(), ".Trash");
    case "win32": // Windows
      // Windows has a recycling bin, but we'll use a simple trash folder
      return join(homedir(), ".trash");
    case "linux":
    case "freebsd":
    case "openbsd":
      // Use XDG trash directory
      const xdgTrash = process.env.XDG_DATA_HOME
        ? join(process.env.XDG_DATA_HOME, "Trash")
        : join(homedir(), ".local", "share", "Trash");
      return join(xdgTrash, "files");
    default:
      return join(homedir(), ".trash");
  }
}

/**
 * Move to trash using system-specific commands
 */
async function moveToTrashSystem(source: string, destination: string): Promise<void> {
  switch (platform()) {
    case "darwin":
      // macOS: use mv command
      await execCommand("mv", [source, destination]);
      break;
    case "win32":
      // Windows: use move command
      await execCommand("move", [source, destination]);
      break;
    default:
      // Linux/Unix: use mv command
      await execCommand("mv", [source, destination]);
  }
}

/**
 * Execute a shell command
 */
function execCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...(platform() === "win32" ? { shell: true } : {}),
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to execute ${command}: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command ${command} failed with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Create a temporary directory for a dashboard
 */
export async function createTempDashboardDir(prefix: string = "pi-dashboard"): Promise<string> {
  const tempDir = process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const dirName = `${prefix}-${timestamp}-${randomSuffix}`;
  const fullPath = join(tempDir, dirName);

  await fs.mkdir(fullPath, { recursive: true });
  return fullPath;
}

/**
 * Write content to a file, creating parent directories if needed
 */
export async function writeFileWithDirs(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path, content);
}

/**
 * Check if a path is within a parent directory
 */
export function isPathWithin(path: string, parent: string): boolean {
  const resolvedPath = join(path);
  const resolvedParent = join(parent);

  // Normalize paths for comparison
  const normalizedPath = resolvedPath.replace(/\/$/, "");
  const normalizedParent = resolvedParent.replace(/\/$/, "");

  // Check if path starts with parent
  return normalizedPath.startsWith(normalizedParent + "/") ||
         normalizedPath === normalizedParent;
}

/**
 * Find the project root by checking for git, package.json, or use cwd
 */
export async function findProjectRoot(startPath: string): Promise<string> {
  const pathsToCheck = [
    // Check for git root
    async (path: string): Promise<string | null> => {
      try {
        const gitDir = join(path, ".git");
        const stats = await fs.stat(gitDir);
        if (stats.isDirectory()) {
          return path;
        }
      } catch {
        // .git doesn't exist
      }
      return null;
    },
    // Check for package.json
    async (path: string): Promise<string | null> => {
      try {
        const pkgJson = join(path, "package.json");
        const stats = await fs.stat(pkgJson);
        if (stats.isFile()) {
          return path;
        }
      } catch {
        // package.json doesn't exist
      }
      return null;
    },
  ];

  let currentPath = startPath;

  while (true) {
    // Check if current path is a root
    for (const check of pathsToCheck) {
      const result = await check(currentPath);
      if (result) {
        return result;
      }
    }

    // Move up one directory
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      // Reached filesystem root
      break;
    }
    currentPath = parentPath;
  }

  // Fall back to startPath
  return startPath;
}
