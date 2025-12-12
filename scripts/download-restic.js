#!/usr/bin/env node
/**
 * Download restic binaries for all platforms
 * 
 * Run with: npm run download-restic
 * 
 * This downloads the restic binary for Windows, macOS, and Linux
 * and places them in resources/bin/{platform}/
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// Restic version to download
const RESTIC_VERSION = '0.17.3'

// Platform configurations
// Note: macOS has separate x64 and arm64 binaries for universal app support
const PLATFORMS = {
  win32: {
    url: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_windows_amd64.zip`,
    archiveType: 'zip',
    binaryName: 'restic.exe',
    extractedName: `restic_${RESTIC_VERSION}_windows_amd64.exe`
  },
  'darwin-x64': {
    url: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_darwin_amd64.bz2`,
    archiveType: 'bz2',
    binaryName: 'restic',
    extractedName: `restic_${RESTIC_VERSION}_darwin_amd64`
  },
  'darwin-arm64': {
    url: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_darwin_arm64.bz2`,
    archiveType: 'bz2',
    binaryName: 'restic',
    extractedName: `restic_${RESTIC_VERSION}_darwin_arm64`
  },
  linux: {
    url: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2`,
    archiveType: 'bz2',
    binaryName: 'restic',
    extractedName: `restic_${RESTIC_VERSION}_linux_amd64`
  }
}

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

// Download file with redirect following
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    log(`  Downloading from ${url}...`, 'blue')
    
    const makeRequest = (url, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }
      
      const protocol = url.startsWith('https') ? https : require('http')
      
      protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          log(`  Following redirect to ${response.headers.location}`, 'yellow')
          makeRequest(response.headers.location, redirectCount + 1)
          return
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`))
          return
        }
        
        const totalSize = parseInt(response.headers['content-length'], 10)
        let downloadedSize = 0
        
        const file = fs.createWriteStream(destPath)
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length
          if (totalSize) {
            const percent = Math.round((downloadedSize / totalSize) * 100)
            process.stdout.write(`\r  Progress: ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(1)} MB)`)
          }
        })
        
        response.pipe(file)
        
        file.on('finish', () => {
          file.close()
          console.log() // New line after progress
          resolve()
        })
        
        file.on('error', (err) => {
          fs.unlink(destPath, () => {})
          reject(err)
        })
      }).on('error', reject)
    }
    
    makeRequest(url)
  })
}

// Extract bz2 file
function extractBz2(archivePath, destPath) {
  log(`  Extracting bz2...`, 'blue')
  
  // Try using bunzip2 command
  try {
    execSync(`bunzip2 -k -f "${archivePath}"`, { stdio: 'pipe' })
    
    // The extracted file will be the archive path without .bz2
    const extractedPath = archivePath.replace('.bz2', '')
    if (fs.existsSync(extractedPath)) {
      fs.renameSync(extractedPath, destPath)
      return
    }
  } catch {
    // bunzip2 not available, try alternative
  }
  
  // Try using 7z on Windows
  if (process.platform === 'win32') {
    try {
      execSync(`7z x -y "${archivePath}" -o"${path.dirname(destPath)}"`, { stdio: 'pipe' })
      const extractedPath = archivePath.replace('.bz2', '')
      if (fs.existsSync(extractedPath)) {
        fs.renameSync(extractedPath, destPath)
        return
      }
    } catch {
      // 7z not available
    }
  }
  
  // Try using Node.js bz2 decompression
  try {
    const zlib = require('zlib')
    // Node's zlib doesn't support bz2 natively, so we need to use a workaround
    // For now, throw an error and suggest installing bunzip2
    throw new Error('Native bz2 not supported')
  } catch {
    throw new Error(
      'Could not extract bz2 file. Please install:\n' +
      '  - macOS/Linux: bunzip2 (usually pre-installed)\n' +
      '  - Windows: 7-Zip and add to PATH, or install bunzip2 via WSL'
    )
  }
}

// Extract zip file
function extractZip(archivePath, destDir, binaryName) {
  log(`  Extracting zip...`, 'blue')
  
  // Try using unzip command
  try {
    execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'pipe' })
    return
  } catch {
    // unzip not available
  }
  
  // Try using PowerShell on Windows
  if (process.platform === 'win32') {
    try {
      execSync(
        `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`,
        { stdio: 'pipe' }
      )
      return
    } catch {
      // PowerShell not available or failed
    }
  }
  
  // Try using 7z
  try {
    execSync(`7z x -y "${archivePath}" -o"${destDir}"`, { stdio: 'pipe' })
    return
  } catch {
    // 7z not available
  }
  
  throw new Error('Could not extract zip file. Please install unzip, 7-Zip, or ensure PowerShell is available.')
}

async function downloadPlatform(platform) {
  const config = PLATFORMS[platform]
  const binDir = path.join(__dirname, '..', 'resources', 'bin', platform)
  const destBinary = path.join(binDir, config.binaryName)
  
  // Create directory
  fs.mkdirSync(binDir, { recursive: true })
  
  // Check if already downloaded
  if (fs.existsSync(destBinary)) {
    const stats = fs.statSync(destBinary)
    if (stats.size > 1000000) { // > 1MB, probably valid
      log(`  ✓ Already exists (${(stats.size / 1024 / 1024).toFixed(1)} MB)`, 'green')
      return
    }
  }
  
  // Download archive
  const archiveExt = config.archiveType === 'zip' ? '.zip' : '.bz2'
  const archivePath = path.join(binDir, `restic${archiveExt}`)
  
  await downloadFile(config.url, archivePath)
  
  // Extract
  if (config.archiveType === 'zip') {
    extractZip(archivePath, binDir, config.binaryName)
    // Find and rename the extracted exe
    const files = fs.readdirSync(binDir)
    const exeFile = files.find(f => f.endsWith('.exe') && f !== config.binaryName)
    if (exeFile) {
      fs.renameSync(path.join(binDir, exeFile), destBinary)
    }
  } else {
    extractBz2(archivePath, destBinary)
  }
  
  // Clean up archive
  if (fs.existsSync(archivePath)) {
    fs.unlinkSync(archivePath)
  }
  
  // Make executable on Unix
  if (platform !== 'win32') {
    fs.chmodSync(destBinary, 0o755)
  }
  
  // Verify
  if (fs.existsSync(destBinary)) {
    const stats = fs.statSync(destBinary)
    log(`  ✓ Downloaded successfully (${(stats.size / 1024 / 1024).toFixed(1)} MB)`, 'green')
  } else {
    throw new Error(`Binary not found at ${destBinary}`)
  }
}

async function main() {
  log('\n🔧 Downloading restic binaries for BluePDM\n', 'blue')
  log(`   Version: ${RESTIC_VERSION}`, 'yellow')
  log('')
  
  // Parse command line args
  const args = process.argv.slice(2)
  let platforms = Object.keys(PLATFORMS)
  
  if (args.includes('--current')) {
    // Only download for current platform
    if (process.platform === 'darwin') {
      // macOS needs both x64 and arm64 for universal build
      platforms = ['darwin-x64', 'darwin-arm64']
    } else if (PLATFORMS[process.platform]) {
      platforms = [process.platform]
    } else {
      log(`Unsupported platform: ${process.platform}`, 'red')
      process.exit(1)
    }
  } else if (args.includes('--platform')) {
    const idx = args.indexOf('--platform')
    if (args[idx + 1]) {
      const requestedPlatform = args[idx + 1]
      // Handle darwin specially
      if (requestedPlatform === 'darwin') {
        platforms = ['darwin-x64', 'darwin-arm64']
      } else {
        platforms = [requestedPlatform]
      }
    }
  }
  
  for (const platform of platforms) {
    log(`\n📦 ${platform}:`, 'yellow')
    try {
      await downloadPlatform(platform)
    } catch (err) {
      log(`  ✗ Failed: ${err.message}`, 'red')
      if (!args.includes('--continue-on-error')) {
        process.exit(1)
      }
    }
  }
  
  log('\n✅ Done!\n', 'green')
  log('Next steps:', 'blue')
  log('  1. Run "npm run build" to build the app with restic bundled')
  log('  2. The binaries are in resources/bin/{platform}/')
  log('')
}

main().catch(err => {
  log(`\n❌ Error: ${err.message}\n`, 'red')
  process.exit(1)
})

