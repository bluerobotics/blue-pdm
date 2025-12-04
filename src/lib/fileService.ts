/**
 * Blue PDM File Service
 * 
 * High-level file operations combining Supabase database + storage.
 * Handles versioning, check-in/check-out, conflict detection.
 */

import { supabase } from './supabase'
import { uploadFile, downloadFile, getDownloadUrl } from './storage'
import { getNextRevision, getFileType } from '../types/pdm'
import type { PDMFile, FileState, FileVersion } from '../types/pdm'

/**
 * Check out a file for editing
 * Creates an exclusive lock so no one else can edit
 */
export async function checkoutFile(
  fileId: string,
  userId: string,
  message?: string
): Promise<{ success: boolean; file?: PDMFile; error?: string }> {
  // First, check current lock status
  const { data: file, error: fetchError } = await supabase
    .from('files')
    .select('*')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  // Check if already checked out by someone else
  if (file.checked_out_by && file.checked_out_by !== userId) {
    const { data: lockUser } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('id', file.checked_out_by)
      .single()
    
    return { 
      success: false, 
      error: `File is checked out by ${lockUser?.full_name || lockUser?.email || 'another user'} since ${new Date(file.checked_out_at).toLocaleString()}`
    }
  }
  
  // Acquire the lock
  const { data: updated, error: updateError } = await supabase
    .from('files')
    .update({
      checked_out_by: userId,
      checked_out_at: new Date().toISOString(),
      lock_message: message || null
    })
    .eq('id', fileId)
    .eq('checked_out_by', file.checked_out_by) // Optimistic lock
    .select()
    .single()
  
  if (updateError) {
    return { success: false, error: updateError.message }
  }
  
  if (!updated) {
    return { success: false, error: 'File was checked out by someone else. Please refresh.' }
  }
  
  return { success: true, file: updated }
}

/**
 * Check in a file after editing
 * Uploads new version and releases lock
 */
export async function checkinFile(
  fileId: string,
  userId: string,
  fileData: File | Blob | ArrayBuffer,
  options: {
    comment?: string
    incrementRevision?: boolean
    newState?: FileState
  } = {}
): Promise<{ success: boolean; file?: PDMFile; version?: FileVersion; error?: string }> {
  // Get current file info
  const { data: file, error: fetchError } = await supabase
    .from('files')
    .select('*')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  // Verify user has the lock
  if (file.checked_out_by !== userId) {
    return { success: false, error: 'You do not have this file checked out' }
  }
  
  // Upload file content
  const { hash, size, error: uploadError } = await uploadFile(file.org_id, fileData)
  
  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError}` }
  }
  
  // Calculate new version/revision
  const newVersion = file.version + 1
  const newRevision = options.incrementRevision 
    ? getNextRevision(file.revision, 'letter')
    : file.revision
  
  // Create version record
  const { data: versionRecord, error: versionError } = await supabase
    .from('file_versions')
    .insert({
      file_id: fileId,
      version: newVersion,
      revision: newRevision,
      content_hash: hash,
      file_size: size,
      comment: options.comment || null,
      state: options.newState || file.state,
      created_by: userId
    })
    .select()
    .single()
  
  if (versionError) {
    return { success: false, error: versionError.message }
  }
  
  // Update file record
  const { data: updated, error: updateError } = await supabase
    .from('files')
    .update({
      version: newVersion,
      revision: newRevision,
      content_hash: hash,
      file_size: size,
      state: options.newState || file.state,
      state_changed_at: options.newState ? new Date().toISOString() : file.state_changed_at,
      state_changed_by: options.newState ? userId : file.state_changed_by,
      checked_out_by: null,
      checked_out_at: null,
      lock_message: null,
      updated_at: new Date().toISOString(),
      updated_by: userId
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (updateError) {
    return { success: false, error: updateError.message }
  }
  
  return { success: true, file: updated, version: versionRecord }
}

/**
 * Undo checkout (discard changes, release lock)
 */
export async function undoCheckout(
  fileId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('files')
    .update({
      checked_out_by: null,
      checked_out_at: null,
      lock_message: null
    })
    .eq('id', fileId)
    .eq('checked_out_by', userId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Force unlock a file (admin only)
 */
export async function forceUnlock(
  fileId: string,
  adminUserId: string
): Promise<{ success: boolean; error?: string }> {
  // Verify user is admin
  const { data: user } = await supabase
    .from('users')
    .select('role')
    .eq('id', adminUserId)
    .single()
  
  if (user?.role !== 'admin') {
    return { success: false, error: 'Only admins can force unlock files' }
  }
  
  const { error } = await supabase
    .from('files')
    .update({
      checked_out_by: null,
      checked_out_at: null,
      lock_message: null
    })
    .eq('id', fileId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Add a new file to the vault
 */
export async function addFile(
  orgId: string,
  userId: string,
  filePath: string,
  fileData: File | Blob | ArrayBuffer,
  metadata: {
    partNumber?: string
    description?: string
    customProperties?: Record<string, string | number | null>
  } = {}
): Promise<{ success: boolean; file?: PDMFile; error?: string }> {
  // Get filename and extension
  const fileName = filePath.split('/').pop() || filePath
  const extension = '.' + fileName.split('.').pop()?.toLowerCase() || ''
  const fileType = getFileType(extension)
  
  // Upload content
  const { hash, size, error: uploadError } = await uploadFile(orgId, fileData)
  
  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError}` }
  }
  
  // Create file record
  const { data: file, error: insertError } = await supabase
    .from('files')
    .insert({
      org_id: orgId,
      file_path: filePath,
      file_name: fileName,
      extension: extension,
      file_type: fileType,
      part_number: metadata.partNumber || null,
      description: metadata.description || null,
      revision: 'A',
      version: 1,
      state: 'wip',
      content_hash: hash,
      file_size: size,
      created_by: userId,
      updated_by: userId,
      custom_properties: metadata.customProperties || {}
    })
    .select()
    .single()
  
  if (insertError) {
    return { success: false, error: insertError.message }
  }
  
  // Create initial version record
  await supabase
    .from('file_versions')
    .insert({
      file_id: file.id,
      version: 1,
      revision: 'A',
      content_hash: hash,
      file_size: size,
      state: 'wip',
      created_by: userId,
      comment: 'Initial version'
    })
  
  return { success: true, file }
}

/**
 * Get a specific version of a file
 */
export async function getFileVersion(
  orgId: string,
  fileId: string,
  version: number
): Promise<{ data: Blob | null; version?: FileVersion; error?: string }> {
  // Get version record
  const { data: versionRecord, error: fetchError } = await supabase
    .from('file_versions')
    .select('*')
    .eq('file_id', fileId)
    .eq('version', version)
    .single()
  
  if (fetchError) {
    return { data: null, error: fetchError.message }
  }
  
  // Download content
  const { data, error: downloadError } = await downloadFile(orgId, versionRecord.content_hash)
  
  if (downloadError) {
    return { data: null, error: downloadError }
  }
  
  return { data, version: versionRecord }
}

/**
 * Get file version history
 */
export async function getFileHistory(
  fileId: string
): Promise<{ versions: FileVersion[]; error?: string }> {
  const { data, error } = await supabase
    .from('file_versions')
    .select('*, created_by_user:users!created_by(email, full_name)')
    .eq('file_id', fileId)
    .order('version', { ascending: false })
  
  if (error) {
    return { versions: [], error: error.message }
  }
  
  return { versions: data || [] }
}

/**
 * Rollback file to a previous version
 * Creates a new version that's a copy of the old one
 */
export async function rollbackToVersion(
  fileId: string,
  userId: string,
  targetVersion: number,
  comment?: string
): Promise<{ success: boolean; file?: PDMFile; error?: string }> {
  // Get current file
  const { data: file, error: fetchError } = await supabase
    .from('files')
    .select('*')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  // File must be checked out by user
  if (file.checked_out_by !== userId) {
    return { success: false, error: 'You must check out the file before rolling back' }
  }
  
  // Get target version
  const { data: targetVersionRecord, error: versionError } = await supabase
    .from('file_versions')
    .select('*')
    .eq('file_id', fileId)
    .eq('version', targetVersion)
    .single()
  
  if (versionError) {
    return { success: false, error: `Version ${targetVersion} not found` }
  }
  
  // Create new version pointing to old content hash
  const newVersion = file.version + 1
  
  const { error: insertError } = await supabase
    .from('file_versions')
    .insert({
      file_id: fileId,
      version: newVersion,
      revision: file.revision,
      content_hash: targetVersionRecord.content_hash,
      file_size: targetVersionRecord.file_size,
      state: file.state,
      created_by: userId,
      comment: comment || `Rolled back to version ${targetVersion}`
    })
  
  if (insertError) {
    return { success: false, error: insertError.message }
  }
  
  // Update file record
  const { data: updated, error: updateError } = await supabase
    .from('files')
    .update({
      version: newVersion,
      content_hash: targetVersionRecord.content_hash,
      file_size: targetVersionRecord.file_size,
      updated_at: new Date().toISOString(),
      updated_by: userId
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (updateError) {
    return { success: false, error: updateError.message }
  }
  
  return { success: true, file: updated }
}

/**
 * Change file state (WIP -> In Review -> Released -> Obsolete)
 */
export async function changeFileState(
  fileId: string,
  userId: string,
  newState: FileState,
  options: {
    incrementRevision?: boolean
    comment?: string
  } = {}
): Promise<{ success: boolean; file?: PDMFile; error?: string }> {
  // Get current file
  const { data: file, error: fetchError } = await supabase
    .from('files')
    .select('*')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  // Validate state transition
  const validTransitions: Record<FileState, FileState[]> = {
    'wip': ['in_review', 'obsolete'],
    'in_review': ['wip', 'released', 'obsolete'],
    'released': ['obsolete', 'wip'], // Can go back to WIP for new revision
    'obsolete': ['wip'] // Can resurrect
  }
  
  if (!validTransitions[file.state]?.includes(newState)) {
    return { 
      success: false, 
      error: `Cannot transition from ${file.state} to ${newState}` 
    }
  }
  
  // If releasing, typically increment revision
  const newRevision = options.incrementRevision 
    ? getNextRevision(file.revision, 'letter')
    : file.revision
  
  const { data: updated, error: updateError } = await supabase
    .from('files')
    .update({
      state: newState,
      state_changed_at: new Date().toISOString(),
      state_changed_by: userId,
      revision: newRevision,
      updated_at: new Date().toISOString(),
      updated_by: userId
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (updateError) {
    return { success: false, error: updateError.message }
  }
  
  return { success: true, file: updated }
}

/**
 * Get where-used (which assemblies use this part)
 */
export async function getWhereUsed(fileId: string): Promise<{
  references: Array<{
    parentFile: PDMFile
    referenceType: string
    quantity: number
  }>
  error?: string
}> {
  const { data, error } = await supabase
    .from('file_references')
    .select('*, parent:files!parent_file_id(*)')
    .eq('child_file_id', fileId)
  
  if (error) {
    return { references: [], error: error.message }
  }
  
  return {
    references: data?.map(r => ({
      parentFile: r.parent,
      referenceType: r.reference_type,
      quantity: r.quantity
    })) || []
  }
}

/**
 * Get contains (BOM - what parts are in this assembly)
 */
export async function getContains(fileId: string): Promise<{
  references: Array<{
    childFile: PDMFile
    referenceType: string
    quantity: number
    configuration?: string
  }>
  error?: string
}> {
  const { data, error } = await supabase
    .from('file_references')
    .select('*, child:files!child_file_id(*)')
    .eq('parent_file_id', fileId)
  
  if (error) {
    return { references: [], error: error.message }
  }
  
  return {
    references: data?.map(r => ({
      childFile: r.child,
      referenceType: r.reference_type,
      quantity: r.quantity,
      configuration: r.configuration
    })) || []
  }
}

