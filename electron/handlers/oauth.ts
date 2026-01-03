// OAuth handlers for Electron main process
import { ipcMain, BrowserWindow, shell } from 'electron'
import http from 'http'
import type { AddressInfo } from 'net'

// Module state
let mainWindow: BrowserWindow | null = null
let log: (message: string, data?: unknown) => void = console.log

// Active OAuth server
let activeOAuthServer: http.Server | null = null
let oauthTimeout: NodeJS.Timeout | null = null

// Google Drive credentials
const DEFAULT_GOOGLE_CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID || ''
const DEFAULT_GOOGLE_CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET || ''
const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
].join(' ')

function cleanupOAuthServer() {
  if (oauthTimeout) {
    clearTimeout(oauthTimeout)
    oauthTimeout = null
  }
  if (activeOAuthServer) {
    try {
      activeOAuthServer.close()
    } catch {}
    activeOAuthServer = null
  }
}

export interface OAuthHandlerDependencies {
  log: (message: string, data?: unknown) => void
}

export function registerOAuthHandlers(window: BrowserWindow, deps: OAuthHandlerDependencies): void {
  mainWindow = window
  log = deps.log

  // Supabase OAuth via system browser
  ipcMain.handle('auth:open-oauth-window', async (_, url: string) => {
    return new Promise((resolve) => {
      cleanupOAuthServer()
      
      log('[OAuth] Starting system browser OAuth flow')
      
      let hasResolved = false
      const safeResolve = (result: { success: boolean; canceled?: boolean; error?: string }) => {
        if (!hasResolved) {
          hasResolved = true
          cleanupOAuthServer()
          resolve(result)
        }
      }
      
      const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url || '/', `http://localhost`)
        
        log('[OAuth] Received callback request: ' + reqUrl.pathname)
        
        if (reqUrl.pathname === '/auth/callback' || reqUrl.pathname === '/') {
          const accessToken = reqUrl.searchParams.get('access_token')
          const refreshToken = reqUrl.searchParams.get('refresh_token')
          const expiresIn = reqUrl.searchParams.get('expires_in')
          const expiresAt = reqUrl.searchParams.get('expires_at')
          const error = reqUrl.searchParams.get('error')
          const errorDescription = reqUrl.searchParams.get('error_description')
          
          if (error) {
            log('[OAuth] OAuth error in callback: ' + error)
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(getErrorHtml(errorDescription || error))
            safeResolve({ success: false, error: errorDescription || error || 'OAuth error' })
            return
          }
          
          if (accessToken && refreshToken) {
            log('[OAuth] Tokens received in query params, sending to renderer')
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(getSuccessHtml())
            
            mainWindow?.webContents.send('auth:set-session', {
              access_token: accessToken,
              refresh_token: refreshToken,
              expires_in: expiresIn ? parseInt(expiresIn) : 3600,
              expires_at: expiresAt ? parseInt(expiresAt) : undefined
            })
            
            if (mainWindow && !mainWindow.isDestroyed()) {
              if (mainWindow.isMinimized()) mainWindow.restore()
              mainWindow.focus()
            }
            
            safeResolve({ success: true })
            return
          }
          
          // Tokens in hash fragment
          log('[OAuth] No tokens in query params, serving hash extraction page')
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(getHashExtractHtml())
          return
        }
        
        if (reqUrl.pathname === '/auth/tokens') {
          const accessToken = reqUrl.searchParams.get('access_token')
          const refreshToken = reqUrl.searchParams.get('refresh_token')
          const expiresIn = reqUrl.searchParams.get('expires_in')
          const expiresAt = reqUrl.searchParams.get('expires_at')
          
          if (accessToken && refreshToken) {
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            res.end('OK')
            
            log('[OAuth] Tokens received from hash fragment, sending to renderer')
            mainWindow?.webContents.send('auth:set-session', {
              access_token: accessToken,
              refresh_token: refreshToken,
              expires_in: expiresIn ? parseInt(expiresIn) : 3600,
              expires_at: expiresAt ? parseInt(expiresAt) : undefined
            })
            
            if (mainWindow && !mainWindow.isDestroyed()) {
              if (mainWindow.isMinimized()) mainWindow.restore()
              mainWindow.focus()
            }
            
            safeResolve({ success: true })
          } else {
            log('[OAuth] /auth/tokens request missing tokens')
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Missing tokens')
          }
          return
        }
        
        res.writeHead(302, { 'Location': '/auth/callback' + (reqUrl.search || '') })
        res.end()
      })
      
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo
        const port = address.port
        const callbackUrl = `http://127.0.0.1:${port}/auth/callback`
        
        log('[OAuth] Local callback server started on port ' + port)
        
        activeOAuthServer = server
        
        try {
          const oauthUrl = new URL(url)
          oauthUrl.searchParams.set('redirect_to', callbackUrl)
          
          const finalUrl = oauthUrl.toString()
          log('[OAuth] Opening system browser with OAuth URL')
          
          shell.openExternal(finalUrl)
          
          oauthTimeout = setTimeout(() => {
            log('[OAuth] Timeout waiting for OAuth callback')
            safeResolve({ success: false, error: 'OAuth timed out. Please try again.' })
          }, 5 * 60 * 1000)
          
        } catch (err) {
          log('[OAuth] Error parsing OAuth URL: ' + String(err))
          safeResolve({ success: false, error: String(err) })
        }
      })
      
      server.on('error', (err) => {
        log('[OAuth] Server error: ' + String(err))
        safeResolve({ success: false, error: String(err) })
      })
    })
  })

  // Google Drive OAuth
  ipcMain.handle('auth:google-drive', async (_, credentials?: { clientId?: string; clientSecret?: string }) => {
    return new Promise((resolve) => {
      log('[GoogleDrive] Starting OAuth flow')
      
      const GOOGLE_CLIENT_ID = credentials?.clientId || DEFAULT_GOOGLE_CLIENT_ID
      const GOOGLE_CLIENT_SECRET = credentials?.clientSecret || DEFAULT_GOOGLE_CLIENT_SECRET
      
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        log('[GoogleDrive] OAuth credentials not configured')
        resolve({ 
          success: false, 
          error: 'Google Drive integration requires OAuth credentials. Ask your admin to configure Google Drive in Settings → REST API → Google Drive Integration.' 
        })
        return
      }
      
      let hasResolved = false
      let gdAuthServer: http.Server | null = null
      
      const safeResolve = (result: { success: boolean; accessToken?: string; refreshToken?: string; expiry?: number; error?: string }) => {
        if (!hasResolved) {
          hasResolved = true
          if (gdAuthServer) {
            gdAuthServer.close()
            gdAuthServer = null
          }
          resolve(result)
        }
      }
      
      gdAuthServer = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url || '/', 'http://localhost')
        
        log('[GoogleDrive] Received callback: ' + reqUrl.pathname)
        
        if (reqUrl.pathname === '/auth/google-callback') {
          const code = reqUrl.searchParams.get('code')
          const error = reqUrl.searchParams.get('error')
          
          if (error) {
            log('[GoogleDrive] OAuth error: ' + error)
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(getGoogleErrorHtml(error))
            safeResolve({ success: false, error })
            return
          }
          
          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end('<html><body>Missing authorization code</body></html>')
            safeResolve({ success: false, error: 'Missing authorization code' })
            return
          }
          
          try {
            const port = (gdAuthServer?.address() as AddressInfo)?.port || 8090
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: `http://localhost:${port}/auth/google-callback`,
                grant_type: 'authorization_code'
              }).toString()
            })
            
            const tokens = await tokenResponse.json() as { 
              access_token?: string
              refresh_token?: string
              expires_in?: number
              error?: string
              error_description?: string 
            }
            
            if (tokens.error) {
              log('[GoogleDrive] Token exchange error: ' + tokens.error)
              res.writeHead(200, { 'Content-Type': 'text/html' })
              res.end(getGoogleErrorHtml(tokens.error_description || tokens.error))
              safeResolve({ success: false, error: tokens.error_description || tokens.error })
              return
            }
            
            log('[GoogleDrive] Token exchange successful')
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(getGoogleSuccessHtml())
            
            safeResolve({
              success: true,
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiry: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined
            })
          } catch (err) {
            log('[GoogleDrive] Token exchange exception: ' + String(err))
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(getGoogleErrorHtml(String(err)))
            safeResolve({ success: false, error: String(err) })
          }
        }
      })
      
      gdAuthServer.listen(0, '127.0.0.1', () => {
        const address = gdAuthServer!.address() as AddressInfo
        const port = address.port
        
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
        authUrl.searchParams.set('redirect_uri', `http://localhost:${port}/auth/google-callback`)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('scope', GOOGLE_DRIVE_SCOPES)
        authUrl.searchParams.set('access_type', 'offline')
        authUrl.searchParams.set('prompt', 'consent')
        
        log('[GoogleDrive] Opening auth URL in browser')
        shell.openExternal(authUrl.toString())
      })
      
      gdAuthServer.on('error', (err) => {
        log('[GoogleDrive] Server error: ' + String(err))
        safeResolve({ success: false, error: String(err) })
      })
    })
  })
}

// HTML templates
function getSuccessHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Sign In Successful</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #0a1929 0%, #1a365d 100%); color: #e3f2fd; }
.container { text-align: center; padding: 40px; background: rgba(255,255,255,0.1); border-radius: 16px; backdrop-filter: blur(10px); }
.checkmark { width: 80px; height: 80px; margin-bottom: 20px; }
h1 { margin: 0 0 10px 0; font-weight: 500; }
p { margin: 0; opacity: 0.8; }
</style>
</head>
<body>
<div class="container">
<svg class="checkmark" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2">
<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>
</svg>
<h1>Sign In Successful!</h1>
<p>You can close this window and return to BluePLM.</p>
</div>
<script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`
}

function getErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Sign In Failed</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #0a1929 0%, #1a365d 100%); color: #e3f2fd; }
.container { text-align: center; padding: 40px; background: rgba(255,255,255,0.1); border-radius: 16px; backdrop-filter: blur(10px); max-width: 400px; }
.error-icon { width: 80px; height: 80px; margin-bottom: 20px; }
h1 { margin: 0 0 10px 0; font-weight: 500; color: #f44336; }
p { margin: 0; opacity: 0.8; }
</style>
</head>
<body>
<div class="container">
<svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2">
<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
</svg>
<h1>Sign In Failed</h1>
<p>${message}</p>
<p style="margin-top: 16px; font-size: 12px;">You can close this window and try again.</p>
</div>
<script>setTimeout(() => window.close(), 5000);</script>
</body>
</html>`
}

function getHashExtractHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Completing Sign In...</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #0a1929 0%, #1a365d 100%); color: #e3f2fd; }
.container { text-align: center; padding: 40px; background: rgba(255,255,255,0.1); border-radius: 16px; backdrop-filter: blur(10px); max-width: 400px; }
.spinner { width: 60px; height: 60px; border: 4px solid rgba(255,255,255,0.2); border-top-color: #4caf50; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
@keyframes spin { to { transform: rotate(360deg); } }
h1 { margin: 0 0 10px 0; font-weight: 500; }
p { margin: 0; opacity: 0.8; }
.hidden { display: none; }
</style>
</head>
<body>
<div class="container">
<div id="loading">
<div class="spinner"></div>
<h1>Completing Sign In...</h1>
<p>Please wait a moment.</p>
</div>
<div id="success" class="hidden">
<svg style="width:80px;height:80px;margin:0 auto 20px;display:block" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2">
<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>
</svg>
<h1>Sign In Successful!</h1>
<p>You can close this window and return to BluePLM.</p>
</div>
<div id="error" class="hidden">
<svg style="width:80px;height:80px;margin:0 auto 20px;display:block" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2">
<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
</svg>
<h1 style="color:#f44336;">Sign In Issue</h1>
<p id="errorMsg">Could not complete sign in. Please try again.</p>
</div>
</div>
<script>
(async function() {
const showSuccess = () => { document.getElementById('loading').classList.add('hidden'); document.getElementById('success').classList.remove('hidden'); setTimeout(() => window.close(), 2000); };
const showError = (msg) => { document.getElementById('loading').classList.add('hidden'); document.getElementById('error').classList.remove('hidden'); if (msg) document.getElementById('errorMsg').textContent = msg; setTimeout(() => window.close(), 5000); };
try {
const hash = window.location.hash.substring(1);
if (!hash) { showError('No authentication data received.'); return; }
const params = new URLSearchParams(hash);
const error = params.get('error');
if (error) { showError(params.get('error_description') || error); return; }
const accessToken = params.get('access_token');
const refreshToken = params.get('refresh_token');
if (!accessToken) { showError('No access token received.'); return; }
if (!refreshToken) { showError('No refresh token received.'); return; }
const response = await fetch('/auth/tokens?' + hash, { method: 'GET', cache: 'no-cache' });
if (response.ok) { showSuccess(); } else { showError('Server error.'); }
} catch (err) { showError('An unexpected error occurred.'); }
})();
</script>
</body>
</html>`
}

function getGoogleSuccessHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Google Drive Connected</title>
<style>
body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1e1e2e; color: #cdd6f4; }
.container { text-align: center; padding: 40px; background: #313244; border-radius: 16px; }
h1 { color: #a6e3a1; }
</style>
</head>
<body>
<div class="container">
<h1>✓ Google Drive Connected</h1>
<p>You can close this window.</p>
</div>
<script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`
}

function getGoogleErrorHtml(error: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Google Drive - Error</title>
<style>
body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1e1e2e; color: #cdd6f4; }
.container { text-align: center; padding: 40px; background: #313244; border-radius: 16px; }
h1 { color: #f38ba8; }
</style>
</head>
<body>
<div class="container">
<h1>Authentication Failed</h1>
<p>${error}</p>
<p style="opacity: 0.7; margin-top: 20px;">You can close this window.</p>
</div>
</body>
</html>`
}

export function unregisterOAuthHandlers(): void {
  cleanupOAuthServer()
  
  const handlers = [
    'auth:open-oauth-window',
    'auth:google-drive'
  ]
  
  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }
}
