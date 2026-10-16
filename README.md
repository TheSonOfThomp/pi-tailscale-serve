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

# Or from GitHub (once published)
pi install github:adam/pi-tailscale-serve
```

Pi will automatically:
- Build the extension (if source files are present)
- Add it to your settings
- Load it on startup

### Manual installation

1. Clone this repository:
   ```bash
   git clone https://github.com/your-username/pi-tailscale-serve.git
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

### Serve a static dashboard

```
/serve a static dashboard from ./my-dashboard
```

Or explicitly:
```
/tailscale-serve.serve_static path:./my-dashboard persist:true
```

### Serve a React app

```
/tailscale-serve.serve_react path:./my-react-app
```

The extension will:
1. Detect it's a React app (via package.json)
2. Start the dev server on an OS-assigned port
3. Expose it via `tailscale serve <port>`
4. Return the Tailscale URL

### Serve a Vue app

```
/tailscale-serve.serve_vue path:./my-vue-app
```

### Serve a Next.js app

```
/tailscale-serve.serve_next path:./my-next-app
```

### Auto-detect and serve

```
/tailscale-serve.serve_dashboard path:./my-dashboard
```

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
