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

const server = http.createServer((req, res) => {
  let filepath = path.join(targetPath, url.parse(req.url!).pathname);
  
  // Security: prevent directory traversal
  if (!filepath.startsWith(path.resolve(targetPath) + path.sep) && 
      !filepath.startsWith(path.resolve(targetPath))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  // Default to index.html
  if (filepath.endsWith(path.sep)) {
    filepath = path.join(filepath, 'index.html');
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
