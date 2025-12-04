# Changelog

All notable changes to BluePDM will be documented in this file.

## [0.6.0] - 2024-12-04

### Added
- File type icons for STEP, PDF, images, spreadsheets, archives, PCB, schematics, libraries, and code files
- Distinct colors for each file type (amber assemblies, sky drawings, red schematics, violet libraries, etc.)
- Vaults table type definitions for TypeScript

### Fixed
- Startup double-loading issue (files no longer load twice with "add diff spam")
- Added loading state while waiting for organization to load
- Fixed pinned file icons not showing correctly for .slddrw and other file types
- Fixed extension parsing for pinned items (missing dot prefix)

### Changed
- Assembly icon now amber colored (stands out from other blues)
- Drawing icon now uses FilePen for a more artistic look

## [1.1.2] - 2024-12-03

### Fixed
- App not launching on some Windows machines (window now shows after 5s fallback)
- Added startup logging for debugging launch issues
- Added crash and error handlers for renderer process

## [1.1.1] - 2024-12-02

### Fixed
- Build configuration improvements
- Simplified release artifacts (single universal macOS build)

## [1.1.0] - 2024-12-01

### Added
- File save/load functionality for tube configurations
- Menu bar with File operations

### Changed
- Improved UI layout and styling

## [1.0.0] - 2024-11-30

### Added
- Initial release
- Pressure vessel dimension optimizer for underwater applications
- Interactive 3D cylinder visualization
- Material selection (various metals and alloys)
- Parameter inputs for depth, safety factor, and dimensions
- Results table with optimized calculations
- VSCode-inspired dark theme UI

