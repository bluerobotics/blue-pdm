#!/usr/bin/env node
/**
 * Entry point for the read-only divergence scanner (phase 0 of the metadata source-of-truth plan).
 *
 * Usage:
 *   npm run scan:divergence
 *   npm run scan:divergence -- --path="0 - SHARED\00 - REGRESSION TESTS"
 *   npm run scan:divergence -- --limit=50 --verify-hashes
 *   npm run scan:divergence -- timing "0 - SHARED\00 - REGRESSION TESTS\REGRESSION-TEST-ORING\ORING-BUNA-70A.SLDPRT"
 *
 * The scan runs inside the running BluePLM development app rather than in this process, for two
 * reasons: the app already holds the authenticated Supabase session, so no separate credentials
 * are needed, and it already has the SolidWorks service attached with the Document Manager
 * licence configured. This script starts the scan over the app's existing CLI channel and polls
 * until it finishes, because a vault-wide scan runs far longer than the CLI server's request
 * timeout.
 *
 * Nothing here writes. The command it drives opens documents read-only, queries the database with
 * SELECT only, and emits a report; see src/lib/metadata/divergenceScan.ts for the contract.
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')

const CLI_PORT = 31337
const CLI_HOST = '127.0.0.1'
const REQUEST_TIMEOUT_MS = 30000
const POLL_INTERVAL_MS = 3000

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function colorize(type, text) {
  switch (type) {
    case 'error':
      return `${colors.red}${text}${colors.reset}`
    case 'success':
      return `${colors.green}${text}${colors.reset}`
    case 'warning':
      return `${colors.yellow}${text}${colors.reset}`
    case 'info':
      return `${colors.cyan}${text}${colors.reset}`
    default:
      return text
  }
}

function tokenFilePath() {
  if (os.platform() === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'blueplm', 'cli-token.json')
  }
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configDir, 'blueplm', 'cli-token.json')
}

function readToken() {
  const file = tokenFilePath()
  try {
    if (!fs.existsSync(file)) return null
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof data.token === 'string' ? data.token : null
  } catch {
    return null
  }
}

function sendCommand(command, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ command })
    const req = http.request(
      {
        hostname: CLI_HOST,
        port: CLI_PORT,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${token}`,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let payload = ''
        res.on('data', (chunk) => {
          payload += chunk
        })
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new Error('BluePLM rejected the CLI token. Sign in to the app again.'))
            return
          }
          try {
            resolve(JSON.parse(payload))
          } catch {
            reject(new Error(`Unexpected response: ${payload}`))
          }
        })
      },
    )

    req.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') {
        reject(new Error('BluePLM is not running. Start it with "npm run dev" and sign in.'))
      } else {
        reject(error)
      }
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('The app did not answer within 30 seconds.'))
    })

    req.write(body)
    req.end()
  })
}

function printOutputs(result) {
  const outputs = result?.result?.outputs || []
  for (const output of outputs) {
    console.log(colorize(output.type, output.content))
  }
  return outputs
}

/** Matches the untranslated marker the status subcommand emits as its first line. */
const STATE_MARKER = 'scan-divergence-state='

function stateOf(outputs) {
  const marker = outputs.find((output) => output.content.startsWith(STATE_MARKER))
  return marker ? marker.content.slice(STATE_MARKER.length).trim() : 'unknown'
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function pollUntilFinished(token) {
  for (;;) {
    await sleep(POLL_INTERVAL_MS)
    const result = await sendCommand('scan-divergence status', token)
    const outputs = result?.result?.outputs || []

    if (stateOf(outputs) === 'running') {
      for (const output of outputs) {
        if (!output.content.startsWith(STATE_MARKER)) console.log(colorize('info', output.content))
      }
      continue
    }

    for (const output of outputs) {
      if (!output.content.startsWith(STATE_MARKER)) console.log(colorize(output.type, output.content))
    }
    return stateOf(outputs)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const token = readToken()

  if (!token) {
    console.error(colorize('error', 'No BluePLM CLI token found.'))
    console.error(colorize('gray', `  Expected at: ${tokenFilePath()}`))
    console.error(colorize('gray', '  Start the app with "npm run dev" and sign in as an admin.'))
    process.exit(1)
  }

  // `timing` is a single short measurement, so it does not need the start-and-poll dance.
  if (args[0] === 'timing' || args[0] === 'status' || args[0] === 'cancel') {
    const result = await sendCommand(`scan-divergence ${args.join(' ')}`, token)
    if (result?.error) {
      console.error(colorize('error', result.error))
      process.exit(1)
    }
    printOutputs(result)
    return
  }

  const command = ['scan-divergence', '--async', ...args].join(' ')
  console.log(colorize('info', `> ${command}`))

  const started = await sendCommand(command, token)
  if (started?.error) {
    console.error(colorize('error', started.error))
    process.exit(1)
  }
  printOutputs(started)

  const state = await pollUntilFinished(token)
  if (state !== 'complete') process.exit(1)
}

main().catch((error) => {
  console.error(colorize('error', error.message))
  process.exit(1)
})
