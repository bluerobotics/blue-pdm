# Admin Setup

This guide walks you through setting up BluePLM for your organization. Follow the steps in order.

## Prerequisites

You need:
- A [Supabase](https://supabase.com) account (free tier works)
- BluePLM installed on your computer
- (Optional) A Google Cloud account for Google Sign-In
- (Recommended) An email provider account ([Resend](https://resend.com) or [SendGrid](https://sendgrid.com)) for reliable invite emails

## Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in or create an account
2. Click **New Project**
3. Choose a project name and set a strong database password
4. Select a region close to your team
5. Click **Create new project** and wait ~2 minutes for provisioning

Once ready, go to **Settings → API** and note:
- **Project URL** (e.g., `https://abcdefgh.supabase.co`)
- **anon/public key** (starts with `eyJ...`)

You'll enter these in BluePLM later.

## Step 2: Set Up Google OAuth (Recommended)

Google Sign-In provides the smoothest authentication experience. Skip this step if you prefer email/password only.

### In Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select an existing one
3. Navigate to **OAuth consent screen**
   - Choose **External** (recommended) — allows any Google account to sign in
   - Choose **Internal** only if you want to restrict sign-in to your Google Workspace domain exclusively
4. Fill in:
   - App name: "BluePLM"
   - User support email: your email
   - Developer contact: your email
5. Click **Save and Continue** through the scopes (defaults are fine)
6. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
7. Select **Web application**
8. Add this **Authorized redirect URI**:
   ```
   https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
   ```
   Replace `YOUR-PROJECT-REF` with your Supabase project reference (the subdomain from your Project URL).
9. Click **Create** and copy your **Client ID** and **Client Secret**

### In Supabase Dashboard

1. Go to **Authentication** → **Providers** → **Google**
2. Toggle **Enable Sign in with Google**
3. Paste your **Client ID** and **Client Secret**
4. Click **Save**
5. Go to **Authentication** → **URL Configuration**
6. Set **Site URL** to: `http://localhost`
7. Add these **Redirect URLs**:
   - `http://localhost`
   - `http://localhost:5173`
   - `http://127.0.0.1`

## Step 3: Create Storage Bucket

::: warning Do This Before Running Schema
The storage bucket must exist before running the schema SQL, or the storage policies will fail.
:::

1. Go to **Storage** in Supabase Dashboard
2. Click **New Bucket**
3. Name it exactly: `vault`
4. **Uncheck** "Public bucket" (must be private)
5. Click **Create bucket**

## Step 4: Run Database Schema

The schema creates all required tables, functions, Row Level Security policies, and storage policies.

1. Go to **SQL Editor** in Supabase Dashboard
2. Click **New query**
3. Open [`supabase/schema.sql`](https://github.com/bluerobotics/bluePLM/blob/main/supabase/schema.sql) from the BluePLM repository
4. Copy the entire contents
5. Paste into the SQL Editor
6. Click **Run**

Verify there are no errors. Warnings about "already exists" are OK if you're re-running.

## Step 5: Create Your Organization

Run this SQL in the SQL Editor (customize the values):

```sql
INSERT INTO organizations (name, slug, email_domains)
VALUES (
  'Your Company Name',           -- Display name
  'your-company',                -- URL-safe slug (lowercase, no spaces)
  ARRAY['yourcompany.com']       -- Email domains for your team
);
```

This automatically creates:
- Default teams: **Viewers**, **Engineers**, **Administrators**
- Default job titles (Design Engineer, Quality Engineer, etc.)

::: tip Email Domains
The `email_domains` array enables auto-detection. When users with matching email domains sign in, BluePLM can automatically associate them with your organization.
:::

## Step 6: Connect BluePLM

1. Download and open BluePLM
2. Complete the language/analytics setup if this is your first launch
3. On the Setup screen, click **"I'm setting up BluePLM for my organization"**
4. Enter:
   - **Supabase URL**: `https://xxxxx.supabase.co`
   - **Anon Key**: starts with `eyJ...`
   - **Organization Slug** (optional): e.g., `your-company`
5. Click **Connect to Supabase**
6. Copy the generated **Organization Code** (save this for team members!)

::: warning Keep the Code Secure
The Organization Code contains your Supabase anon key encoded. Share it only with trusted team members.
:::

## Step 7: Sign In and Configure Admin

1. Click **Continue** and sign in with Google (or email/phone)
2. After signing in, you need to link yourself to the organization and grant admin privileges

Run this SQL in the SQL Editor (replace the values):

```sql
-- 1. Link yourself to the org and set as admin
UPDATE users 
SET org_id = (SELECT id FROM organizations WHERE slug = 'your-company'),
    role = 'admin'
WHERE email = 'your.email@yourcompany.com';

-- 2. Add yourself to the Administrators team
INSERT INTO team_members (team_id, user_id, is_team_admin, added_by)
SELECT 
  t.id,
  u.id,
  TRUE,
  u.id
FROM teams t, users u
WHERE t.org_id = (SELECT id FROM organizations WHERE slug = 'your-company')
  AND t.name = 'Administrators'
  AND u.email = 'your.email@yourcompany.com'
ON CONFLICT (team_id, user_id) DO NOTHING;
```

**Sign out and back in** to BluePLM for the changes to take effect.

## Step 8: Create Your First Vault

Vaults are containers for files. Create at least one to start working.

First, get your organization ID:

```sql
SELECT id FROM organizations WHERE slug = 'your-company';
```

Then create the vault (replace the UUID):

```sql
INSERT INTO vaults (org_id, name, slug, storage_bucket, is_default)
VALUES (
  'ORG-UUID-HERE',   -- Your organization ID from above
  'Main Vault',      -- Display name
  'main-vault',      -- URL-safe slug
  'vault',           -- Storage bucket name (must match step 3)
  true               -- Make this the default vault
);
```

## Step 9: Create Default Workflow

Files need a workflow to track their lifecycle states (WIP → In Review → Released → Obsolete).

Get your organization and user IDs:

```sql
SELECT id FROM organizations WHERE slug = 'your-company';
SELECT id FROM users WHERE email = 'your.email@yourcompany.com';
```

Create the default workflow (replace UUIDs):

```sql
SELECT create_default_workflow_v2('ORG-UUID', 'USER-UUID');
```

This creates the standard release workflow with:
- **WIP** (Work In Progress) - Initial state
- **In Review** - Ready for approval
- **Released** - Approved for use
- **Obsolete** - Deprecated/retired

## Step 10: Deploy REST API (Required for Invites)

The REST API server is needed for sending invite emails and ERP integrations.

### Deploy to Railway (Recommended)

1. Go to [railway.app/new](https://railway.app/new)
2. Select **"Deploy from Docker Image"**
3. Enter: `ghcr.io/bluerobotics/blueplm-api:latest`
4. Add these environment variables (from Supabase Dashboard → Settings → API):

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Your Project URL |
| `SUPABASE_KEY` | anon/public key |
| `SUPABASE_SERVICE_KEY` | service_role key ⚠️ |

5. Deploy and copy your API URL (e.g., `https://your-app.railway.app`)

::: danger Keep service_role Key Secret
The `SUPABASE_SERVICE_KEY` bypasses Row Level Security. Never expose it in client-side code.
:::

### Configure in BluePLM

1. Go to **Settings → Integrations → REST API**
2. Enable **"Use External API"**
3. Enter your Railway API URL
4. Click **Test Connection** to verify

### Alternative Deployment Options

See the [API README](https://github.com/bluerobotics/bluePLM/tree/main/api) for:
- Render deployment
- Fly.io deployment
- Self-hosted Docker

## Step 11: Configure Email Delivery (Recommended)

By default, Supabase uses their shared email domain (`noreply@mail.app.supabase.io`) which often lands in spam. Configure a custom SMTP provider for reliable email delivery.

### Option A: Resend (Recommended)

[Resend](https://resend.com) offers 100 free emails/day and easy setup.

#### 1. Set Up Resend

1. Sign up at [resend.com](https://resend.com)
2. Go to **Domains** → **Add Domain**
3. Enter your domain (e.g., `blueplm.io` or `yourcompany.com`)
4. Add the DNS records Resend provides to your domain registrar
5. Wait for verification (~5 minutes)
6. Go to **API Keys** → **Create API Key** and copy it

#### 2. Configure in Supabase

1. Go to **Project Settings** → **Authentication**
2. Scroll to **SMTP Settings** → Toggle **Enable Custom SMTP**
3. Fill in:

| Field | Value |
|-------|-------|
| **Host** | `smtp.resend.com` |
| **Port** | `465` |
| **Username** | `resend` |
| **Password** | Your API key (e.g., `re_xxxxxxxxx...`) |
| **Sender email** | `noreply@yourdomain.com` |
| **Sender name** | `BluePLM` |

4. Click **Save**

### Option B: SendGrid

[SendGrid](https://sendgrid.com) also offers a free tier (100 emails/day).

1. Sign up and verify your domain
2. Create an API key with Mail Send permissions
3. Use these SMTP settings:

| Field | Value |
|-------|-------|
| **Host** | `smtp.sendgrid.net` |
| **Port** | `465` |
| **Username** | `apikey` |
| **Password** | Your API key |
| **Sender email** | `noreply@yourdomain.com` |
| **Sender name** | `BluePLM` |

::: tip Test Your Configuration
After setup, invite yourself (using a different email) to verify emails arrive in the inbox, not spam.
:::

## Step 12: Set Up Email Templates (Required for Invites)

BluePLM includes branded email templates for authentication emails. **The invite template is required** — it displays the Organization Code directly in the email so invited users can copy/paste it into BluePLM.

::: warning Required for User Invites
Without the invite template, users won't see their Organization Code in the invite email. Set this up before inviting team members.
:::

### Set Up the Invite Template

1. Go to **Authentication** → **Email Templates** in Supabase Dashboard
2. Select **Invite user**
3. Set **Subject** to: `You've been invited to BluePLM`
4. Copy the HTML from [`supabase/email-templates/invite-user.html`](https://github.com/bluerobotics/bluePLM/blob/main/supabase/email-templates/invite-user.html)
5. Paste into the **Body (HTML)** field
6. Click **Save**

The invite email will now show:
- Organization name
- **Organization Code** (copyable) — users paste this into BluePLM
- Download instructions
- Link to blueplm.io/downloads

### Other Templates (Optional)

For consistent branding, you can also update these templates from [`supabase/email-templates/`](https://github.com/bluerobotics/bluePLM/tree/main/supabase/email-templates):

| Template | Subject Line |
|----------|--------------|
| Confirm sign up | `Confirm your BluePLM account` |
| Magic link | `Your BluePLM sign-in link` |
| Change email | `Confirm your new email address` |
| Reset password | `Reset your BluePLM password` |

## Sharing with Team Members

There are two ways to add team members:

### Option A: Send Invites (Recommended)

Use BluePLM's invite feature in **Settings → Members & Teams**:

1. Click **Invite User**
2. Enter their email address
3. They receive an email with:
   - The **Organization Code** (ready to copy)
   - Link to download BluePLM
   - Setup instructions

This is the easiest method — users get everything they need in one email.

### Option B: Share Code Manually

Share the **Organization Code** generated in Step 6 directly:

1. Go to **Settings → Members & Teams**
2. Click **Show Organization Code**
3. Send the code to team members along with download link

Team members then:
1. Download BluePLM from [blueplm.io/downloads](https://blueplm.io/downloads)
2. Select **"I have an Organization Code"**
3. Paste the code
4. Sign in with Google/email/phone

The code contains your Supabase connection info encoded — team members don't need to enter URLs or keys manually.

See [User Setup Guide](/user-setup) for detailed team member instructions.

## Troubleshooting

### Schema SQL fails with "bucket not found"
Create the `vault` storage bucket (Step 3) before running the schema.

### Google Sign-In shows "Access blocked: org_internal"
Your Google OAuth app is set to "Internal". Go to Google Cloud Console → **APIs & Services** → **OAuth consent screen** and change the user type to **External**. This allows any Google account to sign in, not just your Google Workspace users.

### Google Sign-In shows "redirect_uri_mismatch"
Verify your Supabase project URL is in Google Cloud's authorized redirect URIs exactly:
```
https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
```

### Users can't see any vaults
Grant vault access via **Settings → Members & Teams**. Non-admin users don't see vaults automatically.

### Organization Code doesn't work
Regenerate the code by disconnecting and reconnecting to Supabase in BluePLM.

### Can't sign in after running admin SQL
Make sure you signed out and back in after running the admin setup SQL.

### Invite emails going to spam
Configure custom SMTP (Step 11). Supabase's default email domain (`noreply@mail.app.supabase.io`) is often flagged as spam.

### "Service key not configured" error when inviting users
1. Verify `SUPABASE_SERVICE_KEY` is set in your Railway environment variables
2. **Redeploy** the API service after adding the variable (Railway doesn't auto-restart)

## Next Steps

- [Configure Teams & Permissions](/settings/organization)
- [Set up Integrations](/settings/integrations)
- [Understand Vaults](/source-files/vaults)
