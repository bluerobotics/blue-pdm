import { getSupabaseClient } from './client'

export interface ShareLinkOptions {
  expiresInDays?: number
}

// Identifies the audit row below and nothing else. It is not the recipient's
// credential and never appears in the URL they receive.
function generateToken(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Create a shareable link for a file - generates a signed URL from Supabase Storage.
 *
 * The recipient's URL is the storage URL itself, so expiry is the only property
 * BluePLM holds over it, and Storage is what enforces that. An issued link cannot
 * be recalled, capped or restricted to signed-in users: each of those would require
 * downloads to travel through a BluePLM-controlled endpoint, which is a deliberate
 * non-goal. Controls that promised any of them are gone rather than left inert.
 */
export async function createShareLink(
  orgId: string,
  fileId: string,
  createdBy: string,
  options?: ShareLinkOptions,
): Promise<{
  link: { id: string; token: string; expiresAt: string | null; downloadUrl: string } | null
  error?: string
}> {
  const client = getSupabaseClient()

  const { data: fileData, error: fileError } = await client
    .from('files')
    .select('content_hash, file_name, org_id')
    .eq('id', fileId)
    .single()

  if (fileError || !fileData) {
    return { link: null, error: fileError?.message || 'File not found' }
  }

  if (!fileData.content_hash) {
    return { link: null, error: 'File has no content in storage' }
  }

  const expiresInSeconds = options?.expiresInDays
    ? Math.min(options.expiresInDays * 24 * 60 * 60, 365 * 24 * 60 * 60)
    : 7 * 24 * 60 * 60

  const storagePath = `${fileData.org_id}/${fileData.content_hash.substring(0, 2)}/${fileData.content_hash}`

  const { data: signedUrlData, error: signedUrlError } = await client.storage
    .from('vault')
    .createSignedUrl(storagePath, expiresInSeconds, {
      download: fileData.file_name,
    })

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return { link: null, error: signedUrlError?.message || 'Failed to generate download URL' }
  }

  const token = generateToken(12)

  let expiresAt: string | null = null
  if (options?.expiresInDays) {
    const date = new Date()
    date.setDate(date.getDate() + options.expiresInDays)
    expiresAt = date.toISOString()
  } else {
    const date = new Date()
    date.setDate(date.getDate() + 7)
    expiresAt = date.toISOString()
  }

  // An audit trail of who shared what and when. It gates nothing, so best-effort is
  // the correct handling and not an oversight: the signed URL above is already valid,
  // and refusing to hand it over because the record did not land would withhold a
  // working link in order to protect a log entry.
  try {
    await client.from('file_share_links').insert({
      org_id: orgId,
      file_id: fileId,
      token,
      created_by: createdBy,
      expires_at: expiresAt,
    })
  } catch {
    // Intentionally ignored - see above.
  }

  return {
    link: {
      id: token,
      token,
      expiresAt,
      downloadUrl: signedUrlData.signedUrl,
    },
  }
}
