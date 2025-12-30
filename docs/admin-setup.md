# Admin Setup

This guide is for administrators setting up BluePLM for their organization.

## Prerequisites

You need a [Supabase](https://supabase.com) project. Supabase provides:
- PostgreSQL database
- User authentication (Google, email, phone)
- File storage
- Real-time subscriptions

## Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create an account
2. Create a new project
3. Note your **Project URL** and **Anon Key** from Settings → API

## Step 2: Set Up the Database

Run the schema file to create all required tables:

1. Go to the SQL Editor in your Supabase dashboard
2. Copy the contents of `supabase/schema.sql` from the BluePLM repo
3. Run it in the SQL Editor

This creates tables for organizations, users, vaults, files, teams, and more.

## Step 3: Configure Authentication

In your Supabase project:

1. Go to Authentication → Providers
2. Enable **Google** (recommended) - requires Google Cloud OAuth credentials
3. Optionally enable **Email** and/or **Phone**
4. Set your Site URL to `blueplm://auth-callback`

## Step 4: Connect BluePLM

1. Download and open BluePLM
2. On the Setup screen, click **"I'm setting up BluePLM for my organization"**
3. Enter your:
   - **Supabase URL** - `https://xxxxx.supabase.co`
   - **Anon Key** - starts with `eyJ...`
   - **Organization Slug** (optional) - short identifier like `bluerobotics`
4. Click **Connect to Supabase**

## Step 5: Share the Organization Code

After connecting, BluePLM generates an **Organization Code**. This is a base64-encoded string containing your Supabase credentials.

1. Copy the code (it looks like `PDM-XXXX-XXXX...`)
2. Share it with your team members securely
3. They'll enter this code to connect their BluePLM clients

::: warning Keep the code secure
The Organization Code contains your Supabase anon key. Share it only with trusted team members.
:::

## Step 6: Create Vaults

Vaults are top-level containers for files. Create your first vault:

1. Sign in with Google (you'll be the first admin)
2. Go to **Settings → Vaults**
3. Click **Create Vault**
4. Enter a name (e.g., "Engineering Files")

The first vault is marked as default.

## Step 7: Invite Users

Team members can now:

1. Download BluePLM
2. Enter the Organization Code
3. Sign in with Google/email/phone
4. Connect to your vaults

### User Roles

- **Admin** - Full access, can manage users/vaults/settings
- **Member** - Can access vaults they're assigned to

Assign roles in **Settings → Members & Teams**.

## Next Steps

- [Configure Teams & Permissions](/settings/organization)
- [Set up Integrations](/settings/integrations)

