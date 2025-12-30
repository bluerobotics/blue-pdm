# User Setup

This guide is for team members joining an existing BluePLM organization.

## What You Need

- BluePLM installed on your computer
- An **Organization Code** from your admin

## Step 1: Get the Organization Code

Your admin will provide an Organization Code. It looks like:

```
PDM-XXXX-XXXX-XXXX...
```

This code contains the connection info for your organization's Supabase backend.

## Step 2: Enter the Code

1. Open BluePLM
2. Complete the language/analytics setup if this is your first launch
3. On the Setup screen, click **"I have an Organization Code"**
4. Paste the code your admin provided
5. Click **Connect**

## Step 3: Sign In

Choose how to sign in:

### Team Member
Click **Team Member** to sign in as a regular user:
- **Google** (recommended) - fastest option
- **Email** - enter email and password
- **Phone** - receive an SMS verification code

### Supplier
If you're a supplier/vendor accessing the supplier portal:
- Email or phone authentication only
- Your access is limited to supplier-specific features

## Step 4: Connect to a Vault

After signing in, you'll see the **Welcome screen** showing available vaults.

1. Click **Connect** next to a vault
2. BluePLM creates a local folder for the vault (e.g., `C:\BluePLM\vault-name`)
3. Files sync between this folder and the cloud

::: tip Vault Location
- **Windows**: `C:\BluePLM\vault-name`
- **macOS**: `~/Documents/BluePLM/vault-name`
- **Linux**: `~/BluePLM/vault-name`
:::

## Working Offline

Can't connect right now? Click **Work Offline** on the sign-in screen.

In offline mode you can:
- Browse and edit local files
- Changes won't sync until you're back online

## Troubleshooting

### "Invalid Organization Code"
- Make sure you copied the entire code
- Ask your admin to regenerate the code if needed

### "Sign in failed"
- Check your internet connection
- Try a different sign-in method
- Contact your admin if your account isn't set up

### Can't see any vaults
- Your admin needs to grant you vault access
- Go to Settings → Members & Teams (admin only)

## Next Steps

- [Learn the Explorer interface](/source-files/explorer)
- [Understand Vaults](/source-files/vaults)

