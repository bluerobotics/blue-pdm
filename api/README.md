# BluePDM REST API

A standalone REST API for BluePDM that enables external applications to interact with the PDM system.

## Quick Start

```bash
# Install dependencies (if not already done)
npm install

# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_KEY="your-anon-key"

# Start the API server
npm run api

# Or with auto-reload during development
npm run api:dev
```

The server will start on `http://127.0.0.1:3001` by default.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | - | Supabase project URL (required) |
| `SUPABASE_KEY` | - | Supabase anon key (required) |
| `API_PORT` | `3001` | Port to listen on |
| `API_HOST` | `127.0.0.1` | Host to bind to |

You can also use `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` if you have them set for development.

## Authentication

All endpoints (except `/health` and `/auth/login`) require a valid JWT token in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Getting a Token

**Option 1: Login with email/password**
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "your-password"}'
```

Response:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "abc123...",
  "expires_at": 1702400000,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "full_name": "John Doe",
    "role": "engineer",
    "org_id": "org-uuid"
  }
}
```

**Option 2: Use existing Supabase token**

If you already have a Supabase access token (e.g., from the desktop app), use it directly.

### Refreshing Tokens

```bash
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "your-refresh-token"}'
```

---

## API Endpoints

### Health & Info

#### `GET /health`
Health check endpoint. No authentication required.

```bash
curl http://localhost:3001/health
```

#### `GET /`
API info and available endpoints.

---

### Authentication

#### `POST /auth/login`
Login with email and password.

#### `POST /auth/refresh`
Refresh an expired access token.

#### `GET /auth/me`
Get current user info.

---

### Vaults

#### `GET /vaults`
List all vaults in the organization.

```bash
curl http://localhost:3001/vaults \
  -H "Authorization: Bearer $TOKEN"
```

#### `GET /vaults/:id`
Get a specific vault by ID.

#### `GET /vaults/:id/status`
Get vault status summary (file counts, checkout counts by state).

---

### Files

#### `GET /files`
List files in the organization.

**Query Parameters:**
- `vault_id` - Filter by vault
- `folder` - Filter by folder path prefix
- `state` - Filter by state (wip, in_review, released, obsolete)
- `search` - Search in file name and part number
- `checked_out` - `me` for your checkouts, `any` for all checkouts
- `limit` - Max results (default 1000)
- `offset` - Pagination offset

```bash
# List all files in a vault
curl "http://localhost:3001/files?vault_id=vault-uuid" \
  -H "Authorization: Bearer $TOKEN"

# Search for files
curl "http://localhost:3001/files?search=bracket&vault_id=vault-uuid" \
  -H "Authorization: Bearer $TOKEN"

# Get my checked out files
curl "http://localhost:3001/files?checked_out=me" \
  -H "Authorization: Bearer $TOKEN"
```

#### `GET /files/:id`
Get a file by ID with full details.

#### `GET /files/by-path/:vault_id/*`
Get a file by its path within a vault.

```bash
curl "http://localhost:3001/files/by-path/vault-uuid/Parts/bracket.SLDPRT" \
  -H "Authorization: Bearer $TOKEN"
```

---

### Checkout / Checkin

#### `POST /files/:id/checkout`
Check out a file for editing.

```bash
curl -X POST http://localhost:3001/files/file-uuid/checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Working on design changes"}'
```

#### `POST /files/:id/checkin`
Check in a file after editing.

```bash
# Check in without content changes
curl -X POST http://localhost:3001/files/file-uuid/checkin \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comment": "Updated dimensions"}'

# Check in with new content (base64 encoded)
curl -X POST http://localhost:3001/files/file-uuid/checkin \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "comment": "Updated dimensions",
    "content": "base64-encoded-file-content"
  }'
```

#### `POST /files/:id/undo-checkout`
Discard checkout and revert changes.

```bash
curl -X POST http://localhost:3001/files/file-uuid/undo-checkout \
  -H "Authorization: Bearer $TOKEN"
```

---

### Upload (Sync)

#### `POST /files/sync`
Upload a new file or update an existing one.

```bash
curl -X POST http://localhost:3001/files/sync \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vault_id": "vault-uuid",
    "file_path": "Parts/new-bracket.SLDPRT",
    "file_name": "new-bracket.SLDPRT",
    "extension": ".SLDPRT",
    "content": "base64-encoded-file-content"
  }'
```

#### `POST /files/sync-batch`
Upload multiple files at once.

```bash
curl -X POST http://localhost:3001/files/sync-batch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vault_id": "vault-uuid",
    "files": [
      {
        "file_path": "Parts/bracket-01.SLDPRT",
        "file_name": "bracket-01.SLDPRT",
        "extension": ".SLDPRT",
        "content": "base64..."
      },
      {
        "file_path": "Parts/bracket-02.SLDPRT",
        "file_name": "bracket-02.SLDPRT",
        "extension": ".SLDPRT",
        "content": "base64..."
      }
    ]
  }'
```

---

### Download

#### `GET /files/:id/download`
Download file content.

**Query Parameters:**
- `version` - Download a specific version (optional)

```bash
# Download as JSON with base64 content
curl http://localhost:3001/files/file-uuid/download \
  -H "Authorization: Bearer $TOKEN"

# Download as binary file
curl http://localhost:3001/files/file-uuid/download \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/octet-stream" \
  -o downloaded-file.SLDPRT

# Download specific version
curl "http://localhost:3001/files/file-uuid/download?version=3" \
  -H "Authorization: Bearer $TOKEN"
```

---

### Version History

#### `GET /files/:id/versions`
Get version history for a file.

```bash
curl http://localhost:3001/files/file-uuid/versions \
  -H "Authorization: Bearer $TOKEN"
```

---

### Trash

#### `GET /trash`
List deleted files.

```bash
curl http://localhost:3001/trash \
  -H "Authorization: Bearer $TOKEN"

# Filter by vault
curl "http://localhost:3001/trash?vault_id=vault-uuid" \
  -H "Authorization: Bearer $TOKEN"
```

#### `DELETE /files/:id`
Soft delete a file (move to trash).

```bash
curl -X DELETE http://localhost:3001/files/file-uuid \
  -H "Authorization: Bearer $TOKEN"
```

#### `POST /trash/:id/restore`
Restore a file from trash.

```bash
curl -X POST http://localhost:3001/trash/file-uuid/restore \
  -H "Authorization: Bearer $TOKEN"
```

---

### Activity

#### `GET /activity`
Get recent activity.

**Query Parameters:**
- `file_id` - Filter by file
- `limit` - Max results (default 50)

```bash
curl http://localhost:3001/activity \
  -H "Authorization: Bearer $TOKEN"

# Activity for a specific file
curl "http://localhost:3001/activity?file_id=file-uuid" \
  -H "Authorization: Bearer $TOKEN"
```

---

### Checkouts

#### `GET /checkouts`
List all currently checked out files.

**Query Parameters:**
- `mine_only=true` - Only show your checkouts

```bash
# All checkouts
curl http://localhost:3001/checkouts \
  -H "Authorization: Bearer $TOKEN"

# Just my checkouts
curl "http://localhost:3001/checkouts?mine_only=true" \
  -H "Authorization: Bearer $TOKEN"
```

---

### Metadata

#### `PATCH /files/:id/metadata`
Update file metadata (state).

```bash
curl -X PATCH http://localhost:3001/files/file-uuid/metadata \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "released"}'
```

Valid states: `not_tracked`, `wip`, `in_review`, `released`, `obsolete`

---

### References (BOM)

#### `GET /files/:id/where-used`
Get parent assemblies that reference this file.

```bash
curl http://localhost:3001/files/file-uuid/where-used \
  -H "Authorization: Bearer $TOKEN"
```

#### `GET /files/:id/contains`
Get child components contained in this assembly.

```bash
curl http://localhost:3001/files/file-uuid/contains \
  -H "Authorization: Bearer $TOKEN"
```

---

## Error Responses

All errors return JSON in this format:

```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

Common status codes:
- `400` - Bad request (missing/invalid parameters)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (no organization membership)
- `404` - Not found
- `409` - Conflict (e.g., file already checked out)
- `500` - Server error

---

## Examples

### Complete Workflow Example

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "pass"}' | jq -r '.access_token')

# 2. List vaults
curl -s http://localhost:3001/vaults \
  -H "Authorization: Bearer $TOKEN"

# 3. List files in vault
VAULT_ID="your-vault-uuid"
curl -s "http://localhost:3001/files?vault_id=$VAULT_ID" \
  -H "Authorization: Bearer $TOKEN"

# 4. Check out a file
FILE_ID="your-file-uuid"
curl -s -X POST "http://localhost:3001/files/$FILE_ID/checkout" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Working on changes"}'

# 5. Download the file
curl -s "http://localhost:3001/files/$FILE_ID/download" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/octet-stream" \
  -o working-file.SLDPRT

# 6. (Make changes to the file locally...)

# 7. Upload changed content and check in
NEW_CONTENT=$(base64 -i working-file.SLDPRT)
curl -s -X POST "http://localhost:3001/files/$FILE_ID/checkin" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"comment\": \"Updated design\", \"content\": \"$NEW_CONTENT\"}"
```

### Python Example

```python
import requests
import base64

API_URL = "http://localhost:3001"

# Login
response = requests.post(f"{API_URL}/auth/login", json={
    "email": "user@example.com",
    "password": "password"
})
token = response.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# List files
files = requests.get(f"{API_URL}/files", headers=headers).json()

# Check out a file
file_id = files["files"][0]["id"]
requests.post(f"{API_URL}/files/{file_id}/checkout", headers=headers)

# Download file
response = requests.get(
    f"{API_URL}/files/{file_id}/download",
    headers=headers
)
content = base64.b64decode(response.json()["content"])

# Save locally
with open("downloaded.SLDPRT", "wb") as f:
    f.write(content)

# Check in with new content
with open("modified.SLDPRT", "rb") as f:
    new_content = base64.b64encode(f.read()).decode()

requests.post(f"{API_URL}/files/{file_id}/checkin", 
    headers=headers,
    json={"comment": "Updated", "content": new_content}
)
```

### C# Example (for SolidWorks Add-in)

```csharp
using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

public class BluePdmClient
{
    private readonly HttpClient _client;
    private string _token;

    public BluePdmClient(string baseUrl = "http://localhost:3001")
    {
        _client = new HttpClient { BaseAddress = new Uri(baseUrl) };
    }

    public async Task<bool> LoginAsync(string email, string password)
    {
        var response = await _client.PostAsync("/auth/login",
            new StringContent(JsonSerializer.Serialize(new { email, password }),
                Encoding.UTF8, "application/json"));
        
        var result = await JsonSerializer.DeserializeAsync<LoginResult>(
            await response.Content.ReadAsStreamAsync());
        
        _token = result.access_token;
        _client.DefaultRequestHeaders.Authorization = 
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _token);
        
        return true;
    }

    public async Task<bool> CheckoutAsync(string fileId, string message = null)
    {
        var response = await _client.PostAsync($"/files/{fileId}/checkout",
            new StringContent(JsonSerializer.Serialize(new { message }),
                Encoding.UTF8, "application/json"));
        return response.IsSuccessStatusCode;
    }

    public async Task<byte[]> DownloadAsync(string fileId)
    {
        _client.DefaultRequestHeaders.Accept.Clear();
        _client.DefaultRequestHeaders.Accept.Add(
            new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/octet-stream"));
        
        return await _client.GetByteArrayAsync($"/files/{fileId}/download");
    }

    public async Task<bool> CheckinAsync(string fileId, byte[] content, string comment)
    {
        var response = await _client.PostAsync($"/files/{fileId}/checkin",
            new StringContent(JsonSerializer.Serialize(new { 
                comment, 
                content = Convert.ToBase64String(content) 
            }), Encoding.UTF8, "application/json"));
        return response.IsSuccessStatusCode;
    }
}
```

---

## Rate Limiting

The API does not currently implement rate limiting. For production use, consider placing it behind a reverse proxy (nginx, Caddy) with rate limiting configured.

## Security Notes

- The API binds to `127.0.0.1` by default for security
- To expose externally, set `API_HOST=0.0.0.0` (not recommended without additional security)
- All requests are logged with timestamps
- Tokens expire after the Supabase-configured time (default 1 hour)
- Use HTTPS in production by placing behind a reverse proxy

## Troubleshooting

**"Supabase not configured" error**
- Set the `SUPABASE_URL` and `SUPABASE_KEY` environment variables

**"Invalid token" error**
- Token may have expired - use `/auth/refresh` to get a new one
- Ensure you're using the full token (access tokens are long JWT strings)

**"User profile not found" error**
- User exists in Supabase Auth but not in the `users` table
- Sign in via the BluePDM desktop app first to create the profile

**File upload fails**
- Check that content is valid base64
- Ensure file size is under 100MB (configurable in server.js)

