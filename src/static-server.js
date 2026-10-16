#!/usr/bin/env node
/**
 * Simple static file server for pi-tailscale-serve
 * Serves files from a directory on a specified port
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const targetPath = process.argv[2] || process.cwd();
const port = parseInt(process.argv[3] || '0', 10);

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

const resolvedRoot = path.resolve(targetPath);

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  let filepath = path.join(resolvedRoot, parsedUrl.pathname || '');
  
  // Security: prevent directory traversal
  // Normalize the path and ensure it's within the root directory
  const normalizedPath = path.normalize(filepath);
  if (!normalizedPath.startsWith(resolvedRoot + path.sep) && 
      !normalizedPath.startsWith(resolvedRoot)) {
    res.writeHead(403);
    res.end('Forbidden: directory traversal detected');
    return;
  }
  
  // Default to index.html for directory requests
  try {
    const stats = fs.statSync(filepath);
    if (stats.isDirectory()) {
      filepath = path.join(filepath, 'index.html');
    }
  } catch (e) {
    // File doesn't exist, try index.html
    if (e.code === 'ENOENT') {
      const indexPath = path.join(filepath, 'index.html');
      try {
        fs.statSync(indexPath);
        filepath = indexPath;
      } catch (e2) {
        // index.html doesn't exist either
      }
    }
  }
  
  fs.readFile(filepath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(500);
      res.end('Server Error');
      return;
    }
    
    const ext = path.extname(filepath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Static server running on port ${port}`);
});

// Handle cleanup
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
