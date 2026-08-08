# Server API Reference

The Extension Server API (`ExtensionServerAPI`) is available to server-side handlers running in V8 isolates on the organization's API server. This sandboxed environment provides secure access to database storage, secrets, and external HTTP requests.

## Overview

Server handlers run in isolated V8 environments with:
- **No Node.js access** — Pure JavaScript only
- **Memory limits** — 128MB per isolate
- **Timeout** — 30 seconds per request
- **Domain restrictions** — Only declared domains allowed
- **Rate limiting** — 100 requests/minute per extension (configurable)

```typescript
// server/sync.ts
export default async function handler(api: ExtensionServerAPI) {
  const { request, user, response, storage, secrets, http } = api
  
  // Your handler logic here
  
  return response.json({ success: true })
}
```

---

## Handler Structure

Every server handler must export a default async function:

```typescript
import type { ExtensionServerAPI } from '@blueplm/extension-api'

export default async function handler(
  api: ExtensionServerAPI
): Promise<ExtensionResponse> {
  // Handler implementation
}
```

### ExtensionServerAPI Interface

```typescript
interface ExtensionServerAPI {
  storage: StorageAPI       // Extension-scoped database storage
  secrets: SecretsAPI       // Encrypted secrets storage
  http: HttpAPI             // Domain-restricted HTTP client
  request: RequestContext   // Current HTTP request
  user: UserContext | null  // Authenticated user (null for public)
  response: ResponseHelpers // Response builders
}
```

---

## Request Context

### request

Information about the incoming HTTP request.

```typescript
interface ExtensionRequestContext {
  method: string                      // 'GET', 'POST', etc.
  path: string                        // Route path
  body: unknown                       // Parsed request body
  headers: Record<string, string>     // Request headers
  query: Record<string, string>       // Query parameters
  params: Record<string, string>      // Route parameters
}
```

**Example:**
```typescript
export default async function handler(api: ExtensionServerAPI) {
  const { method, body, query, headers } = api.request
  
  console.log('Method:', method)           // 'POST'
  console.log('Body:', body)               // { vaultId: 'xxx' }
  console.log('Query:', query)             // { force: 'true' }
  console.log('Auth:', headers.authorization) // 'Bearer ...'
  
  return api.response.json({ received: true })
}
```

---

### user

Authenticated user context. `null` for public endpoints.

```typescript
interface ExtensionUserContext {
  id: string        // User UUID
  email: string     // User email
  orgId: string     // Organization UUID
  role: string      // User role in org
}
```

**Example:**
```typescript
export default async function handler(api: ExtensionServerAPI) {
  const { user, response } = api
  
  // Check authentication
  if (!user) {
    return response.error('Authentication required', 401)
  }
  
  // Check role
  if (user.role !== 'admin') {
    return response.error('Admin access required', 403)
  }
  
  // Use user info
  console.log(`Request from ${user.email} in org ${user.orgId}`)
  
  return response.json({ userId: user.id })
}
```

---

## Response Helpers

### response.json

Return a JSON response.

```typescript
response.json(data: unknown, status?: number): ExtensionResponse
```

**Example:**
```typescript
return api.response.json({
  success: true,
  data: { fileCount: 42 }
})

// With custom status
return api.response.json({ created: true }, 201)
```

---

### response.error

Return an error response.

```typescript
response.error(message: string, status?: number): ExtensionResponse
```

**Example:**
```typescript
return api.response.error('Invalid vault ID', 400)
return api.response.error('Not found', 404)
return api.response.error('Internal error', 500)
```

---

### response.redirect

Return a redirect response.

```typescript
response.redirect(url: string, status?: number): ExtensionResponse
```

**Example:**
```typescript
// OAuth callback redirect
return api.response.redirect('https://accounts.google.com/oauth/...')

// Permanent redirect
return api.response.redirect('/new-location', 301)
```

---

## Storage API

**Permission required:** `storage:database`

Extension-scoped key-value storage persisted to the organization's database.

### storage.get

Retrieve a value from storage.

```typescript
api.storage.get<T>(key: string): Promise<T | undefined>
```

**Example:**
```typescript
const lastSync = await api.storage.get<number>('lastSync:vault-123')
const config = await api.storage.get<Config>('settings')

if (lastSync) {
  console.log('Last sync:', new Date(lastSync))
}
```

---

### storage.set

Store a value.

```typescript
api.storage.set<T>(key: string, value: T): Promise<void>
```

Values must be JSON-serializable.

**Example:**
```typescript
await api.storage.set('lastSync:vault-123', Date.now())
await api.storage.set('settings', {
  syncInterval: 300,
  autoSync: true
})
```

---

### storage.delete

Delete a value.

```typescript
api.storage.delete(key: string): Promise<void>
```

**Example:**
```typescript
await api.storage.delete('cachedData')
```

---

### storage.list

List all keys (optionally filtered by prefix).

```typescript
api.storage.list(prefix?: string): Promise<string[]>
```

**Example:**
```typescript
// All keys
const allKeys = await api.storage.list()

// Keys with prefix
const syncKeys = await api.storage.list('lastSync:')
// ['lastSync:vault-1', 'lastSync:vault-2', ...]
```

---

## Secrets API

**Permission required:** `secrets:read` and/or `secrets:write`

Encrypted secrets storage for sensitive data like API keys. All access is audited.

### Limits

| Limit | Value |
|-------|-------|
| Maximum secrets | 50 per extension |
| Maximum size | 10KB per secret |

### secrets.get

Retrieve a secret value.

```typescript
api.secrets.get(name: string): Promise<string | undefined>
```

**Permission:** `secrets:read`

**Example:**
```typescript
const apiKey = await api.secrets.get('google_api_key')
const clientSecret = await api.secrets.get('oauth_client_secret')

if (!apiKey) {
  return api.response.error('API key not configured', 400)
}
```

---

### secrets.set

Store a secret value (encrypted at rest).

```typescript
api.secrets.set(name: string, value: string): Promise<void>
```

**Permission:** `secrets:write`

**Example:**
```typescript
// Store OAuth tokens
await api.secrets.set('access_token', accessToken)
await api.secrets.set('refresh_token', refreshToken)
```

---

### secrets.delete

Delete a secret.

```typescript
api.secrets.delete(name: string): Promise<void>
```

**Permission:** `secrets:write`

**Example:**
```typescript
// Clean up on disconnect
await api.secrets.delete('access_token')
await api.secrets.delete('refresh_token')
```

---

## HTTP API

**Permission required:** `http:fetch` or specific `http:domain:*` permissions

Domain-restricted HTTP client for external API calls.

### http.fetch

Make an HTTP request to an external URL.

```typescript
api.http.fetch(url: string, options?: RequestInit): Promise<SerializableResponse>

interface SerializableResponse {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: string  // Response body as string
}
```

**Manifest requirement:**
```json
"permissions": {
  "server": [
    "http:domain:api.googleapis.com",
    "http:domain:accounts.google.com"
  ]
}
```

**Example:**
```typescript
export default async function handler(api: ExtensionServerAPI) {
  const { http, secrets, response } = api
  
  // Get API key from secrets
  const apiKey = await secrets.get('api_key')
  if (!apiKey) {
    return response.error('API key not configured', 400)
  }
  
  try {
    // Make external request
    const result = await http.fetch('https://api.googleapis.com/drive/v3/files', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (!result.ok) {
      return response.error(`API error: ${result.statusText}`, result.status)
    }
    
    // Parse JSON response
    const data = JSON.parse(result.body)
    
    return response.json({ files: data.files })
    
  } catch (error) {
    return response.error(`Request failed: ${error.message}`, 500)
  }
}
```

### POST Request Example

```typescript
const result = await api.http.fetch('https://api.example.com/sync', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    vault: vaultName,
    files: fileList
  })
})
```

### Domain Restrictions

Requests are only allowed to domains declared in your manifest:

```json
"permissions": {
  "server": [
    "http:domain:api.example.com",
    "http:domain:*.googleapis.com"
  ]
}
```

Attempting to access other domains results in an error:

```
Error: Domain api.unauthorized.com not in extension's allowed domains
```

---

## Complete Handler Examples

### Simple GET Handler

```typescript
// server/status.ts
import type { ExtensionServerAPI } from '@blueplm/extension-api'

export default async function handler(api: ExtensionServerAPI) {
  const { user, storage, response } = api
  
  if (!user) {
    return response.error('Authentication required', 401)
  }
  
  const lastSync = await storage.get<number>('lastSync')
  const syncCount = await storage.get<number>('syncCount') ?? 0
  
  return response.json({
    connected: true,
    lastSync: lastSync ? new Date(lastSync).toISOString() : null,
    totalSyncs: syncCount
  })
}
```

### POST Handler with Validation

```typescript
// server/sync.ts
import type { ExtensionServerAPI } from '@blueplm/extension-api'

interface SyncRequest {
  vaultId: string
  force?: boolean
}

interface SyncResult {
  fileCount: number
  duration: number
}

export default async function handler(api: ExtensionServerAPI) {
  const { request, user, storage, secrets, http, response } = api
  const startTime = Date.now()
  
  // Authentication check
  if (!user) {
    return response.error('Authentication required', 401)
  }
  
  // Parse and validate request body
  const body = request.body as SyncRequest
  
  if (!body.vaultId) {
    return response.error('vaultId is required', 400)
  }
  
  // Get credentials
  const apiToken = await secrets.get('api_token')
  if (!apiToken) {
    return response.error('Extension not configured. Please set up API credentials.', 400)
  }
  
  // Get last sync time
  const lastSyncKey = `lastSync:${body.vaultId}`
  const lastSync = await storage.get<number>(lastSyncKey)
  
  try {
    // Call external API
    const externalResponse = await http.fetch('https://api.example.com/sync', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        vault: body.vaultId,
        since: lastSync ? new Date(lastSync).toISOString() : null,
        force: body.force ?? false,
        user: user.email
      })
    })
    
    if (!externalResponse.ok) {
      const errorBody = externalResponse.body
      return response.error(`External API error: ${errorBody}`, externalResponse.status)
    }
    
    const result = JSON.parse(externalResponse.body)
    
    // Update storage
    await storage.set(lastSyncKey, Date.now())
    
    // Increment sync counter
    const syncCount = (await storage.get<number>('syncCount') ?? 0) + 1
    await storage.set('syncCount', syncCount)
    
    return response.json({
      fileCount: result.filesProcessed,
      duration: Date.now() - startTime
    } as SyncResult)
    
  } catch (error) {
    return response.error(`Sync failed: ${(error as Error).message}`, 500)
  }
}
```

### OAuth Callback Handler (Public Endpoint)

> **Not currently reachable.** `public` is accepted and recorded, but every extension endpoint
> requires a token today, so an anonymous OAuth provider redirect is refused before this handler
> runs. Do not ship a callback that depends on it — see
> [Public Endpoints](./contributions.md#public-endpoints) for why and for what has to replace it.
> The example below is the shape such a handler will take once it works.

```typescript
// server/oauth-callback.ts
// Manifest: { "public": true }  // see the note above - not reachable yet
import type { ExtensionServerAPI } from '@blueplm/extension-api'

export default async function handler(api: ExtensionServerAPI) {
  const { request, storage, secrets, http, response } = api
  const { code, state, error } = request.query
  
  // Handle OAuth error
  if (error) {
    return response.redirect(`blueplm://extensions/myext/oauth-error?error=${error}`)
  }
  
  // Validate state
  const savedState = await storage.get<string>('oauth_state')
  if (!state || state !== savedState) {
    return response.error('Invalid state parameter', 400)
  }
  
  try {
    // Exchange code for tokens
    const tokenResponse = await http.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: await secrets.get('client_id') ?? '',
        client_secret: await secrets.get('client_secret') ?? '',
        redirect_uri: 'https://your-org-api.com/extensions/myext/oauth-callback',
        grant_type: 'authorization_code'
      }).toString()
    })
    
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.body}`)
    }
    
    const tokens = JSON.parse(tokenResponse.body)
    
    // Store tokens securely
    await secrets.set('access_token', tokens.access_token)
    if (tokens.refresh_token) {
      await secrets.set('refresh_token', tokens.refresh_token)
    }
    
    // Clean up state
    await storage.delete('oauth_state')
    
    // Redirect back to app
    return response.redirect('blueplm://extensions/myext/oauth-success')
    
  } catch (error) {
    return response.redirect(
      `blueplm://extensions/myext/oauth-error?error=${encodeURIComponent((error as Error).message)}`
    )
  }
}
```

### Configuration Handler

```typescript
// server/configure.ts
import type { ExtensionServerAPI } from '@blueplm/extension-api'

interface ConfigureRequest {
  apiKey?: string
  apiEndpoint?: string
  syncInterval?: number
}

export default async function handler(api: ExtensionServerAPI) {
  const { request, user, storage, secrets, response } = api
  
  if (!user) {
    return response.error('Authentication required', 401)
  }
  
  // Only admins can configure
  if (user.role !== 'admin' && user.role !== 'owner') {
    return response.error('Admin access required', 403)
  }
  
  const body = request.body as ConfigureRequest
  
  // Store secrets
  if (body.apiKey) {
    await secrets.set('api_key', body.apiKey)
  }
  
  if (body.apiEndpoint) {
    await secrets.set('api_endpoint', body.apiEndpoint)
  }
  
  // Store regular config
  if (body.syncInterval !== undefined) {
    await storage.set('syncInterval', body.syncInterval)
  }
  
  return response.json({
    success: true,
    message: 'Configuration saved'
  })
}
```

---

## Error Handling Best Practices

```typescript
export default async function handler(api: ExtensionServerAPI) {
  const { response } = api
  
  try {
    // Your logic here
    
  } catch (error) {
    const err = error as Error
    
    // Log for debugging (visible in org's logs)
    console.error('Handler error:', err.message, err.stack)
    
    // Return user-friendly error
    if (err.message.includes('timeout')) {
      return response.error('Request timed out. Please try again.', 504)
    }
    
    if (err.message.includes('rate limit')) {
      return response.error('Too many requests. Please wait.', 429)
    }
    
    // Generic error (don't expose internals)
    return response.error('An unexpected error occurred.', 500)
  }
}
```

---

## Security Considerations

### 1. Always Validate Input

```typescript
const { vaultId, action } = request.body as { vaultId?: string; action?: string }

if (!vaultId || typeof vaultId !== 'string') {
  return response.error('Invalid vaultId', 400)
}

if (!['sync', 'backup', 'restore'].includes(action ?? '')) {
  return response.error('Invalid action', 400)
}
```

### 2. Check Authentication for Non-Public Endpoints

```typescript
if (!user) {
  return response.error('Authentication required', 401)
}
```

### 3. Implement Role-Based Access

```typescript
if (user.role !== 'admin') {
  return response.error('Admin access required', 403)
}
```

### 4. Never Expose Secrets

```typescript
// ❌ Bad
return response.json({ apiKey: await secrets.get('api_key') })

// ✓ Good
return response.json({ configured: !!(await secrets.get('api_key')) })
```

### 5. Validate External Responses

```typescript
const result = await http.fetch(url, options)

if (!result.ok) {
  // Don't expose external error details
  return response.error('External service unavailable', 502)
}

// Validate response structure
const data = JSON.parse(result.body)
if (!data.files || !Array.isArray(data.files)) {
  return response.error('Invalid response from service', 502)
}
```

---

## Testing Handlers

### Local Testing

Use the BluePLM CLI to test handlers locally:

```bash
# Start local handler server
blueplm-ext serve

# Test with curl
curl -X POST http://localhost:3000/extensions/myext/sync \
  -H "Content-Type: application/json" \
  -d '{"vaultId": "test-vault"}'
```

### Mock API Object

```typescript
// test/sync.test.ts
import handler from '../server/sync'

const mockApi = {
  request: {
    method: 'POST',
    path: 'sync',
    body: { vaultId: 'test-vault' },
    headers: {},
    query: {},
    params: {}
  },
  user: {
    id: 'user-1',
    email: 'test@example.com',
    orgId: 'org-1',
    role: 'admin'
  },
  storage: {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    list: jest.fn()
  },
  secrets: {
    get: jest.fn().mockResolvedValue('mock-api-key'),
    set: jest.fn(),
    delete: jest.fn()
  },
  http: {
    fetch: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify({ filesProcessed: 42 })
    })
  },
  response: {
    json: (data: unknown, status = 200) => ({ type: 'json', data, status }),
    error: (message: string, status = 500) => ({ type: 'error', message, status }),
    redirect: (url: string, status = 302) => ({ type: 'redirect', url, status })
  }
}

test('sync handler returns file count', async () => {
  const result = await handler(mockApi as any)
  
  expect(result.type).toBe('json')
  expect(result.data.fileCount).toBe(42)
})
```

---

**[← Client API Reference](./client-api.md)** | **[Contributions Reference →](./contributions.md)**
