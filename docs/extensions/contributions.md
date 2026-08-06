# Contributions Reference

The `contributes` section of your manifest declares what your extension adds to BluePLM. This reference covers all contribution types with detailed examples.

## Overview

```json
"contributes": {
  "views": [...],           // UI panels and views
  "commands": [...],        // Executable commands
  "settings": [...],        // Settings pages
  "apiRoutes": [...],       // Server-side routes
  "configuration": {...}    // Extension settings schema
}
```

---

## Views

Views add UI components to BluePLM in various locations.

### View Locations

| Location | Description | Example Use |
|----------|-------------|-------------|
| `sidebar` | Main navigation sidebar | Extension main view |
| `panel` | Content area panels | File browsers, status displays |
| `settings` | Settings page | Configuration UI |
| `dialog` | Modal dialogs | Wizards, confirmations |

### Schema

```json
{
  "id": "myext.main-panel",
  "name": "My Extension",
  "icon": "box",
  "location": "panel",
  "component": "client/components/MainPanel.js",
  "when": "vault.isOpen"
}
```

### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | ✓ | Unique view identifier |
| `name` | `string` | ✓ | Display name |
| `icon` | `string` | | Lucide icon name |
| `location` | `string` | ✓ | Where to render |
| `component` | `string` | ✓ | Component file path |
| `when` | `string` | | Condition expression |

### When Conditions

| Condition | Description |
|-----------|-------------|
| `vault.isOpen` | A vault is currently open |
| `user.isAdmin` | User has admin role |
| `platform.isWindows` | Running on Windows |
| `platform.isMac` | Running on macOS |
| `extension.isConfigured` | Extension has been configured |

### Examples

**Sidebar View:**
```json
{
  "views": [
    {
      "id": "google-drive.sidebar",
      "name": "Google Drive",
      "icon": "cloud",
      "location": "sidebar",
      "component": "client/views/Sidebar.js"
    }
  ]
}
```

**Panel with Condition:**
```json
{
  "views": [
    {
      "id": "cad-preview.panel",
      "name": "CAD Preview",
      "icon": "cube",
      "location": "panel",
      "component": "client/views/CADPreview.js",
      "when": "file.extension == '.sldprt'"
    }
  ]
}
```

### Component Implementation

View components receive props with the extension API:

```tsx
// client/views/MainPanel.tsx
import type { ExtensionClientAPI } from '@blueplm/extension-api'

interface ViewProps {
  api: ExtensionClientAPI
}

export default function MainPanel({ api }: ViewProps) {
  const [files, setFiles] = useState<string[]>([])
  
  useEffect(() => {
    // Load data using API
    api.storage.get<string[]>('cachedFiles').then(cached => {
      if (cached) setFiles(cached)
    })
  }, [api])
  
  async function handleSync() {
    await api.commands.executeCommand('myext.sync')
  }
  
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold">My Extension</h2>
      <button onClick={handleSync}>Sync Now</button>
      <ul>
        {files.map(f => <li key={f}>{f}</li>)}
      </ul>
    </div>
  )
}
```

---

## Commands

Commands are executable actions available via command palette and keybindings.

### Schema

```json
{
  "id": "myext.sync-now",
  "title": "Sync Now",
  "icon": "refresh-cw",
  "keybinding": "Ctrl+Shift+S",
  "category": "My Extension",
  "when": "vault.isOpen"
}
```

### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | ✓ | Unique command identifier |
| `title` | `string` | ✓ | Display name in command palette |
| `icon` | `string` | | Lucide icon name |
| `keybinding` | `string` | | Keyboard shortcut |
| `category` | `string` | | Grouping in palette |
| `when` | `string` | | When command is enabled |

### Keybinding Format

```
Ctrl+S              // Single modifier
Ctrl+Shift+S        // Multiple modifiers
Ctrl+Alt+K          // Ctrl + Alt
Cmd+S               // macOS Command key
F5                  // Function key
Ctrl+K Ctrl+S       // Chord (two-step)
```

**Platform-specific:**
- Windows/Linux: Use `Ctrl`
- macOS: Use `Cmd` (or `Ctrl` for both platforms)

### Command Categories

Group related commands with a category:

```json
{
  "commands": [
    {
      "id": "myext.sync",
      "title": "Sync Files",
      "category": "My Extension"
    },
    {
      "id": "myext.configure",
      "title": "Configure",
      "category": "My Extension"
    }
  ]
}
```

In command palette appears as:
- `My Extension: Sync Files`
- `My Extension: Configure`

### Registering Command Handlers

Commands declared in manifest must be registered in code:

```typescript
// client/index.ts
export async function activate(context, api) {
  // Register handlers for manifest commands
  context.subscriptions.push(
    api.commands.registerCommand('myext.sync-now', async () => {
      // Handler implementation
      await performSync(api)
    }),
    
    api.commands.registerCommand('myext.configure', async () => {
      // Open configuration dialog
      await showConfigDialog(api)
    })
  )
}
```

### Dynamic Commands

Register commands not in manifest (won't appear in command palette):

```typescript
context.subscriptions.push(
  api.commands.registerCommand('myext.internal-action', handler, {
    hidden: true
  })
)
```

---

## Settings

Settings pages appear in the Settings panel under your extension.

### Schema

```json
{
  "id": "myext.settings",
  "name": "My Extension",
  "description": "Configure synchronization settings",
  "icon": "settings",
  "component": "client/components/Settings.js",
  "category": "extensions"
}
```

### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | ✓ | Unique settings ID |
| `name` | `string` | ✓ | Display name |
| `description` | `string` | | Description text |
| `icon` | `string` | | Lucide icon name |
| `component` | `string` | ✓ | Settings component path |
| `category` | `string` | | Parent category |

### Categories

| Category | Description |
|----------|-------------|
| `account` | User account settings |
| `organization` | Organization settings |
| `extensions` | Extension settings (default) |
| `system` | System/app settings |

### Settings Component

```tsx
// client/components/Settings.tsx
import { useState, useEffect } from 'react'
import type { ExtensionClientAPI } from '@blueplm/extension-api'

interface SettingsProps {
  api: ExtensionClientAPI
}

export default function Settings({ api }: SettingsProps) {
  const [autoSync, setAutoSync] = useState(true)
  const [interval, setInterval] = useState(300)
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    // Load saved settings
    async function load() {
      const saved = await api.storage.get<Settings>('settings')
      if (saved) {
        setAutoSync(saved.autoSync ?? true)
        setInterval(saved.interval ?? 300)
      }
      setLoading(false)
    }
    load()
  }, [api])
  
  async function handleSave() {
    await api.storage.set('settings', { autoSync, interval })
    api.ui.showToast('Settings saved', 'success')
  }
  
  if (loading) return <div>Loading...</div>
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Sync Settings</h2>
        <p className="text-gray-500">Configure automatic synchronization</p>
      </div>
      
      <div className="space-y-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoSync}
            onChange={e => setAutoSync(e.target.checked)}
          />
          <span>Enable automatic sync</span>
        </label>
        
        <div>
          <label className="block text-sm font-medium mb-1">
            Sync interval (seconds)
          </label>
          <input
            type="number"
            value={interval}
            onChange={e => setInterval(Number(e.target.value))}
            min={60}
            max={3600}
            className="border rounded px-3 py-2 w-32"
          />
        </div>
      </div>
      
      <button
        onClick={handleSave}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Save Settings
      </button>
    </div>
  )
}
```

---

## API Routes

Server-side HTTP endpoints for your extension.

### Schema

```json
{
  "method": "POST",
  "path": "sync",
  "handler": "server/sync.js",
  "public": false,
  "rateLimit": 100
}
```

### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `method` | `string` | ✓ | HTTP method |
| `path` | `string` | ✓ | Route path |
| `handler` | `string` | ✓ | Handler file path |
| `public` | `boolean` | | No auth required |
| `rateLimit` | `number` | | Requests per minute |

### Supported Methods

- `GET` — Retrieve data
- `POST` — Create/action
- `PUT` — Replace/update
- `PATCH` — Partial update
- `DELETE` — Remove

### Route URLs

Routes are mounted at `/extensions/{extensionId}/`:

```json
{ "method": "POST", "path": "sync", "handler": "server/sync.js" }
// → POST /extensions/myext/sync

{ "method": "GET", "path": "status", "handler": "server/status.js" }
// → GET /extensions/myext/status

{ "method": "GET", "path": "files/:id", "handler": "server/file.js" }
// → GET /extensions/myext/files/123
```

### Public Endpoints

> **Not currently reachable.** `public` is accepted and recorded, but every
> extension endpoint requires a token today, so a caller without one is refused
> before the handler runs. Serving a handler to an anonymous caller means
> deciding which organization it belongs to without a credential, and the only
> mechanism for that was an `X-Org-Id` request header — which let any caller
> name any organization. Until an unguessable per-installation URL replaces it,
> do not ship a webhook receiver or OAuth callback that depends on this. The
> server logs a warning naming any route declared this way.

Public endpoints are intended to skip authentication. Use for webhooks:

```json
{
  "method": "POST",
  "path": "webhook",
  "handler": "server/webhook.js",
  "public": true,
  "rateLimit": 10
}
```

**Note:** Public endpoints require admin approval for verified extensions.

### Handler Implementation

See [Server API Reference](./server-api.md) for handler details.

```typescript
// server/sync.js
export default async function handler(api) {
  if (!api.user) {
    return api.response.error('Unauthorized', 401)
  }
  
  const { vaultId } = api.request.body
  // ... sync logic
  
  return api.response.json({ success: true })
}
```

---

## Configuration

Typed configuration schema that auto-generates settings UI.

### Schema

```json
{
  "configuration": {
    "title": "My Extension Settings",
    "properties": {
      "propertyName": {
        "type": "string",
        "default": "value",
        "description": "Help text"
      }
    }
  }
}
```

### Property Types

#### String

```json
{
  "apiEndpoint": {
    "type": "string",
    "default": "https://api.example.com",
    "description": "API server endpoint"
  }
}
```

**With Enum (Dropdown):**
```json
{
  "logLevel": {
    "type": "string",
    "enum": ["debug", "info", "warn", "error"],
    "enumDescriptions": [
      "All messages including debug",
      "Info and above",
      "Warnings and errors only",
      "Errors only"
    ],
    "default": "info",
    "description": "Logging verbosity"
  }
}
```

#### Number

```json
{
  "syncInterval": {
    "type": "number",
    "default": 300,
    "minimum": 60,
    "maximum": 3600,
    "description": "Sync interval in seconds"
  },
  "maxRetries": {
    "type": "number",
    "enum": [1, 3, 5, 10],
    "default": 3,
    "description": "Maximum retry attempts"
  }
}
```

#### Boolean

```json
{
  "autoSync": {
    "type": "boolean",
    "default": true,
    "description": "Enable automatic synchronization"
  }
}
```

#### Array

```json
{
  "excludePatterns": {
    "type": "array",
    "items": { "type": "string" },
    "default": ["*.tmp", "*.bak", ".git/**"],
    "description": "File patterns to exclude from sync"
  },
  "allowedExtensions": {
    "type": "array",
    "items": {
      "type": "string",
      "enum": [".sldprt", ".sldasm", ".slddrw", ".step", ".iges"]
    },
    "default": [".sldprt", ".sldasm"],
    "description": "File extensions to sync"
  }
}
```

#### Object

```json
{
  "advancedOptions": {
    "type": "object",
    "properties": {
      "batchSize": {
        "type": "number",
        "default": 100
      },
      "timeout": {
        "type": "number",
        "default": 30000
      }
    },
    "description": "Advanced sync options"
  }
}
```

### Property Options

| Option | Types | Description |
|--------|-------|-------------|
| `type` | all | Data type (required) |
| `default` | all | Default value |
| `description` | all | Help text |
| `enum` | string, number | Allowed values |
| `enumDescriptions` | string, number | Labels for enum |
| `minimum` | number | Minimum value |
| `maximum` | number | Maximum value |
| `items` | array | Item schema |
| `properties` | object | Property schemas |
| `order` | all | Display order |
| `deprecationMessage` | all | Deprecation warning |

### Accessing Configuration

```typescript
export async function activate(context, api) {
  // Load from storage
  const syncInterval = await api.storage.get<number>('syncInterval')
  const autoSync = await api.storage.get<boolean>('autoSync')
  
  // Use with defaults from manifest
  const interval = syncInterval ?? 300
  const enabled = autoSync ?? true
  
  if (enabled) {
    startAutoSync(interval)
  }
}
```

### Deprecating Properties

```json
{
  "oldProperty": {
    "type": "string",
    "deprecationMessage": "Use 'newProperty' instead. Will be removed in 2.0.0"
  }
}
```

---

## Complete Example

```json
{
  "contributes": {
    "views": [
      {
        "id": "cloud-sync.sidebar",
        "name": "Cloud Sync",
        "icon": "cloud",
        "location": "sidebar",
        "component": "client/views/Sidebar.js"
      },
      {
        "id": "cloud-sync.status",
        "name": "Sync Status",
        "icon": "activity",
        "location": "panel",
        "component": "client/views/StatusPanel.js",
        "when": "vault.isOpen"
      }
    ],
    "commands": [
      {
        "id": "cloud-sync.sync",
        "title": "Sync Now",
        "icon": "refresh-cw",
        "keybinding": "Ctrl+Shift+Y",
        "category": "Cloud Sync",
        "when": "vault.isOpen"
      },
      {
        "id": "cloud-sync.pause",
        "title": "Pause Sync",
        "icon": "pause",
        "category": "Cloud Sync"
      },
      {
        "id": "cloud-sync.resume",
        "title": "Resume Sync",
        "icon": "play",
        "category": "Cloud Sync"
      }
    ],
    "settings": [
      {
        "id": "cloud-sync.settings",
        "name": "Cloud Sync",
        "description": "Configure cloud synchronization",
        "icon": "cloud",
        "component": "client/components/Settings.js",
        "category": "extensions"
      }
    ],
    "apiRoutes": [
      {
        "method": "POST",
        "path": "sync",
        "handler": "server/sync.js"
      },
      {
        "method": "GET",
        "path": "status",
        "handler": "server/status.js"
      },
      {
        "method": "POST",
        "path": "webhook",
        "handler": "server/webhook.js",
        "public": true,
        "rateLimit": 20
      }
    ],
    "configuration": {
      "title": "Cloud Sync Settings",
      "properties": {
        "autoSync": {
          "type": "boolean",
          "default": true,
          "description": "Automatically sync changes"
        },
        "syncInterval": {
          "type": "number",
          "default": 300,
          "minimum": 60,
          "maximum": 3600,
          "description": "Sync check interval (seconds)"
        },
        "conflictResolution": {
          "type": "string",
          "enum": ["ask", "local", "remote", "newest"],
          "enumDescriptions": [
            "Ask for each conflict",
            "Keep local version",
            "Keep remote version",
            "Keep newest by timestamp"
          ],
          "default": "ask",
          "description": "How to resolve sync conflicts"
        },
        "excludePatterns": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["*.tmp", ".git/**"],
          "description": "Patterns to exclude from sync"
        }
      }
    }
  }
}
```

---

**[← Server API Reference](./server-api.md)** | **[Permissions Reference →](./permissions.md)**
