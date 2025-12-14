# BluePLM SolidWorks Add-in

Native SolidWorks integration for BluePLM - check in/out files, view status, and manage versions directly within SolidWorks.

![BluePLM Add-in](../assets/screenshot.png)

## Features

- **Check Out / Check In** - Lock files for editing and upload changes
- **Task Pane** - View file status, version, and state without leaving SolidWorks
- **Toolbar Integration** - Quick access buttons in the SolidWorks toolbar
- **Version History** - View and compare previous versions
- **Custom Properties Sync** - Automatically sync SolidWorks custom properties with BluePLM metadata
- **Read-Only Protection** - Non-checked-out files open as read-only

## Requirements

- SolidWorks 2021 or later (x64)
- Windows 10/11
- .NET Framework 4.8
- BluePLM desktop app configured with your organization's vault

## Installation

### Option 1: Pre-built Installer (Recommended)

1. Download the latest installer from [Releases](https://github.com/bluerobotics/bluePLM/releases)
2. Run `BluePLM.SolidWorks.Installer.exe`
3. Restart SolidWorks

### Option 2: Manual Installation

1. Build the solution (see Development section)
2. Open an elevated (Administrator) command prompt
3. Navigate to the output directory:
   ```
   cd solidworks-addin\BluePLM.SolidWorks\bin\Release\net48
   ```
4. Register the COM assembly:
   ```
   %windir%\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe /codebase BluePLM.SolidWorks.dll
   ```
5. Restart SolidWorks

## Configuration

1. Open SolidWorks
2. Go to **Tools → Add-ins** and enable **BluePLM**
3. Click the **Settings** button in the BluePLM toolbar (or Task Pane)
4. Enter your Supabase connection details:
   - **Project URL**: Your Supabase project URL (e.g., `https://xxx.supabase.co`)
   - **Anon Key**: Your project's anon/public key
5. Sign in with your BluePLM account credentials
6. Set your vault path to match the BluePLM desktop app

## Usage

### Task Pane

The BluePLM task pane shows the status of your currently active document:

- **File name** and path
- **Version** and **revision**
- **State** (WIP, In Review, Released, Obsolete)
- **Check out status** - who has it checked out
- **Quick action buttons**

### Commands

| Command | Description |
|---------|-------------|
| **Check Out** | Lock the file for editing. File becomes writable. |
| **Check In** | Upload your changes and release the lock. Increments version. |
| **Undo Check Out** | Discard changes and release the lock. Reverts to server version. |
| **Get Latest** | Download the latest version from the server. |
| **History** | View version history with dates, users, and comments. |
| **Settings** | Configure connection and sign in. |

### Workflow

1. **Open a file** - It opens read-only if not checked out by you
2. **Check Out** - Click to get exclusive edit access
3. **Make changes** - Edit the part/assembly/drawing as needed
4. **Check In** - Upload changes with an optional comment

### Custom Properties

When checking in, BluePLM automatically reads these SolidWorks custom properties and syncs them:

- Part Number
- Description
- Material
- Weight
- Custom properties defined in your organization settings

## Development

### Prerequisites

- Visual Studio 2022
- SolidWorks 2021+ installed (for API references)
- .NET Framework 4.8 SDK

### Building

1. Clone the repository:
   ```bash
   git clone https://github.com/bluerobotics/bluePLM.git
   cd blue-plm/solidworks-addin
   ```

2. Open `BluePLM.SolidWorks.sln` in Visual Studio

3. Restore NuGet packages

4. Build the solution:
   ```bash
   dotnet build -c Release
   ```

### SolidWorks API References

If the SolidWorks NuGet packages don't work, you can reference the interop assemblies directly from your SolidWorks installation:

```
C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\api\redist\SolidWorks.Interop.sldworks.dll
C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\api\redist\SolidWorks.Interop.swconst.dll
C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\api\redist\SolidWorks.Interop.swpublished.dll
```

### Debugging

1. Set BluePLM.SolidWorks as the startup project
2. In project properties → Debug, set:
   - Start external program: `C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\SLDWORKS.exe`
3. Register the debug build:
   ```
   RegAsm.exe /codebase bin\Debug\net48\BluePLM.SolidWorks.dll
   ```
4. Press F5 to start debugging

### Project Structure

```
BluePLM.SolidWorks/
├── BluePLMAddin.cs         # Main add-in entry point, COM registration
├── Services/
│   ├── SupabaseService.cs  # API client for Supabase backend
│   └── FileStatusCache.cs  # Caching layer for file status
├── UI/
│   ├── TaskPaneHost.cs     # WinForms task pane control
│   ├── CheckInDialog.cs    # Check-in options dialog
│   ├── HistoryDialog.cs    # Version history viewer
│   └── SettingsDialog.cs   # Connection settings
└── Properties/
    └── AssemblyInfo.cs     # COM visibility, GUIDs
```

## Uninstallation

1. Close SolidWorks
2. Open an elevated command prompt
3. Unregister the assembly:
   ```
   RegAsm.exe /unregister BluePLM.SolidWorks.dll
   ```
4. Delete the add-in files

Or use the installer's uninstall option.

## Troubleshooting

### Add-in doesn't appear in SolidWorks

- Make sure you ran RegAsm as Administrator
- Check that .NET Framework 4.8 is installed
- Look for errors in Windows Event Viewer

### Can't connect to server

- Verify your Supabase URL and API key
- Check that your firewall allows HTTPS connections
- Try signing in through the BluePLM desktop app first

### Files won't open as writable

- Check if someone else has the file checked out
- Verify you're signed in (check Task Pane connection status)
- Make sure the file is in your vault path

### Performance issues

- File status is cached for 30 seconds; click refresh to update
- Large assemblies may take time to check file status for all components

## License

MIT License - see [LICENSE](../LICENSE) for details.

---

[Blue Robotics](https://bluerobotics.com) | [BluePLM](https://github.com/bluerobotics/bluePLM)

