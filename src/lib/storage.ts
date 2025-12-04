/**
 * Blue PDM Storage Service
 * 
 * Handles file storage using Supabase Storage with content-addressable storage.
 * Each file version is stored by its SHA-256 hash, enabling deduplication.
 * 
 * Storage structure:
 *   vault/{org_id}/{hash}           - Actual file content (deduplicated)
 *   
 * Database tracks:
 *   files table                     - Current file metadata
 *   file_versions table             - All versions with hash references
 */

import { supabase } from './supabase'

const BUCKET_NAME = 'vault'

// Hash a file using SHA-256
export async function hashFile(file: File | Blob | ArrayBuffer): Promise<string> {
  let buffer: ArrayBuffer
  
  if (file instanceof ArrayBuffer) {
    buffer = file
  } else {
    buffer = await file.arrayBuffer()
  }
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Get storage path for a content hash
function getStoragePath(orgId: string, hash: string): string {
  // Store in subdirectories based on first 2 chars of hash (like Git)
  // This prevents having millions of files in one directory
  return `${orgId}/${hash.substring(0, 2)}/${hash}`
}

/**
 * Upload a file to storage
 * Returns the content hash
 */
export async function uploadFile(
  orgId: string,
  fileData: File | Blob | ArrayBuffer,
  onProgress?: (progress: number) => void
): Promise<{ hash: string; size: number; error?: string }> {
  try {
    // Calculate hash
    const hash = await hashFile(fileData)
    const storagePath = getStoragePath(orgId, hash)
    
    // Check if this content already exists (deduplication)
    const { data: existing } = await supabase.storage
      .from(BUCKET_NAME)
      .list(`${orgId}/${hash.substring(0, 2)}`, {
        search: hash
      })
    
    if (existing && existing.length > 0) {
      // File already exists, no need to upload again
      const size = fileData instanceof ArrayBuffer 
        ? fileData.byteLength 
        : (fileData as Blob).size
      return { hash, size }
    }
    
    // Convert to Blob if needed
    let blob: Blob
    if (fileData instanceof ArrayBuffer) {
      blob = new Blob([fileData])
    } else if (fileData instanceof File) {
      blob = fileData
    } else {
      blob = fileData
    }
    
    // Upload to storage
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, blob, {
        cacheControl: '31536000', // Cache for 1 year (content-addressed = immutable)
        upsert: false // Don't overwrite (shouldn't happen with content-addressing)
      })
    
    if (error) {
      // Ignore "already exists" errors (race condition)
      if (!error.message.includes('already exists')) {
        return { hash: '', size: 0, error: error.message }
      }
    }
    
    return { hash, size: blob.size }
  } catch (err) {
    return { hash: '', size: 0, error: String(err) }
  }
}

/**
 * Download a file from storage by hash
 */
export async function downloadFile(
  orgId: string,
  hash: string
): Promise<{ data: Blob | null; error?: string }> {
  try {
    const storagePath = getStoragePath(orgId, hash)
    
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(storagePath)
    
    if (error) {
      return { data: null, error: error.message }
    }
    
    return { data }
  } catch (err) {
    return { data: null, error: String(err) }
  }
}

/**
 * Get a signed URL for direct download (faster for large files)
 */
export async function getDownloadUrl(
  orgId: string,
  hash: string,
  expiresInSeconds: number = 3600
): Promise<{ url: string | null; error?: string }> {
  try {
    const storagePath = getStoragePath(orgId, hash)
    
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(storagePath, expiresInSeconds)
    
    if (error) {
      return { url: null, error: error.message }
    }
    
    return { url: data.signedUrl }
  } catch (err) {
    return { url: null, error: String(err) }
  }
}

/**
 * Check if a file exists in storage
 */
export async function fileExists(orgId: string, hash: string): Promise<boolean> {
  const storagePath = getStoragePath(orgId, hash)
  const dir = `${orgId}/${hash.substring(0, 2)}`
  
  const { data } = await supabase.storage
    .from(BUCKET_NAME)
    .list(dir, { search: hash })
  
  return data !== null && data.length > 0
}

/**
 * Delete a file from storage (admin only, use with caution)
 * Only delete if no file_versions reference this hash
 */
export async function deleteFile(
  orgId: string,
  hash: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const storagePath = getStoragePath(orgId, hash)
    
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([storagePath])
    
    if (error) {
      return { success: false, error: error.message }
    }
    
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

/**
 * Get storage usage for an organization
 */
export async function getStorageUsage(orgId: string): Promise<{
  totalBytes: number
  fileCount: number
  error?: string
}> {
  try {
    // List all files in org's storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(orgId, {
        limit: 10000,
        sortBy: { column: 'created_at', order: 'desc' }
      })
    
    if (error) {
      return { totalBytes: 0, fileCount: 0, error: error.message }
    }
    
    // This only lists directories at first level, need to go deeper
    // For accurate count, query the database instead
    const { data: dbData, error: dbError } = await supabase
      .from('file_versions')
      .select('file_size')
      .eq('org_id', orgId)
    
    if (dbError) {
      return { totalBytes: 0, fileCount: 0, error: dbError.message }
    }
    
    const totalBytes = dbData?.reduce((sum, v) => sum + (v.file_size || 0), 0) || 0
    const fileCount = dbData?.length || 0
    
    return { totalBytes, fileCount }
  } catch (err) {
    return { totalBytes: 0, fileCount: 0, error: String(err) }
  }
}

