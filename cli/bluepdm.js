#!/usr/bin/env node
/**
 * BluePDM External CLI
 * 
 * Sends commands to the running BluePDM Electron app via HTTP.
 * 
 * Usage:
 *   node bluepdm.js <command>
 *   node bluepdm.js "mkdir test"
 *   node bluepdm.js "cd test && mkdir subfolder"
 * 
 * Interactive mode:
 *   node bluepdm.js
 */

const http = require('http')
const readline = require('readline')

const CLI_PORT = 31337
const CLI_HOST = '127.0.0.1'

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
}

function colorize(type, text) {
  switch (type) {
    case 'error': return `${colors.red}${text}${colors.reset}`
    case 'success': return `${colors.green}${text}${colors.reset}`
    case 'info': return `${colors.cyan}${text}${colors.reset}`
    case 'input': return `${colors.gray}${text}${colors.reset}`
    default: return text
  }
}

/**
 * Send a command to the BluePDM app
 */
function sendCommand(command) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ command })
    
    const req = http.request({
      hostname: CLI_HOST,
      port: CLI_PORT,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 30000
    }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          resolve(result)
        } catch (e) {
          reject(new Error(`Invalid response: ${body}`))
        }
      })
    })
    
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error('BluePDM is not running or CLI server is disabled.\nMake sure the app is running with npm run dev.'))
      } else {
        reject(err)
      }
    })
    
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Command timed out'))
    })
    
    req.write(data)
    req.end()
  })
}

/**
 * Execute a command and print results
 */
async function executeCommand(command) {
  try {
    const result = await sendCommand(command)
    
    if (result.success && result.result?.outputs) {
      for (const output of result.result.outputs) {
        console.log(colorize(output.type, output.content))
      }
    } else if (result.error) {
      console.error(colorize('error', `Error: ${result.error}`))
      return false
    }
    return true
  } catch (err) {
    console.error(colorize('error', err.message))
    return false
  }
}

/**
 * Interactive REPL mode
 */
async function interactiveMode() {
  console.log(colorize('info', '🔷 BluePDM CLI'))
  console.log(colorize('gray', `Connected to localhost:${CLI_PORT}`))
  console.log(colorize('gray', 'Type "help" for commands, "exit" to quit\n'))
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.blue}bluepdm>${colors.reset} `
  })
  
  rl.prompt()
  
  rl.on('line', async (line) => {
    const command = line.trim()
    
    if (!command) {
      rl.prompt()
      return
    }
    
    if (command === 'exit' || command === 'quit') {
      console.log(colorize('gray', 'Goodbye!'))
      rl.close()
      process.exit(0)
    }
    
    await executeCommand(command)
    console.log() // Empty line for readability
    rl.prompt()
  })
  
  rl.on('close', () => {
    process.exit(0)
  })
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    // Interactive mode
    await interactiveMode()
  } else {
    // Single command mode
    const command = args.join(' ')
    const success = await executeCommand(command)
    process.exit(success ? 0 : 1)
  }
}

main().catch(err => {
  console.error(colorize('error', err.message))
  process.exit(1)
})

