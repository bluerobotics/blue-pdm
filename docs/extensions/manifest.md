# Extension Manifest Reference

The extension manifest (`extension.json`) is the declaration file that tells BluePLM everything about your extension. This document covers every field in complete detail.

## Quick Reference

```json
{
  "$schema": "https://blueplm.io/schemas/extension-v1.schema.json",
  "id": "publisher.extension-name",
  "name": "Display Name",
  "version": "1.0.0",
  "publisher": "publisher",
  "description": "What your extension does",
  "icon": "icon.png",
  "repository": "https://github.com/...",
  "license": "MIT",
  "keywords": ["sync", "integration"],
  "categories": ["sync"],
  "category": "sandboxed",
  "engines": { "blueplm": "^1.0.0" },
  "extensionDependencies": [],
  "extensionPack": [],
  "main": "client/index.js",
  "serverMain": "server/index.js",
  "activationEvents": ["onExtensionEnabled"],
  "contributes": { ... },
  "permissions": { ... }
}
```

---

## Identity Fields

### id (required)

**Type:** `string`  
**Pattern:** `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`

Unique identifier for your extension. Must be in `publisher.name` format.

```json
"id": "blueplm.google-drive"
"id": "mycompany.erp-connector"
"id": "johndoe.file-watcher"
```

**Rules:**
- Must start with your publisher slug
- Only lowercase letters, numbers, and hyphens
- Cannot be changed after publishing
- Must be unique across all extensions

---

### name (required)

**Type:** `string`  
**Min Length:** 1  
**Max Length:** 100

Human-readable display name shown in the UI and store.

```json
"name": "Google Drive"
"name": "ERP Connector"
```

---

### version (required)

**Type:** `string`  
**Pattern:** Semantic versioning (e.g., `1.2.3`, `1.0.0-beta.1`)

Extension version following [semver](https://semver.org/).

```json
"version": "1.0.0"
"version": "2.1.0-beta.1"
"version": "0.9.0+build.123"
```

**Version Bumping Guidelines:**
- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
- **MINOR** (1.0.0 → 1.1.0): New features, backward compatible
- **PATCH** (1.0.0 → 1.0.1): Bug fixes

---

### publisher (required)

**Type:** `string`  
**Pattern:** `^[a-z][a-z0-9-]*$`

Publisher identifier. Must match the prefix of your extension `id`.

```json
"publisher": "blueplm"
"publisher": "mycompany"
```

**Note:** Register as a publisher at [extensions.blueplm.io](https://extensions.blueplm.io) before publishing.

---

## Metadata Fields

### description

**Type:** `string`  
**Max Length:** 500

Short description shown in the extension store.

```json
"description": "Sync your engineering files with Google Drive. Supports automatic sync, conflict resolution, and shared drive access."
```

---

### icon

**Type:** `string`

Path to the extension icon (relative to package root).

```json
"icon": "icon.png"
"icon": "assets/icon.png"
```

**Requirements:**
- PNG format
- 128×128 pixels recommended
- Square aspect ratio
- Transparent background supported

---

### repository

**Type:** `string` (URL)

Source code repository URL. **Required for store submission.**

```json
"repository": "https://github.com/mycompany/blueplm-extension"
```

---

### license (required)

**Type:** `string`

OSI-approved license identifier. All BluePLM extensions must be open source.

```json
"license": "MIT"
"license": "Apache-2.0"
"license": "GPL-3.0"
```

**Common Licenses:**
| License | Description |
|---------|-------------|
| `MIT` | Permissive, simple |
| `Apache-2.0` | Permissive with patent grant |
| `GPL-3.0` | Copyleft |
| `BSD-3-Clause` | Permissive |

---

### keywords

**Type:** `string[]`

Keywords for store search.

```json
"keywords": ["sync", "cloud", "backup", "google"]
```

---

### categories

**Type:** `string[]`

Store categories for filtering.

```json
"categories": ["sync", "integration", "productivity"]
```

**Available Categories:**
- `sync` — File synchronization
- `integration` — Third-party integrations
- `productivity` — Workflow tools
- `cad` — CAD software integrations
- `erp` — ERP system connectors
- `devtools` — Developer tools
- `themes` — Visual themes
- `language` — Localization

---

### changelog

**Type:** `string`

Inline changelog or release notes (markdown supported).

```json
"changelog": "## 1.1.0\n- Added batch sync\n- Fixed memory leak\n\n## 1.0.0\n- Initial release"
```

---

## Extension Category

### category

**Type:** `"sandboxed" | "native"`  
**Default:** `"sandboxed"`

Determines execution environment and trust requirements.

```json
"category": "sandboxed"
```

| Category | Environment | Trust Level | Use Case |
|----------|-------------|-------------|----------|
| `sandboxed` | Extension Host + V8 isolate | Community or Verified | Most extensions |
| `native` | Main Electron process | Verified only | SolidWorks, native code |

---

### native

**Type:** `object`  
**Required when:** `category` is `"native"`

Configuration for native extensions.

```json
"native": {
  "platforms": ["win32", "darwin"],
  "electronMain": "main/native.js",
  "requiresAdmin": false,
  "nativeDependencies": ["solidworks-sdk.dll"]
}
```

**Properties:**

| Field | Type | Description |
|-------|------|-------------|
| `platforms` | `("win32" \| "darwin" \| "linux")[]` | Supported platforms (required) |
| `electronMain` | `string` | Entry point for main process code |
| `requiresAdmin` | `boolean` | Needs elevated privileges |
| `nativeDependencies` | `string[]` | Bundled native binaries |

---

## Dependency Fields

### engines (required)

**Type:** `{ blueplm: string }`

Required BluePLM application version.

```json
"engines": {
  "blueplm": "^1.0.0"
}
```

**Version Ranges:**
| Pattern | Meaning |
|---------|---------|
| `^1.0.0` | Compatible with 1.x.x (≥1.0.0, <2.0.0) |
| `~1.2.0` | Patch updates only (≥1.2.0, <1.3.0) |
| `>=1.5.0` | 1.5.0 or higher |
| `1.0.0` | Exactly 1.0.0 |

---

### extensionDependencies

**Type:** `string[]`

Other extensions this extension depends on.

```json
"extensionDependencies": [
  "blueplm.core-utils@^1.0.0",
  "blueplm.oauth-helper@^2.0.0"
]
```

**Format:** `publisher.name@version-range`

The system ensures dependencies are installed and activated before your extension.

---

### extensionPack

**Type:** `string[]`

Bundle multiple extensions together as a pack.

```json
"extensionPack": [
  "blueplm.google-drive",
  "blueplm.dropbox",
  "blueplm.onedrive"
]
```

Installing the pack installs all listed extensions.

---

## Entry Points

### main

**Type:** `string`

Client-side entry point (runs in Extension Host).

```json
"main": "client/index.js"
```

**Must export:**
```typescript
export function activate(context: ExtensionContext, api: ExtensionClientAPI): void | Promise<void>
export function deactivate?(): void | Promise<void>
```

---

### serverMain

**Type:** `string`

Server-side entry point (runs in V8 isolate on org's API).

```json
"serverMain": "server/index.js"
```

Used as a default handler or for initialization. Individual route handlers are specified in `contributes.apiRoutes`.

---

## Activation Events

### activationEvents (required)

**Type:** `string[]`  
**Min Items:** 1

Events that trigger extension activation. Extensions are lazy-loaded for performance.

```json
"activationEvents": [
  "onExtensionEnabled",
  "onCommand:myext.doThing",
  "onNavigate:settings/extensions/myext"
]
```

**Available Events:**

| Event | When Triggered |
|-------|----------------|
| `onExtensionEnabled` | User enables the extension |
| `onStartup` | BluePLM application starts |
| `onCommand:commandId` | Command is executed |
| `onNavigate:route` | User navigates to route |
| `onView:viewId` | View is opened |
| `onFileType:extension` | File with extension is opened |

**Examples:**
```json
"activationEvents": [
  "onExtensionEnabled",
  "onCommand:google-drive.sync",
  "onNavigate:settings/extensions/google-drive",
  "onView:google-drive.panel",
  "onFileType:.sldprt"
]
```

**Best Practice:** Use specific events for faster startup. Avoid `onStartup` unless necessary.

---

## Contributions

The `contributes` object declares what your extension adds to BluePLM.

### contributes.views

**Type:** `ViewContribution[]`

UI views (panels, sidebar items, dialogs).

```json
"contributes": {
  "views": [
    {
      "id": "myext.main-panel",
      "name": "My Extension",
      "icon": "box",
      "location": "panel",
      "component": "client/components/MainPanel.js",
      "when": "vault.isOpen"
    },
    {
      "id": "myext.sidebar-item",
      "name": "My Extension",
      "icon": "puzzle",
      "location": "sidebar",
      "component": "client/components/SidebarView.js"
    }
  ]
}
```

**View Properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✓ | Unique view identifier |
| `name` | `string` | ✓ | Display name |
| `icon` | `string` | | Lucide icon name |
| `location` | `"sidebar" \| "panel" \| "settings" \| "dialog"` | ✓ | Where to render |
| `component` | `string` | ✓ | React component path |
| `when` | `string` | | Condition expression |

**Locations:**
- `sidebar` — Main sidebar navigation
- `panel` — Content panel area
- `settings` — Settings page
- `dialog` — Modal dialog

---

### contributes.commands

**Type:** `CommandContribution[]`

Executable commands for command palette and keybindings.

```json
"contributes": {
  "commands": [
    {
      "id": "myext.sync-now",
      "title": "Sync Now",
      "icon": "refresh-cw",
      "keybinding": "Ctrl+Shift+S",
      "category": "My Extension",
      "when": "vault.isOpen"
    },
    {
      "id": "myext.open-settings",
      "title": "Open Settings",
      "category": "My Extension"
    }
  ]
}
```

**Command Properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✓ | Unique command identifier |
| `title` | `string` | ✓ | Display name in command palette |
| `icon` | `string` | | Lucide icon name |
| `keybinding` | `string` | | Keyboard shortcut |
| `category` | `string` | | Grouping in command palette |
| `when` | `string` | | When command is enabled |

**Keybinding Format:**
```
Ctrl+Shift+S        // Windows/Linux
Cmd+Shift+S         // macOS
Ctrl+Alt+K          // Modifier combinations
F5                  // Function keys
```

---

### contributes.settings

**Type:** `SettingsContribution[]`

Settings pages in the Settings panel.

```json
"contributes": {
  "settings": [
    {
      "id": "myext.settings",
      "name": "My Extension",
      "description": "Configure My Extension",
      "icon": "settings",
      "component": "client/components/Settings.js",
      "category": "extensions"
    }
  ]
}
```

**Settings Properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✓ | Unique settings page ID |
| `name` | `string` | ✓ | Display name |
| `description` | `string` | | Description text |
| `icon` | `string` | | Lucide icon name |
| `component` | `string` | ✓ | React component path |
| `category` | `"account" \| "organization" \| "extensions" \| "system"` | | Parent category |

---

### contributes.apiRoutes

**Type:** `ApiRouteContribution[]`

Server-side HTTP endpoints.

```json
"contributes": {
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
      "rateLimit": 10
    }
  ]
}
```

**Route Properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | `"GET" \| "POST" \| "PUT" \| "PATCH" \| "DELETE"` | ✓ | HTTP method |
| `path` | `string` | ✓ | Route path (relative to `/extensions/{id}/`) |
| `handler` | `string` | ✓ | Handler file path |
| `public` | `boolean` | | No auth required (admin approval needed). **Not honoured yet** — see [Public Endpoints](./contributions.md#public-endpoints) |
| `rateLimit` | `number` | | Requests per minute (overrides default) |

**Final URLs:**
```
POST /extensions/myext/sync      → handler: server/sync.js
GET  /extensions/myext/status    → handler: server/status.js
POST /extensions/myext/webhook   → handler: server/webhook.js (public)
```

---

### contributes.configuration

**Type:** `ConfigurationContribution`

Extension settings schema (auto-generates UI).

```json
"contributes": {
  "configuration": {
    "title": "My Extension Settings",
    "properties": {
      "syncInterval": {
        "type": "number",
        "default": 300,
        "minimum": 60,
        "maximum": 3600,
        "description": "Sync interval in seconds"
      },
      "autoSync": {
        "type": "boolean",
        "default": true,
        "description": "Enable automatic sync"
      },
      "excludePatterns": {
        "type": "array",
        "items": { "type": "string" },
        "default": ["*.tmp"],
        "description": "File patterns to exclude"
      },
      "logLevel": {
        "type": "string",
        "enum": ["debug", "info", "warn", "error"],
        "enumDescriptions": [
          "All messages",
          "Info and above",
          "Warnings and errors",
          "Errors only"
        ],
        "default": "info",
        "description": "Logging verbosity"
      }
    }
  }
}
```

**Property Types:**

| Type | UI Control | Example |
|------|------------|---------|
| `string` | Text input | `"hello"` |
| `number` | Number input | `300` |
| `boolean` | Checkbox | `true` |
| `array` | List editor | `["a", "b"]` |
| `object` | Nested form | `{ key: "value" }` |

**Property Options:**

| Field | Types | Description |
|-------|-------|-------------|
| `default` | all | Default value |
| `description` | all | Help text |
| `enum` | string, number | Allowed values (shows dropdown) |
| `enumDescriptions` | string, number | Labels for enum values |
| `minimum` | number | Minimum value |
| `maximum` | number | Maximum value |
| `items` | array | Schema for array items |
| `properties` | object | Schema for object properties |
| `order` | all | Display order (lower = first) |
| `deprecationMessage` | all | Deprecation warning |

---

## Permissions

### permissions (required)

**Type:** `{ client?: string[], server?: string[] }`

Required permissions for API access. Users see these before installing.

```json
"permissions": {
  "client": [
    "ui:toast",
    "ui:dialog",
    "ui:progress",
    "storage:local",
    "network:orgApi",
    "commands:register",
    "commands:execute",
    "workspace:files",
    "workspace:vaults",
    "telemetry"
  ],
  "server": [
    "storage:database",
    "secrets:read",
    "secrets:write",
    "http:domain:api.googleapis.com",
    "http:domain:accounts.google.com"
  ]
}
```

See [Permissions Reference](./permissions.md) for complete documentation.

---

## Complete Example

```json
{
  "$schema": "https://blueplm.io/schemas/extension-v1.schema.json",
  "id": "blueplm.google-drive",
  "name": "Google Drive",
  "version": "1.2.0",
  "publisher": "blueplm",
  "description": "Sync engineering files with Google Drive. Supports automatic sync, shared drives, and conflict resolution.",
  "icon": "icon.png",
  "repository": "https://github.com/bluerobotics/blueplm-google-drive",
  "license": "MIT",
  "keywords": ["sync", "cloud", "google", "drive", "backup"],
  "categories": ["sync", "integration"],
  "category": "sandboxed",
  "engines": {
    "blueplm": "^1.0.0"
  },
  "main": "client/index.js",
  "serverMain": "server/index.js",
  "activationEvents": [
    "onExtensionEnabled",
    "onCommand:google-drive.sync",
    "onNavigate:settings/extensions/google-drive"
  ],
  "contributes": {
    "views": [
      {
        "id": "google-drive.panel",
        "name": "Google Drive",
        "icon": "cloud",
        "location": "panel",
        "component": "client/components/DrivePanel.js"
      }
    ],
    "commands": [
      {
        "id": "google-drive.sync",
        "title": "Sync with Google Drive",
        "icon": "refresh-cw",
        "keybinding": "Ctrl+Shift+G",
        "category": "Google Drive"
      },
      {
        "id": "google-drive.disconnect",
        "title": "Disconnect Google Account",
        "category": "Google Drive"
      }
    ],
    "settings": [
      {
        "id": "google-drive.settings",
        "name": "Google Drive",
        "description": "Configure Google Drive sync",
        "icon": "cloud",
        "component": "client/components/Settings.js",
        "category": "extensions"
      }
    ],
    "apiRoutes": [
      {
        "method": "POST",
        "path": "connect",
        "handler": "server/connect.js"
      },
      {
        "method": "POST",
        "path": "sync",
        "handler": "server/sync.js"
      },
      {
        "method": "GET",
        "path": "oauth-callback",
        "handler": "server/oauth-callback.js",
        "public": true
      }
    ],
    "configuration": {
      "title": "Google Drive",
      "properties": {
        "syncInterval": {
          "type": "number",
          "default": 300,
          "minimum": 60,
          "maximum": 3600,
          "description": "Automatic sync interval in seconds"
        },
        "autoSync": {
          "type": "boolean",
          "default": true,
          "description": "Enable automatic synchronization"
        },
        "conflictResolution": {
          "type": "string",
          "enum": ["ask", "local", "remote", "newest"],
          "enumDescriptions": [
            "Ask for each conflict",
            "Keep local version",
            "Keep remote version",
            "Keep newest version"
          ],
          "default": "ask",
          "description": "How to handle sync conflicts"
        }
      }
    }
  },
  "permissions": {
    "client": [
      "ui:toast",
      "ui:dialog",
      "ui:status",
      "ui:progress",
      "storage:local",
      "network:orgApi",
      "commands:register",
      "workspace:files"
    ],
    "server": [
      "storage:database",
      "secrets:read",
      "secrets:write",
      "http:domain:googleapis.com",
      "http:domain:accounts.google.com"
    ]
  }
}
```

---

## Validation

Use the JSON Schema for editor autocomplete and validation:

```json
{
  "$schema": "https://blueplm.io/schemas/extension-v1.schema.json"
}
```

Validate with the CLI:
```bash
blueplm-ext validate extension.json
```

---

**[← Getting Started](./getting-started.md)** | **[Client API Reference →](./client-api.md)**
