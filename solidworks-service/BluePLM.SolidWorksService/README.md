# BluePLM SolidWorks Service

A standalone service that provides SolidWorks file operations for the BluePLM Electron app.

**No separate license key needed** - just requires SolidWorks to be installed on the machine.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  BluePLM (Electron)                                         │
│                                                             │
│  User action (right-click → "View BOM" / "Export PDF")     │
│      │                                                      │
│      │ IPC → Main Process                                   │
│      ▼                                                      │
│  Spawns BluePLM.SolidWorksService.exe                       │
│      │                                                      │
│      │ JSON stdin/stdout                                    │
│      ▼                                                      │
│  SolidWorks API (runs SW hidden in background)             │
│      ├── Get BOM from assemblies                           │
│      ├── Read/write custom properties                      │
│      ├── Get configurations                                │
│      ├── Export PDF, STEP, IGES, DXF                      │
│      ├── Replace components                                │
│      └── Pack and Go                                       │
└─────────────────────────────────────────────────────────────┘
```

## Capabilities

| Operation | Description |
|-----------|-------------|
| `getBom` | Extract Bill of Materials with quantities, properties |
| `getProperties` | Read custom properties (file and config-level) |
| `setProperties` | Write custom properties |
| `getConfigurations` | List all configurations with their properties |
| `getReferences` | Get all external file references |
| `getMassProperties` | Get mass, volume, center of mass, moments of inertia |
| `exportPdf` | Export drawing to PDF |
| `exportStep` | Export part/assembly to STEP (single or all configs) |
| `exportIges` | Export to IGES format |
| `exportDxf` | Export drawing to DXF |
| `exportImage` | Export model view to PNG image |
| `replaceComponent` | Replace a part in an assembly |
| `packAndGo` | Copy assembly with all references |

## Building

### Prerequisites

- Visual Studio 2022 or .NET SDK 8.0+
- .NET Framework 4.8 SDK
- SolidWorks 2021+ installed (for API references)

### Build Steps

```bash
cd solidworks-addin

# Build the service
dotnet build BluePLM.SolidWorksService/BluePLM.SolidWorksService.csproj -c Release
```

Output: `BluePLM.SolidWorksService/bin/Release/BluePLM.SolidWorksService.exe`

## Command Line Usage

```bash
# Interactive mode (reads JSON from stdin)
BluePLM.SolidWorksService.exe --keep-sw-running

# Single command mode
BluePLM.SolidWorksService.exe --command '{"action":"ping"}'
```

### Options

| Option | Description |
|--------|-------------|
| `--keep-sw-running` | Don't close SolidWorks after operations (faster for batch) |
| `--command <json>` | Execute single command and exit |
| `--help` | Show help |

## JSON Protocol

Send JSON commands (one per line) to stdin, receive JSON responses on stdout.

### Example: Get BOM

```json
// Request
{"action": "getBom", "filePath": "C:\\Parts\\Assembly.sldasm"}

// Response
{
  "success": true,
  "data": {
    "assemblyPath": "C:\\Parts\\Assembly.sldasm",
    "configuration": "Default",
    "items": [
      {
        "fileName": "Widget.sldprt",
        "filePath": "C:\\Parts\\Widget.sldprt",
        "fileType": "Part",
        "quantity": 4,
        "configuration": "Default",
        "partNumber": "BR-12345",
        "description": "Widget Assembly",
        "material": "Aluminum 6061-T6",
        "revision": "A",
        "properties": { ... }
      }
    ],
    "totalParts": 15,
    "totalQuantity": 47
  }
}
```

### Example: Export All Configs to STEP

```json
// Request
{
  "action": "exportStep",
  "filePath": "C:\\Parts\\Part.sldprt",
  "exportAllConfigs": true
}

// Response
{
  "success": true,
  "data": {
    "inputFile": "C:\\Parts\\Part.sldprt",
    "exportedFiles": [
      "C:\\Parts\\Part_Config1.step",
      "C:\\Parts\\Part_Config2.step",
      "C:\\Parts\\Part_Config3.step"
    ],
    "count": 3
  }
}
```

## Integration with BluePLM

In the React app, use the exposed APIs:

```typescript
// Start the service
await window.electronAPI.solidworks.startService();

// Get BOM from an assembly
const bomResult = await window.electronAPI.solidworks.getBom(
  'C:\\Vault\\Assembly.sldasm'
);

if (bomResult.success) {
  console.log('Parts:', bomResult.data.items);
  console.log('Total quantity:', bomResult.data.totalQuantity);
}

// Get properties
const propsResult = await window.electronAPI.solidworks.getProperties(
  'C:\\Vault\\Part.sldprt'
);

// Export drawing to PDF
await window.electronAPI.solidworks.exportPdf(
  'C:\\Vault\\Drawing.slddrw',
  'C:\\Output\\Drawing.pdf'
);

// Export all configurations to STEP
await window.electronAPI.solidworks.exportStep(
  'C:\\Vault\\Part.sldprt',
  { exportAllConfigs: true }
);

// Get mass properties
const massResult = await window.electronAPI.solidworks.getMassProperties(
  'C:\\Vault\\Part.sldprt'
);
console.log('Mass:', massResult.data.mass, 'kg');
```

## Performance Notes

1. **First operation is slowest** - SolidWorks needs to start up (~10-30 seconds)
2. **Subsequent operations are fast** - Uses `--keep-sw-running` by default
3. **SolidWorks runs hidden** - Users won't see it unless they check Task Manager
4. **Consider batch operations** - Group multiple exports together

## Error Handling

All responses include:
- `success`: boolean
- `data`: result object (if successful)
- `error`: error message (if failed)
- `errorDetails`: full stack trace (if failed)

## License

MIT - Part of the BluePLM project.
