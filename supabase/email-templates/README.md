# bluePLM Email Templates

Email templates for Supabase Authentication. These match the bluePLM dark theme with the stacked layers logo.

## Templates

| File | Supabase Template | Subject Line |
|------|-------------------|--------------|
| `confirm-signup.html` | Confirm sign up | `Confirm your bluePLM account` |
| `invite-user.html` | Invite user | `You've been invited to bluePLM` |
| `magic-link.html` | Magic link | `Your bluePLM sign-in link` |
| `change-email.html` | Change email address | `Confirm your new email address` |
| `reset-password.html` | Reset password | `Reset your bluePLM password` |
| `reauthentication.html` | Reauthentication | `Confirm your identity - bluePLM` |

## How to Apply

1. Go to **Supabase Dashboard** → **Authentication** → **Email Templates**
2. For each template:
   - Update the **Subject** line (see table above)
   - Copy the HTML content from the corresponding file
   - Paste into the **Body (HTML)** field
3. Click **Save**

## Template Variables

These templates use Supabase's Go template syntax:

- `{{ .ConfirmationURL }}` - The confirmation/action link
- `{{ .Token }}` - OTP code (for SMS templates)
- `{{ .SiteURL }}` - Your site URL
- `{{ .Email }}` - User's email address

## Preview

To preview templates locally, open the HTML files in a browser. The `{{ .ConfirmationURL }}` placeholders won't work, but you can see the styling.

## Customization

- **Logo**: The SVG logo is inline in each template (stacked layers icon)
- **Colors**: Uses bluePLM dark theme (`#0f172a`, `#1e293b`, `#3b82f6`)
- **Buttons**: Blue gradient with box shadow

## Notes

- These templates use table-based layouts for maximum email client compatibility
- Tested with Gmail, Outlook, and Apple Mail
- SVG logos may not render in some older email clients (Outlook 2016 and earlier)

