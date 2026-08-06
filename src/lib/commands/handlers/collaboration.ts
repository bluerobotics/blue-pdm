/**
 * Collaboration Command Handlers
 *
 * Commands: watch, unwatch, share, notify, request-review, request-checkout, add-to-eco
 */

import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import {
  watchFile,
  unwatchFile,
  isWatchingFile,
  createShareLink,
  createReviewRequest,
  getActiveECOs,
  addFileToECO,
  supabase,
} from '../../supabase'
import { registerTerminalCommand } from '../registry'
import type { ParsedCommand, TerminalOutput } from '../parser'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/**
 * Resolve a path pattern to matching files
 */
function resolvePathPattern(pattern: string, files: LocalFile[]): LocalFile[] {
  let normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')

  if (normalizedPattern.includes('*')) {
    const regexPattern = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<DOUBLESTAR>>>/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`)

    return files.filter((f) => {
      const normalizedPath = f.relativePath.replace(/\\/g, '/')
      return regex.test(normalizedPath)
    })
  }

  const exactMatch = files.find(
    (f) => f.relativePath.replace(/\\/g, '/').toLowerCase() === normalizedPattern.toLowerCase(),
  )

  if (exactMatch) {
    return [exactMatch]
  }

  return files.filter((f) => {
    const normalizedPath = f.relativePath.replace(/\\/g, '/').toLowerCase()
    return normalizedPath.startsWith(normalizedPattern.toLowerCase() + '/')
  })
}

/**
 * Get a synced file from path (must have pdmData)
 */
function getSyncedFile(path: string, files: LocalFile[]): LocalFile | null {
  const matches = resolvePathPattern(path, files)
  if (matches.length === 0) return null
  const file = matches[0]
  if (!file.pdmData?.id) return null
  return file
}

/**
 * Handle watch command - start watching a file for notifications
 */
export async function handleWatch(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: watch <file-path>')
    return
  }

  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }

  const file = getSyncedFile(path, files)
  if (!file || !file.pdmData?.id) {
    addOutput('error', `Synced file not found: ${path}`)
    return
  }

  if (file.isDirectory) {
    addOutput('error', 'Cannot watch folders, only files')
    return
  }

  // Check if already watching
  const { watching } = await isWatchingFile(file.pdmData.id, user.id)
  if (watching) {
    addOutput('info', `Already watching: ${file.name}`)
    return
  }

  const { success, error } = await watchFile(organization.id, file.pdmData.id, user.id, {
    notifyOnCheckin: true,
    notifyOnCheckout: !parsed.flags['no-checkout'],
    notifyOnStateChange: true,
    notifyOnReview: true,
  })

  if (success) {
    addOutput('success', `Now watching: ${file.name}`)
  } else {
    addOutput('error', `Failed to watch file: ${error}`)
  }
}

/**
 * Handle unwatch command - stop watching a file
 */
export async function handleUnwatch(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: unwatch <file-path>')
    return
  }

  const { user } = usePDMStore.getState()
  if (!user) {
    addOutput('error', 'Not signed in')
    return
  }

  const file = getSyncedFile(path, files)
  if (!file || !file.pdmData?.id) {
    addOutput('error', `Synced file not found: ${path}`)
    return
  }

  const { success, error } = await unwatchFile(file.pdmData.id, user.id)

  if (success) {
    addOutput('success', `Stopped watching: ${file.name}`)
  } else {
    addOutput('error', `Failed to unwatch file: ${error}`)
  }
}

/**
 * Handle share command - create a shareable link for a file
 */
export async function handleShare(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: share <file-path> [--days=N]')
    return
  }

  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }

  const file = getSyncedFile(path, files)
  if (!file || !file.pdmData?.id) {
    addOutput('error', `Synced file not found: ${path}`)
    return
  }

  if (file.isDirectory) {
    addOutput('error', 'Cannot share folders, only files')
    return
  }

  const expiresInDays = parsed.flags['days'] ? parseInt(parsed.flags['days'] as string) : 7

  addOutput('info', 'Creating share link...')

  const { link, error } = await createShareLink(organization.id, file.pdmData.id, user.id, {
    expiresInDays,
  })

  if (link) {
    addOutput('success', `Share link created for ${file.name}:`)
    addOutput('info', link.downloadUrl)
    addOutput(
      'info',
      `Expires: ${link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : 'Never'}`,
    )
  } else {
    addOutput('error', `Failed to create share link: ${error}`)
  }
}

/**
 * Handle notify/mention command - notify a user about a file
 */
export async function handleNotify(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const path = parsed.args[0]
  const email = parsed.args[1]

  if (!path || !email) {
    addOutput('error', 'Usage: notify <file-path> <email> [--message="..."]')
    return
  }

  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }

  const file = getSyncedFile(path, files)
  if (!file || !file.pdmData?.id) {
    addOutput('error', `Synced file not found: ${path}`)
    return
  }

  // Find the user by email
  const { data: targetUser, error: userError } = await supabase
    .from('users')
    .select('id, email, full_name')
    .eq('email', email.toLowerCase())
    .single()

  if (userError || !targetUser) {
    addOutput('error', `User not found: ${email}`)
    return
  }

  addOutput('info', 'Notification system has been removed. Mention not sent.')
  addOutput(
    'info',
    `Would have notified ${targetUser.full_name || targetUser.email} about ${file.name}`,
  )
}

/**
 * Handle request-review command - request a file review
 */
export async function handleRequestReview(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const path = parsed.args[0]
  const reviewerEmails = parsed.args.slice(1)

  if (!path || reviewerEmails.length === 0) {
    addOutput(
      'error',
      'Usage: request-review <file-path> <email> [email2...] [--message="..."] [--title="..."]',
    )
    return
  }

  const { organization, user, activeVaultId } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }

  const file = getSyncedFile(path, files)
  if (!file || !file.pdmData?.id) {
    addOutput('error', `Synced file not found: ${path}`)
    return
  }

  if (file.isDirectory) {
    addOutput('error', 'Cannot request review for folders, only files')
    return
  }

  // Resolve reviewer emails to IDs
  const reviewerIds: string[] = []
  for (const email of reviewerEmails) {
    const { data: reviewer } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single()

    if (reviewer) {
      reviewerIds.push(reviewer.id)
    } else {
      addOutput('error', `Reviewer not found: ${email}`)
      return
    }
  }

  const message = (parsed.flags['message'] as string) || (parsed.flags['m'] as string) || undefined
  const title = (parsed.flags['title'] as string) || undefined

  const { error } = await createReviewRequest(
    organization.id,
    file.pdmData.id,
    activeVaultId,
    user.id,
    reviewerIds,
    file.pdmData.version || 1,
    title,
    message,
  )

  if (!error) {
    addOutput(
      'success',
      `Review request sent to ${reviewerIds.length} reviewer${reviewerIds.length > 1 ? 's' : ''} for ${file.name}`,
    )
  } else {
    addOutput('error', `Failed to create review request: ${error}`)
  }
}

/**
 * Handle request-checkout command - request checkout from current owner
 */
export async function handleRequestCheckout(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: request-checkout <file-path> [--message="..."]')
    return
  }

  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }

  const file = getSyncedFile(path, files)
  if (!file || !file.pdmData?.id) {
    addOutput('error', `Synced file not found: ${path}`)
    return
  }

  if (!file.pdmData.checked_out_by) {
    addOutput('error', `File is not checked out: ${file.name}`)
    return
  }

  if (file.pdmData.checked_out_by === user.id) {
    addOutput('error', `File is already checked out by you: ${file.name}`)
    return
  }

  const ownerName =
    file.pdmData.checked_out_user?.full_name || file.pdmData.checked_out_user?.email || 'the owner'
  addOutput('info', 'Notification system has been removed. Checkout request not sent.')
  addOutput('info', `Would have sent checkout request to ${ownerName}`)
}

/**
 * Handle add-to-eco command - add file to an ECO
 */
export async function handleAddToECO(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const path = parsed.args[0]
  const ecoIdentifier = parsed.args[1]

  if (!path) {
    addOutput('error', 'Usage: add-to-eco <file-path> [eco-number] [--notes="..."]')
    addOutput('info', 'If ECO number is omitted, lists available ECOs')
    return
  }

  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }

  const file = getSyncedFile(path, files)
  if (!file || !file.pdmData?.id) {
    addOutput('error', `Synced file not found: ${path}`)
    return
  }

  if (file.isDirectory) {
    addOutput('error', 'Cannot add folders to ECO, only files')
    return
  }

  // If no ECO specified, list available ECOs
  if (!ecoIdentifier) {
    const { ecos, error } = await getActiveECOs(organization.id)
    if (error) {
      addOutput('error', `Failed to get ECOs: ${error}`)
      return
    }

    if (ecos.length === 0) {
      addOutput('info', 'No active ECOs available')
      return
    }

    addOutput('info', 'Available ECOs:')
    for (const eco of ecos) {
      addOutput('info', `  ${eco.eco_number}: ${eco.title} [${eco.status}]`)
    }
    addOutput('info', `\nUsage: add-to-eco ${path} <eco-number>`)
    return
  }

  // Find the ECO by number or ID
  const { ecos } = await getActiveECOs(organization.id)
  const eco = ecos.find(
    (e) => e.eco_number.toLowerCase() === ecoIdentifier.toLowerCase() || e.id === ecoIdentifier,
  )

  if (!eco) {
    addOutput('error', `ECO not found: ${ecoIdentifier}`)
    return
  }

  const notes = (parsed.flags['notes'] as string) || (parsed.flags['n'] as string) || undefined

  const { success, error } = await addFileToECO(file.pdmData.id, eco.id, user.id, notes)

  if (success) {
    addOutput('success', `Added ${file.name} to ECO ${eco.eco_number}`)
  } else {
    addOutput('error', `Failed to add to ECO: ${error}`)
  }
}

// ============================================
// Self-registration
// ============================================

registerTerminalCommand(
  {
    aliases: ['watch'],
    description: 'Watch a file for notifications',
    usage: 'watch <file-path> [--no-checkout]',
    examples: ['watch Parts/bracket.sldprt'],
    category: 'pdm',
  },
  async (parsed, files, addOutput) => {
    await handleWatch(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['unwatch'],
    description: 'Stop watching a file',
    usage: 'unwatch <file-path>',
    category: 'pdm',
  },
  async (parsed, files, addOutput) => {
    await handleUnwatch(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['share', 'share-link'],
    description: 'Create a shareable download link',
    usage: 'share <file-path> [--days=N]',
    examples: ['share drawing.pdf', 'share part.sldprt --days=30'],
    category: 'pdm',
  },
  async (parsed, files, addOutput) => {
    await handleShare(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['notify', 'mention'],
    description: 'Notify someone about a file',
    usage: 'notify <file-path> <email> [--message="..."]',
    examples: ['notify part.sldprt john@company.com --message="Please review"'],
    category: 'pdm',
  },
  async (parsed, files, addOutput) => {
    await handleNotify(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['request-review', 'review'],
    description: 'Request a file review',
    usage: 'request-review <file-path> <email> [emails...] [--message="..."]',
    examples: ['request-review part.sldprt engineer@company.com'],
    category: 'pdm',
  },
  async (parsed, files, addOutput) => {
    await handleRequestReview(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['request-checkout'],
    description: 'Request checkout from current owner',
    usage: 'request-checkout <file-path> [--message="..."]',
    examples: ['request-checkout part.sldprt --message="Need urgent changes"'],
    category: 'pdm',
  },
  async (parsed, files, addOutput) => {
    await handleRequestCheckout(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['add-to-eco', 'eco-add'],
    description: 'Add a file to an ECO',
    usage: 'add-to-eco <file-path> [eco-number] [--notes="..."]',
    examples: ['add-to-eco part.sldprt ECO-001', 'add-to-eco drawing.pdf'],
    category: 'pdm',
  },
  async (parsed, files, addOutput) => {
    await handleAddToECO(parsed, files, addOutput)
  },
)
