# Pi Tailscale Serve Extension

A [Pi coding agent](https://github.com/earendil-works/pi) extension that enables agents to serve temporary dashboards via [Tailscale](https://tailscale.com).

## Features

- Serve static HTML dashboards
- Serve framework-based dashboards (React, Vue, Next.js) with HMR
- Serve dynamic content (JSON, Markdown)
- **NEVER uses port 443** to avoid conflicts with existing services (e.g., Caddy)
- Full Tailscale Magic DNS URL support with HTTPS
- Port conflict detection and management
- File-based state persistence across Pi sessions
- Comprehensive error handling with timeouts
- Proper cleanup of tailscale serve configs and processes

## Installation

### Using NPM (Recommended)

```bash
npm install -g pi-tailscale-serve
```

Then load it in Pi:
```bash
pi --extension pi-tailscale-serve
```

Or add to your Pi settings:
```json
{
  "extensions": ["pi-tailscale-serve"]
}
```

### Using `pi install`

```bash
# Install from NPM
pi install npm:pi-tailscale-serve

# Or from GitHub (public repo - no SSH needed)
pi install git:https://github.com/TheSonOfThomp/pi-tailscale-serve

# Or from local path (works for development)
pi install /Users/adam/Documents/GitHub/pi-tailscale-serve
```

For private repositories, ensure your SSH key is configured (without passphrase) and use:
```bash
pi install git:git@github.com:user/repo
```

**Note:** Pi requires the `git:` prefix for all git sources. Use:
- `git:https://github.com/user/repo` for public repos (no SSH needed)
- `git:git@github.com:user/repo` for private repos (requires SSH key without passphrase)

Pi treats `github:user/repo` (without `git:` prefix) as a local path.

## Safety

This extension is designed to be safe to run alongside other services:

- **NEVER uses port 443** - All dashboards are served on high-numbered ports (8000+) to avoid conflicts with Caddy, web servers, or other services
- **No `tailscale serve reset`** - Only manages configs it creates, never touches existing ones
- **Proper cleanup** - `stop` command removes both the tailscale serve config and the local server process
- **Port verification** - Checks if port 443 is in use before serving, and refuses to use it
- **Directory traversal protection** - Static file server validates all paths are within the served directory
- **State persistence** - Dashboard metadata is saved to `~/.pi/agent/tailscale-serve/state.json` and cleaned up on stop

**Note:** The extension is written in TypeScript but includes a `pi` manifest, so Pi will load the source directly without needing to build.

## Testing

Run the test suite to verify safety constraints:

```bash
npm test
```

The test suite verifies:
- ✅ Port 443 is never used for tailscale serve
- ✅ Correct `tailscale serve --https=<port> off` command (not `clear`)
- ✅ Static server JavaScript is valid (`node --check` passes)
- ✅ Static dashboards are exposed via tailscale serve
- ✅ Server startup verification with port polling
- ✅ State persistence is implemented
- ✅ Build completes without errors

### Manual Integration Tests

For full integration testing (requires tailscale and Caddy running):

```bash
# 1. Verify Caddy is working on port 443
curl -sS -o /dev/null -w '%{http_code}\n' https://omni.adamt.cc/
# Should return: 200

# 2. Serve a test dashboard
pi --print --no-session "Serve /tmp/test-dashboard"

# 3. Verify Caddy still works
curl -sS -o /dev/null -w '%{http_code}\n' https://omni.adamt.cc/
# Should return: 200

# 4. Check tailscale serve status (should show high port, never 443)
tailscale serve status

# 5. Stop the dashboard
pi --print --no-session "Stop that dashboard"

# 6. Verify tailscale serve config is removed
tailscale serve status
# Should show: No serve config

# 7. Verify Caddy still works
curl -sS -o /dev/null -w '%{http_code}\n' https://omni.adamt.cc/
# Should return: 200
```

Pi will automatically:
- Build the extension (if source files are present)
- Add it to your settings
- Load it on startup

### Manual installation

1. Clone this repository (use SSH for private repos):
   ```bash
   git clone git@github.com:TheSonOfThomp/pi-tailscale-serve.git
   cd pi-tailscale-serve
   npm install
   npm run build
   ```

2. Load the extension in Pi:
   ```bash
   pi --extension ./dist/index.js
   ```

3. Or add to your Pi settings:
   ```json
   {
     "extensions": ["/Users/adam/Documents/GitHub/pi-tailscale-serve/dist/index.js"]
   }
   ```

## Development

### Releasing

This project uses [Changesets](https://github.com/changesets/changesets) for version management and changelog generation.

To create a new release:

```bash
# Create a changeset (interactive prompt)
npx changeset

# Or specify the type explicitly
npx changeset add --type patch
```

The GitHub Actions workflow will:
1. Detect changeset files on the main branch
2. Update versions in package.json
3. Update CHANGELOG.md
4. Publish to npm (requires NPM_TOKEN secret)
5. Commit and push the version bump

To manually publish (without CI):

```bash
npm run build
npm run prepublishOnly
npm publish --access public
```

## Usage

### Important: Framework Apps (React, Vue, Next.js)

**For framework-based apps, the extension automatically starts the dev server with HMR (Hot Module Replacement) enabled.** This means:

- ✅ **Live reloading** - Changes to your code are reflected immediately
- ✅ **Full dev experience** - Source maps, error overlays, etc.
- ✅ **No build step** - Uses `npm run dev` or similar

The extension detects the framework and runs the appropriate dev command:
- React: `npm run dev` (or `start`)
- Vue: `npm run dev`
- Next.js: `npm run dev`

### Serve a static dashboard

For plain HTML/CSS/JS files:
```
/serve a static dashboard from ./my-dashboard
```

Or explicitly:
```
/tailscale-serve.serve_dashboard path:./my-dashboard
```

### Serve a React app with HMR

```
/tailscale-serve.serve_dashboard path:./my-react-app
```

The extension will:
1. Detect it's a React app (via package.json)
2. Start `npm run dev` on an OS-assigned port
3. Expose it via `tailscale serve <port>`
4. Return the Tailscale URL
5. **HMR works** - Edit your React files and see changes live!

### Serve a Vue app with HMR

```
/tailscale-serve.serve_dashboard path:./my-vue-app
```

Same HMR benefits as React.

### Serve a Next.js app with HMR

```
/tailscale-serve.serve_dashboard path:./my-next-app
```

### Auto-detect and serve

For any dashboard type, just use:
```
/tailscale-serve.serve_dashboard path:./my-dashboard
```

The extension auto-detects:
- Static HTML → serves files directly
- React/Vue/Next.js → starts dev server with HMR
- JSON/Markdown → generates a viewer

### Natural language (auto-discoverable)

You can also use natural language:
```
Serve this folder
Make this React app accessible
Host my dashboard
Share this with my team
```

The model will automatically invoke the appropriate tool.

The extension will auto-detect the type based on file extensions and directory contents.

### List active dashboards

```
/tailscale-serve.list_dashboards
```

### Stop a dashboard

```
/tailscale-serve.stop port:3000
```

Or by URL:
```
/tailscale-serve.stop url:https://m4.liger-pentatonic.ts.net:8080
```

Or by path:
```
/tailscale-serve.stop path:./my-dashboard
```

### Get dashboard logs

```
/tailscale-serve.get_dashboard_logs id:abc123
```

## Configuration

### Configuration

The extension uses high-numbered ports (8000+) by default to avoid conflicts. Dashboard state is persisted to `~/.pi/agent/tailscale-serve/state.json`.

Retry settings are inherited from Pi's main `retry` configuration.

## Project Structure

```
pi-tailscale-serve/
├── src/
│   ├── index.ts              # Main extension entry point
│   ├── config.ts             # Configuration loading
│   ├── tracker.ts            # Dashboard tracking
│   ├── cleaner.ts            # Inactivity cleanup
│   ├── tools/
│   │   ├── serve-static.ts   # Static file serving
│   │   ├── serve-react.ts    # React dev server
│   │   ├── serve-vue.ts      # Vue dev server
│   │   ├── serve-next.ts     # Next.js server
│   │   ├── serve-dynamic.ts  # Dynamic content
│   │   ├── serve-dashboard.ts # Auto-detection
│   │   ├── list-dashboards.ts
│   │   ├── stop.ts
│   │   └── get-logs.ts
│   └── utils/
│       ├── tailscale.ts      # Tailscale CLI wrapper
│       ├── filesystem.ts     # File operations
│       ├── validation.ts     # Dashboard validation
│       ├── port-manager.ts   # Port management
│       └── process-manager.ts # Process tracking
├── package.json
├── tsconfig.json
└── README.md
```

## Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the extension:
   ```bash
   npm run build
   ```

3. Run Pi with the extension:
   ```bash
   pi --extension ./dist/index.js
   ```

4. For development with hot reload:
   ```bash
   npm run watch
   # In another terminal
   pi --extension ./dist/index.js
   ```

## Requirements

- Node.js >= 18.0.0
- Pi coding agent >= 2026.7.1
- Tailscale installed and logged in

## License

MIT
