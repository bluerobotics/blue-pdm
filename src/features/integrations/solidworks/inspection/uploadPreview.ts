/**
 * Part preview upload for inspection templates.
 *
 * Google Sheets `=IMAGE()` needs a publicly reachable URL, but SolidWorks previews are
 * extracted locally. This extracts the drawing/part preview and uploads it to the private
 * `vault` bucket, returning a long-lived signed URL that Google's servers can fetch.
 */

import { supabase } from '@/lib/supabase'
import { log } from '@/lib/logger'

// Signed URLs are the credential for the private vault bucket. A long expiry keeps the image
// rendering in generated report sheets (the sheet is a point-in-time snapshot).
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365

interface ParsedDataUrl {
  mimeType: string
  base64: string
}

function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('bmp')) return 'bmp'
  return 'png'
}

/**
 * Extract the SolidWorks preview for a file and upload it, returning a public URL usable in
 * an `=IMAGE()` formula. Returns null when no preview is available or the upload fails.
 */
export async function uploadInspectionPreview(
  localPath: string,
  fileId: string,
  orgId: string,
): Promise<string | null> {
  try {
    const result = await window.electronAPI?.extractSolidWorksPreview?.(localPath)
    if (!result?.success || !result.data) {
      log.info('[InspectionPreview]', 'No preview available for file', { fileId })
      return null
    }

    const parsed = parseDataUrl(result.data)
    if (!parsed) {
      log.warn('[InspectionPreview]', 'Preview was not a data URL')
      return null
    }

    const blob = base64ToBlob(parsed.base64, parsed.mimeType)
    const ext = extensionForMime(parsed.mimeType)
    const storagePath = `${orgId}/inspection-previews/${fileId}-${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage.from('vault').upload(storagePath, blob, {
      contentType: parsed.mimeType,
      upsert: true,
    })
    if (uploadError) {
      log.warn('[InspectionPreview]', 'Upload failed', { error: uploadError.message })
      return null
    }

    const { data, error: signError } = await supabase.storage
      .from('vault')
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS)
    if (signError || !data?.signedUrl) {
      log.warn('[InspectionPreview]', 'Signed URL failed', { error: signError?.message })
      return null
    }

    return data.signedUrl
  } catch (error) {
    log.warn('[InspectionPreview]', 'Preview upload exception', { error: String(error) })
    return null
  }
}
