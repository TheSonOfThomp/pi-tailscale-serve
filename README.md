# Pi Tailscale Serve Extension

A [Pi coding agent](https://github.com/earendil-works/pi) extension that enables agents to serve temporary dashboards via [Tailscale](https://tailscale.com).

## Features

- Serve static HTML dashboards
- Serve framework-based dashboards (React, Vue, Next.js)
- Serve dynamic content (JSON, Markdown)
- Automatic inactivity-based cleanup (7 days default)
- Full Tailscale Magic DNS URL support
- Port conflict detection and management
- Comprehensive error handling with retry logic

## Installation

### Using `pi install` (Recommended)

```bash
# Install from local path
pi install /Users/adam/Documents/GitHub/pi-tailscale-serve

# Or install globally
pi install /Users/adam/Documents/GitHub/pi-tailscale-serve -l

# Or from GitHub (SSH - works with private repos)
pi install git@github.com:TheSonOfThomp/pi-tailscale-serve
```

**Note:** For private GitHub repositories, use the SSH form (`git@github.com:user/repo`) as Pi treats `github:user/repo` as a local path. HTTPS form requires credentials and may not work.

**Note:** The extension is written in TypeScript but includes a `pi` manifest, so Pi will load the source directly without needing to build.

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

Add to your Pi `settings.json`:

```json
{
  "tailscaleServe": {
    "inactivityTimeoutDays": 7,
    "portRange": {
      "min": 3000,
      "max": 11000
    }
  }
}
```

### Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `inactivityTimeoutDays` | number | 7 | Days of inactivity before auto-cleanup |
| `portRange.min` | number | 3000 | Minimum port for auto-allocation |
| `portRange.max` | number | 11000 | Maximum port for auto-allocation |

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
