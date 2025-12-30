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

