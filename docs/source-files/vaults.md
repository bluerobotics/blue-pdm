# Vaults

Vaults are the top-level containers for organizing files in BluePLM. Think of them as separate file repositories within your organization.

## What is a Vault?

A vault is:
- A named collection of files and folders
- Stored in Supabase storage
- Synced to a local folder on each user's machine
- Access-controlled per user

## Common Vault Structures

Organizations typically create vaults for:
- **Product lines** - "BlueROV2", "Navigator"
- **Departments** - "Engineering", "Manufacturing"
- **Clients** - "Acme Corp", "Widget Inc"
- **File types** - "CAD Files", "Documentation"

## Managing Vaults

### Creating Vaults (Admin)

1. Go to **Settings → Vaults**
2. Click **Create Vault**
3. Enter:
   - **Name** - Display name
   - **Description** (optional)
4. Click **Create**

The first vault is automatically marked as default.

### Vault Properties

- **Name** - Displayed in the UI
- **Slug** - URL-safe identifier (auto-generated)
- **Description** - Optional notes
- **Default** - Star icon indicates the default vault

### Renaming/Deleting Vaults

In Settings → Vaults:
- Click the pencil icon to rename
- Click the trash icon to delete (requires confirmation)

::: danger Deleting Vaults
Deleting a vault removes all its files from the server. This cannot be undone.
:::

## Vault Access

### How Access Works

- **Admins** see all vaults automatically
- **Non-admins** only see vaults they're granted access to

### Granting Access (Admin)

1. Go to **Settings → Members & Teams**
2. Find the user
3. Click to edit their vault access
4. Check the vaults they should access
5. Save

### Access Enforcement

When vault access is revoked:
- User is disconnected from that vault
- Local files remain but won't sync

## Local Storage

Each vault syncs to a local folder:

| Platform | Path |
|----------|------|
| Windows | `C:\BluePLM\vault-slug` |
| macOS | `~/Documents/BluePLM/vault-slug` |
| Linux | `~/BluePLM/vault-slug` |

## Connecting to Vaults

### From Welcome Screen

After signing in, available vaults appear. Click **Connect** to:
1. Create the local folder
2. Start syncing files

### From Explorer

Already connected vaults show in the sidebar. Click to expand and browse.

### Disconnecting

Right-click a vault in Explorer → **Disconnect**

This removes the vault from the sidebar but keeps local files.

