# BluePLM Email Templates

Email templates for Supabase Authentication. These match the BluePLM dark theme with the stacked layers logo.

## Templates

| File | Supabase Template | Subject Line |
|------|-------------------|--------------|
| `confirm-signup.html` | Confirm sign up | `Confirm your BluePLM account` |
| `invite-user.html` | Invite user | `You've been invited to BluePLM` |
| `magic-link.html` | Magic link | `Your BluePLM sign-in link` |
| `change-email.html` | Change email address | `Confirm your new email address` |
| `reset-password.html` | Reset password | `Reset your BluePLM password` |
| `reauthentication.html` | Reauthentication | `Confirm your identity - BluePLM` |

## How to Apply

1. Go to **Supabase Dashboard** → **Authentication** → **Email Templates**
2. For each template:
   - Update the **Subject** line (see table above)
   - Copy the HTML content from the corresponding file
   - Paste into the **Body (HTML)** field
3. Click **Save**

> ⚠️ **Important**: The invite template is required for the user invite flow to work properly. It displays the Organization Code directly in the email so users can copy/paste it into BluePLM.

## Template Variables

These templates use Supabase's Go template syntax:

### Standard Variables (all templates)

- `{{ .ConfirmationURL }}` - The confirmation/action link
- `{{ .Token }}` - OTP code (for SMS templates)
- `{{ .SiteURL }}` - Your site URL
- `{{ .Email }}` - User's email address

### Invite Template Variables

The invite template uses custom data passed by the BluePLM API:

- `{{ .Data.org_name }}` - Organization name the user is being invited to
- `{{ .Data.org_code }}` - Organization code for BluePLM setup (PDM-XXXX-XXXX-...)
- `{{ .Data.invited_by }}` - Name/email of the admin who sent the invite

## Preview

To preview templates locally, open the HTML files in a browser. The `{{ .ConfirmationURL }}` and `{{ .Data.* }}` placeholders won't render, but you can see the styling.

## Customization

- **Logo**: The SVG logo is inline in each template (stacked layers icon)
- **Colors**: Uses bluePLM dark theme (`#0f172a`, `#1e293b`, `#3b82f6`)
- **Buttons**: Blue gradient with box shadow

## Notes

- These templates use table-based layouts for maximum email client compatibility
- Tested with Gmail, Outlook, and Apple Mail
- SVG logos may not render in some older email clients (Outlook 2016 and earlier)

