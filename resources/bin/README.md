# Restic Binaries

This folder contains the restic backup tool binaries for each platform.

## Download Binaries

The binaries are not included in the git repository because they're large (~15-18 MB each).

To download them, run:

```bash
npm run download-restic
```

This will download restic for all platforms (Windows, macOS, Linux).

### Download for current platform only

```bash
npm run download-restic -- --current
```

### Download for specific platform

```bash
npm run download-restic -- --platform win32
npm run download-restic -- --platform darwin
npm run download-restic -- --platform linux
```

## Directory Structure

After downloading, the structure should be:

```
resources/bin/
├── win32/
│   └── restic.exe
├── darwin/
│   └── restic
└── linux/
    └── restic
```

## About Restic

[Restic](https://restic.net/) is a fast, secure, efficient backup program.

- **Encrypted**: All data is encrypted with AES-256
- **Deduplicated**: Only stores unique data chunks
- **Efficient**: Fast incremental backups

## Manual Download

If the script doesn't work, you can manually download from:
https://github.com/restic/restic/releases

Download the appropriate binary for each platform and place it in the corresponding folder.

