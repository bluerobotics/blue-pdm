# BluePLM REST API

Integration API for external systems (ERP, CI/CD, automation) built with [Fastify](https://fastify.dev/) and TypeScript.

**Package:** `ghcr.io/bluerobotics/blueplm-api`

> **Note**: This API is designed for **integrations**, not daily app use.
> - Desktop app users → Direct to Supabase (faster)
> - SolidWorks add-in → Direct to Supabase (faster)  
> - ERP systems (Odoo, SAP) → This API
> - CI/CD, webhooks, automation → This API

## Setup for Your Organization

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Deploy API (5 min)                                 │
│  Click "Deploy to Railway" button below                     │
│  Set: SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY      │
├─────────────────────────────────────────────────────────────┤
│  Step 2: Get API URL                                        │
│  Railway gives you: https://your-app.railway.app            │
├─────────────────────────────────────────────────────────────┤
│  Step 3: Configure in BluePLM                               │
│  Settings → REST API → Enter your API URL                   │
├─────────────────────────────────────────────────────────────┤
│  Step 4: Connect Odoo/ERP                                   │
│  Use the API URL + your access token from Settings          │
└─────────────────────────────────────────────────────────────┘
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Heavy Operations (CAD files)                               │
│  Desktop App / SolidWorks Add-in → Supabase Direct (fast)   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Integration Layer (this REST API)                          │
│  ERP / Purchasing / CI/CD / Slack → Lightweight queries     │
│  • State queries                                            │
│  • Metadata lookups                                         │
│  • Trigger actions (release, obsolete)                      │
│  • Webhooks → Push notifications                            │
└─────────────────────────────────────────────────────────────┘
```

| Integration | What They Can Do |
|-------------|------------------|
| **Odoo/ERP** | Query released parts, sync BOMs, get part numbers |
| **Purchasing** | "Get all files in Released state" |
| **Manufacturing** | "Download latest released drawing for part X" |
| **CI/CD** | "Automatically release files after tests pass" |
| **Slack Bot** | "Notify channel when files are released" |

## Features

- **ERP-Ready** - Endpoints designed for Odoo, SAP, and other ERP systems
- **Signed URLs** - Large files transfer direct to Supabase (not through API)
- **Fast** - Built on Fastify (~30k req/s)
- **Type-Safe** - Written in TypeScript
- **Validated** - JSON Schema validation
- **Documented** - Interactive Swagger UI at `/docs`
- **Rate Limited** - Built-in rate limiting
- **Webhooks** - Real-time notifications

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

**Interactive API Documentation**: Open http://127.0.0.1:3001/docs for Swagger UI.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | - | Supabase project URL (required) |
| `SUPABASE_KEY` | - | Supabase anon key (required) |
| `SUPABASE_SERVICE_KEY` | - | Service role key (required for user invites) |
| `API_PORT` | `3001` | Port to listen on |
| `API_HOST` | `0.0.0.0` | Host to bind to |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW` | `60000` | Time window in ms (60s) |
| `CORS_ORIGINS` | `*` | Allowed origins (comma-separated) |

You can also use `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` if you have them set for development.

## Deployment

Each organization hosts their own API server. This keeps your data under your control.

### Deploy from Docker Image (Recommended)

The easiest way - no repo access needed:

**Railway:**
1. Go to [railway.app/new](https://railway.app/new)
2. Select **"Deploy from Docker Image"**
3. Enter: `ghcr.io/bluerobotics/blueplm-api:latest`
4. Add variables: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`
5. Deploy!

**Render:**
1. Go to [render.com](https://render.com) → New → Web Service
2. Select **"Deploy an existing image from a registry"**
3. Enter: `ghcr.io/bluerobotics/blueplm-api:latest`
4. Add environment variables: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`
5. Deploy!

**Fly.io:**
```bash
fly launch --image ghcr.io/bluerobotics/blueplm-api:latest
fly secrets set SUPABASE_URL=https://xxx.supabase.co SUPABASE_KEY=your-anon-key SUPABASE_SERVICE_KEY=your-service-key
fly deploy
```

**Docker (self-hosted):**
```bash
docker run -d -p 3001:3001 \
  -e SUPABASE_URL=https://xxx.supabase.co \
  -e SUPABASE_KEY=your-anon-key \
  -e SUPABASE_SERVICE_KEY=your-service-key \
  ghcr.io/bluerobotics/blueplm-api:latest
```

### Railway (from source)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and initialize
railway login
railway init

# Set environment variables (get these from your Supabase project settings)
railway variables set SUPABASE_URL=https://xxx.supabase.co
railway variables set SUPABASE_KEY=your-anon-key
railway variables set SUPABASE_SERVICE_KEY=your-service-key
railway variables set CORS_ORIGINS=https://your-erp.com,https://odoo.yourcompany.com

# Deploy
railway up
```

Your API will be live at `https://your-app.railway.app`

### Where to Find Your Supabase Credentials

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your BluePLM project
3. Go to **Settings → API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_KEY`
   - **service_role** key → `SUPABASE_SERVICE_KEY` (required for user invites)

> ⚠️ **Keep your service_role key secret!** It bypasses Row Level Security. Never expose it in client-side code.

### Render

1. Create new **Web Service** from your GitHub repo
2. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `npx tsx api/server.ts`
3. Add environment variables in dashboard
4. Deploy

### Docker

```bash
# Build
docker build -f api/Dockerfile -t blueplm-api .

# Run
docker run -p 3001:3001 \
  -e SUPABASE_URL=https://xxx.supabase.co \
  -e SUPABASE_KEY=your-anon-key \
  -e SUPABASE_SERVICE_KEY=your-service-key \
  blueplm-api
```

### Fly.io

```bash
# Install Fly CLI and login
fly auth login

# Launch (creates fly.toml)
fly launch

# Set secrets
fly secrets set SUPABASE_URL=https://xxx.supabase.co
fly secrets set SUPABASE_KEY=your-anon-key
fly secrets set SUPABASE_SERVICE_KEY=your-service-key

# Deploy
fly deploy
```

### Production Checklist

- [ ] Set `CORS_ORIGINS` to only allow your ERP/integration domains
- [ ] Configure rate limiting appropriately (`RATE_LIMIT_MAX`)
- [ ] Set up monitoring/alerting on the `/health` endpoint
- [ ] Enable HTTPS (most platforms do this automatically)
- [ ] Consider adding API keys for additional security

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
Get a **signed URL** for downloading file content (direct from Supabase Storage).

> **Note**: Files download directly from Supabase, not through this API. 
> This keeps large CAD files off the API server.

**Query Parameters:**
- `version` - Download a specific version (optional)

**Response:**
```json
{
  "file_id": "uuid",
  "file_name": "bracket.SLDPRT",
  "file_size": 1234567,
  "content_hash": "sha256...",
  "download_url": "https://xxx.supabase.co/storage/v1/object/sign/vault/...",
  "expires_in": 3600
}
```

```bash
# Get signed download URL
curl http://localhost:3001/files/file-uuid/download \
  -H "Authorization: Bearer $TOKEN"

# Then download directly from the signed URL
curl -o bracket.SLDPRT "https://xxx.supabase.co/storage/v1/object/sign/..."
```

#### `GET /files/:id/upload-url`
Get a **signed URL** for uploading new file content (direct to Supabase Storage).

```bash
# Get signed upload URL
curl http://localhost:3001/files/file-uuid/upload-url \
  -H "Authorization: Bearer $TOKEN"

# Upload directly to Supabase
curl -X PUT -T new-content.SLDPRT "https://xxx.supabase.co/storage/v1/object/upload/..."
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

---

### ERP Integration

These endpoints are designed for ERP systems like **Odoo**, SAP, or custom integrations.

#### `GET /parts`
List all parts with part numbers. Ideal for syncing with ERP.

**Query Parameters:**
- `vault_id` - Filter by vault
- `state` - Filter by state
- `released_only` - Only return released parts (boolean)
- `search` - Search by part number
- `limit` / `offset` - Pagination

```bash
# Get all released parts for ERP sync
curl "http://localhost:3001/parts?released_only=true" \
  -H "Authorization: Bearer $TOKEN"

# Search for a specific part number
curl "http://localhost:3001/parts?search=BRK-001" \
  -H "Authorization: Bearer $TOKEN"
```

#### `GET /bom/:id`
Get Bill of Materials for an assembly.

**Query Parameters:**
- `released_only` - Only include released components

```bash
curl http://localhost:3001/bom/assembly-uuid \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "assembly": {
    "id": "uuid",
    "part_number": "ASSY-001",
    "file_name": "thruster-assembly.SLDASM",
    "revision": "B",
    "state": "released"
  },
  "components": [
    {
      "id": "uuid",
      "part_number": "BRK-001",
      "file_name": "bracket.SLDPRT",
      "revision": "A",
      "state": "released",
      "quantity": 2
    },
    ...
  ],
  "total_components": 15
}
```

#### `GET /files/:id/drawing`
Get the associated drawing for a part or assembly.

```bash
curl http://localhost:3001/files/part-uuid/drawing \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "has_drawing": true,
  "drawing": {
    "id": "uuid",
    "file_name": "bracket.SLDDRW",
    "revision": "A",
    "state": "released",
    "download_url": "https://...",
    "expires_in": 3600
  }
}
```

#### `POST /files/:id/release`
Quick release: Change file state to "released".

```bash
curl -X POST http://localhost:3001/files/file-uuid/release \
  -H "Authorization: Bearer $TOKEN"
```

#### `POST /files/:id/obsolete`
Quick obsolete: Change file state to "obsolete".

```bash
curl -X POST http://localhost:3001/files/file-uuid/obsolete \
  -H "Authorization: Bearer $TOKEN"
```

### Odoo Integration Example

```python
# Python example for Odoo integration
import requests

API_URL = "https://api.blueplm.yourcompany.com"
TOKEN = "your-jwt-token"

headers = {"Authorization": f"Bearer {TOKEN}"}

# Sync released parts to Odoo product catalog
response = requests.get(
    f"{API_URL}/parts",
    params={"released_only": True},
    headers=headers
)

for part in response.json()["parts"]:
    # Create/update product in Odoo
    odoo.execute_kw(
        db, uid, password,
        "product.product", "create",
        [{
            "name": part["file_name"],
            "default_code": part["part_number"],
            "x_revision": part["revision"],
            "x_pdm_id": part["id"]
        }]
    )

# Get BOM for manufacturing
bom = requests.get(
    f"{API_URL}/bom/{assembly_id}",
    headers=headers
).json()

# Create Odoo BOM
odoo_bom_lines = [
    (0, 0, {"product_id": find_product(c["part_number"]), "product_qty": c["quantity"]})
    for c in bom["components"]
]
```

Valid states: `not_tracked`, `wip`, `in_review`, `released`, `obsolete`

---

### Suppliers & Costing

Endpoints for managing suppliers/vendors and part costing. Perfect for Odoo/ERP integration.

#### `GET /suppliers`
List all suppliers in your organization.

**Query Parameters:**
- `active_only` - Only active suppliers
- `approved_only` - Only approved vendors
- `search` - Search by name or code
- `limit` / `offset` - Pagination

```bash
curl http://localhost:3001/suppliers \
  -H "Authorization: Bearer $TOKEN"

# Search for a supplier
curl "http://localhost:3001/suppliers?search=mcmaster" \
  -H "Authorization: Bearer $TOKEN"
```

#### `POST /suppliers`
Create a new supplier (engineer/admin only).

```bash
curl -X POST http://localhost:3001/suppliers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "McMaster-Carr",
    "code": "MCMASTER",
    "website": "https://mcmaster.com",
    "payment_terms": "Net 30",
    "default_lead_time_days": 3,
    "currency": "USD",
    "is_approved": true
  }'
```

#### `GET /suppliers/:id`
Get supplier details.

#### `PATCH /suppliers/:id`
Update supplier info.

#### `DELETE /suppliers/:id`
Delete a supplier (admin only).

---

### Part-Supplier Links (Pricing)

#### `GET /files/:id/suppliers`
Get all suppliers and pricing for a part.

```bash
curl http://localhost:3001/files/part-uuid/suppliers \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "file_id": "uuid",
  "part_number": "BRK-001",
  "file_name": "bracket.SLDPRT",
  "suppliers": [
    {
      "id": "link-uuid",
      "supplier": {
        "id": "supplier-uuid",
        "name": "McMaster-Carr",
        "code": "MCMASTER"
      },
      "supplier_part_number": "91251A540",
      "unit_price": 2.50,
      "currency": "USD",
      "price_breaks": [
        {"qty": 1, "price": 2.50},
        {"qty": 100, "price": 2.10},
        {"qty": 1000, "price": 1.85}
      ],
      "min_order_qty": 1,
      "lead_time_days": 3,
      "is_preferred": true
    }
  ]
}
```

#### `POST /files/:id/suppliers`
Link a supplier to a part with pricing.

```bash
curl -X POST http://localhost:3001/files/part-uuid/suppliers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_id": "supplier-uuid",
    "supplier_part_number": "91251A540",
    "unit_price": 2.50,
    "currency": "USD",
    "price_breaks": [
      {"qty": 1, "price": 2.50},
      {"qty": 100, "price": 2.10},
      {"qty": 1000, "price": 1.85}
    ],
    "min_order_qty": 1,
    "lead_time_days": 3,
    "is_preferred": true
  }'
```

#### `PATCH /files/:id/suppliers/:supplierId`
Update pricing/info for a part-supplier link.

#### `DELETE /files/:id/suppliers/:supplierId`
Remove supplier from a part.

---

### Costing Queries

#### `GET /parts/:id/costing`
Get complete costing info for a part including volume pricing.

**Query Parameters:**
- `quantity` - Quantity to calculate pricing for (default: 1)

```bash
# Get pricing at qty 100
curl "http://localhost:3001/parts/part-uuid/costing?quantity=100" \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "part": {
    "id": "uuid",
    "part_number": "BRK-001",
    "file_name": "bracket.SLDPRT",
    "description": "Mounting bracket",
    "revision": "A",
    "state": "released"
  },
  "quantity": 100,
  "preferred_supplier": {
    "supplier_id": "uuid",
    "supplier_name": "McMaster-Carr",
    "supplier_code": "MCMASTER",
    "supplier_part_number": "91251A540",
    "unit_price": 2.10,
    "total_price": 210.00,
    "currency": "USD",
    "lead_time_days": 3
  },
  "lowest_cost": {
    "supplier_id": "uuid",
    "supplier_name": "AliExpress",
    "unit_price": 0.85,
    "total_price": 85.00,
    "currency": "USD"
  },
  "all_suppliers": [...]
}
```

#### `GET /suppliers/:id/parts`
List all parts available from a specific supplier.

```bash
curl http://localhost:3001/suppliers/supplier-uuid/parts \
  -H "Authorization: Bearer $TOKEN"
```

### Odoo Supplier Sync Example

```python
import requests

API_URL = "https://api.blueplm.yourcompany.com"
TOKEN = "your-jwt-token"
headers = {"Authorization": f"Bearer {TOKEN}"}

# Sync suppliers from BluePLM to Odoo
response = requests.get(f"{API_URL}/suppliers?active_only=true", headers=headers)
for supplier in response.json()["suppliers"]:
    # Create/update vendor in Odoo
    odoo.execute_kw(db, uid, password, "res.partner", "create", [{
        "name": supplier["name"],
        "ref": supplier["code"],
        "supplier_rank": 1,
        "website": supplier["website"],
        "x_pdm_id": supplier["id"]
    }])

# Get costing for a part at production quantity
costing = requests.get(
    f"{API_URL}/parts/{part_id}/costing?quantity=1000",
    headers=headers
).json()

# Use preferred supplier's pricing in Odoo BOM
if costing["preferred_supplier"]:
    price = costing["preferred_supplier"]["unit_price"]
    supplier_code = costing["preferred_supplier"]["supplier_code"]
```

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

public class BluePlmClient
{
    private readonly HttpClient _client;
    private string _token;

    public BluePlmClient(string baseUrl = "http://localhost:3001")
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

### Webhooks

Webhooks allow external systems to receive real-time notifications when events occur in BluePLM.

#### Webhook Events

| Event | Description |
|-------|-------------|
| `file.checkout` | File was checked out |
| `file.checkin` | File was checked in |
| `file.sync` | New file uploaded or existing file updated |
| `file.delete` | File was moved to trash |
| `file.restore` | File was restored from trash |
| `file.state_change` | File state changed (WIP → Released, etc.) |
| `file.version` | New version created |

#### `GET /webhooks`
List all webhooks for your organization.

#### `POST /webhooks`
Create a new webhook (admin only).

```bash
curl -X POST http://localhost:3001/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.com/webhook",
    "events": ["file.checkin", "file.state_change"]
  }'
```

Response includes a `secret` for verifying webhook signatures (only shown once).

#### `PATCH /webhooks/:id`
Update webhook (toggle active, change events).

#### `DELETE /webhooks/:id`
Delete a webhook (admin only).

#### Webhook Payload

```json
{
  "event": "file.checkin",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "org_id": "org-uuid",
  "data": {
    "file_id": "file-uuid",
    "file_path": "Parts/bracket.SLDPRT",
    "file_name": "bracket.SLDPRT",
    "user_id": "user-uuid",
    "user_email": "user@example.com"
  }
}
```

#### Verifying Signatures

Webhooks include `X-BluePLM-Signature` header (HMAC-SHA256):

```python
import hmac, hashlib

def verify(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

---

## Rate Limiting

Rate limiting is enabled by default:
- **100 requests** per **60 seconds** per IP
- Configure via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW` env vars
- Returns `429 Too Many Requests` when exceeded

## Security Notes

- The API binds to `127.0.0.1` by default for security
- To expose externally, set `API_HOST=0.0.0.0` (not recommended without additional security)
- All requests are logged with structured Pino logging
- Tokens expire after the Supabase-configured time (default 1 hour)
- Use HTTPS in production by placing behind a reverse proxy
- JSON Schema validation protects against malformed requests

## Performance

Built on Fastify for maximum performance:
- ~30,000 requests/second (2x faster than Express)
- Low memory footprint
- Efficient JSON serialization
- Native async/await support

## Logging

The API uses [Pino](https://getpino.io/) for structured JSON logging:

```
[05:08:38 UTC] INFO: incoming request
    reqId: "req-1"
    req: { "method": "GET", "url": "/health" }
[05:08:38 UTC] INFO: request completed
    reqId: "req-1"
    res: { "statusCode": 200 }
    responseTime: 0.58
```

For JSON output (production), remove the `pino-pretty` transport in `server.js`.

## Troubleshooting

**"Supabase not configured" error**
- Set the `SUPABASE_URL` and `SUPABASE_KEY` environment variables

**"Service key not configured" error**
- Set the `SUPABASE_SERVICE_KEY` environment variable (required for `/auth/invite` endpoint)
- Get the service_role key from Supabase Dashboard → Settings → API

**"Invalid token" error**
- Token may have expired - use `/auth/refresh` to get a new one
- Ensure you're using the full token (access tokens are long JWT strings)

**"User profile not found" error**
- User exists in Supabase Auth but not in the `users` table
- Sign in via the BluePLM desktop app first to create the profile

**"Validation Error" response**
- Request body doesn't match the JSON Schema
- Check the `details` field for specific validation errors

**File upload fails**
- Check that content is valid base64
- Ensure file size is under 100MB (configurable via `bodyLimit` in server.js)

