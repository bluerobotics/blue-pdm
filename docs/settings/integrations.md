# Integrations

Connect BluePLM to external services.

## Supabase

Your database and authentication backend.

**Status indicators:**
- 🟢 Connected to your Supabase project
- 🔴 Connection error

**View:**
- Project URL
- Connection status
- Database schema version

## SolidWorks

Native integration for SolidWorks CAD files (Windows only).

**Features when enabled:**
- Thumbnail previews
- Part/assembly metadata extraction
- Reference tracking between files

**Status indicators:**
- 🟢 Full functionality (SW API + Document Manager)
- 🟡 Partial (Document Manager only, SolidWorks not installed)
- 🔴 Service not running
- ⚫ Integration disabled

**Configuration:**
- Toggle integration on/off
- License key for Document Manager API
- Service status
- **Keep SolidWorks warm in background** (organization-wide, admin only) — pre-launches a hidden SolidWorks instance so the first property edit is instant instead of a ~40 second cold start. No window is shown. On by default.

The same status is also available at a glance from the title bar: enable **SolidWorks Status** in the top bar's configuration dropdown to show a CAD glyph that reflects the live service state. Hovering it shows service stats, and clicking it opens **Settings** → **Integrations** → **SolidWorks**.

### Obtaining a Document Manager API Key

The SolidWorks Document Manager (DM) API key is **required** to read SolidWorks file metadata, extract thumbnails, and track references without needing a full SolidWorks installation. This is essential for server-side processing and for users who don't have SolidWorks installed.

**How to get your DM API key:**

1. **Contact your SolidWorks reseller (VAR)**
   - Your Value Added Reseller can request a Document Manager API license on your behalf
   - Provide them with your SolidWorks serial number and company information

2. **Or request directly from SolidWorks**
   - Visit the [SolidWorks Customer Portal](https://customerportal.solidworks.com)
   - Log in with your SolidWorks account
   - Navigate to **My Products** → **Request Document Manager Key**
   - Fill out the form with your application details

3. **What you'll receive**
   - A license key string (looks like: `your-company-name:swdocmgr_general-00000-00000-00000-00000-00000`)
   - This key is tied to your SolidWorks subscription

**Entering your key in BluePLM:**

1. Go to **Settings** → **Integrations** → **SolidWorks**
2. Paste your Document Manager API key in the license key field
3. Click **Save** and restart the SolidWorks service

**Important notes:**
- The DM API key is separate from your SolidWorks installation license
- Keys are typically provided at no additional cost with active SolidWorks subscriptions
- The key allows read-only access to SolidWorks file data
- Keep your key secure — treat it like a password

## Google Drive

Sync files with Google Drive.

**Setup:**
1. Enter Google Cloud OAuth credentials
2. Authorize BluePLM access
3. Choose sync folder

**Features:**
- Two-way sync with Drive folder
- Automatic upload on checkin
- Download from Drive

## Odoo ERP

Connect to Odoo for ERP integration.

**Features:**
- Sync product data
- Push BOM information
- Link files to Odoo records

**Configuration:**
- Multiple Odoo instances supported
- Enter URL, database, API key
- Test connection

## Slack

Send notifications to Slack channels.

**Features:**
- Checkin/checkout notifications
- File update alerts
- Workflow notifications

*Status: Coming soon*

## Webhooks

Send events to custom endpoints.

**Use cases:**
- Trigger CI/CD pipelines
- Sync with other systems
- Custom notifications

*Status: Coming soon*

## REST API

Access BluePLM data via REST API.

**Configuration:**
- API URL (default: localhost for development)
- View API documentation at `/docs`

**Features:**
- File operations
- User management
- Integration endpoints

**Deployment:**
The API server can be deployed to:
- Railway
- Render
- Any Node.js host

See the `api/` folder in the repo for deployment instructions.

