# BluePLM SolidWorks Service

A standalone Windows service that provides SolidWorks file operations for the BluePLM desktop app.

## Overview

This service bridges the BluePLM Electron app with SolidWorks, enabling:

- **Metadata extraction** - Read/write custom properties, BOM, configurations
- **File exports** - PDF, STEP, IGES, DXF, images
- **Open document management** - Control files open in SolidWorks (checkout without closing!)
- **Preview extraction** - High-resolution previews without launching SolidWorks (with Document Manager API)

## Architecture

```
BluePLM Desktop App (Electron)
        │
        │ spawns process, JSON stdin/stdout
        ▼
BluePLM.SolidWorksService.exe
        │
        ├── Document Manager API (FAST - no SW launch)
        │   └── Properties, BOM, configs, references, previews
        │
        └── Full SolidWorks API (launches SW when needed)
            └── Exports, mass properties, open document control
```

## Building

```bash
cd solidworks-service
dotnet build BluePLM.SolidWorksService/BluePLM.SolidWorksService.csproj -c Release
```

Output: `BluePLM.SolidWorksService/bin/Release/BluePLM.SolidWorksService.exe`

## Requirements

- Windows 10/11 (x64)
- .NET Framework 4.8
- SolidWorks 2021+ installed
- (Optional) Document Manager license key for fast metadata operations

## Usage

See [BluePLM.SolidWorksService/README.md](BluePLM.SolidWorksService/README.md) for detailed documentation including:

- Command line options
- JSON protocol reference
- All available operations
- Integration with the Electron app

## License

MIT License - see [LICENSE](../LICENSE) for details.
