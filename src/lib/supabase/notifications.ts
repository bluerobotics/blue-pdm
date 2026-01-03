// @ts-nocheck - Supabase type inference with Database generics has known issues in v2.x
import { getSupabaseClient } from './client'
import type { Review, ReviewResponse, Notification, ReviewStatus } from '../../types/database'

// ============================================
// Reviews
// ============================================

/**
 * Create a review request for a file
 */
export async function createReviewRequest(
  orgId: string,
  fileId: string,
  vaultId: string | null,
  requestedBy: string,
  reviewerIds: string[],
  fileVersion: number,
  title?: string,
  message?: string,
  dueDate?: string,
  priority?: 'low' | 'normal' | 'high' | 'urgent'
): Promise<{ review: Review | null; error?: string }> {
  const client = getSupabaseClient()
  
  // Create the review
  const { data: review, error: reviewError } = await client
    .from('reviews')
    .insert({
      org_id: orgId,
      file_id: fileId,
      vault_id: vaultId,
      requested_by: requestedBy,
      title: title || null,
      due_date: dueDate || null,
      priority: priority || 'normal',
      message: message || null,
      file_version: fileVersion,
      status: 'pending'
    })
    .select()
    .single()
  
  if (reviewError) {
    return { review: null, error: reviewError.message }
  }
  
  // Get file info and requester info for notifications
  const { data: fileData } = await client
    .from('files')
    .select('file_name')
    .eq('id', fileId)
    .single()
  
  const { data: requesterData } = await client
    .from('users')
    .select('full_name, email')
    .eq('id', requestedBy)
    .single()
  
  const requesterName = requesterData?.full_name || requesterData?.email || 'Someone'
  const fileName = fileData?.file_name || 'a file'
  
  // Create review_responses for each reviewer
  const responses = reviewerIds.map(reviewerId => ({
    review_id: review.id,
    reviewer_id: reviewerId,
    status: 'pending' as ReviewStatus
  }))
  
  await client.from('review_responses').insert(responses)
  
  // Create notifications for each reviewer
  const notifications = reviewerIds.map(reviewerId => ({
    org_id: orgId,
    user_id: reviewerId,
    type: 'review_request',
    title: title || `Review Requested: ${fileName}`,
    message: message || `${requesterName} requested your review`,
    file_id: fileId,
    review_id: review.id,
    from_user_id: requestedBy,
    priority: priority || 'normal'
  }))
  
  await client.from('notifications').insert(notifications)
  
  return { review: review as Review }
}

/**
 * Get reviews requested by a user
 */
export async function getMyReviews(
  userId: string,
  orgId?: string,  // Optional for backward compatibility
  options?: {
    status?: ReviewStatus[]
    limit?: number
    asRequester?: boolean
    asReviewer?: boolean
  }
): Promise<{ reviews: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  let query = client
    .from('reviews')
    .select(`
      *,
      file:files(id, file_name, file_path, version),
      requester:users!requested_by(email, full_name, avatar_url),
      responses:review_responses(
        id,
        status,
        comment,
        responded_at,
        reviewer:users!reviewer_id(id, email, full_name, avatar_url)
      )
    `)
    .eq('requested_by', userId)
    .order('created_at', { ascending: false })
  
  if (options?.status && options.status.length > 0) {
    query = query.in('status', options.status)
  }
  
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  
  const { data, error } = await query
  
  if (error) {
    return { reviews: [], error: error.message }
  }
  
  return { reviews: data || [] }
}

/**
 * Get pending reviews for a user (reviews they need to respond to)
 */
export async function getPendingReviewsForUser(
  userId: string,
  orgId?: string  // Optional for backward compatibility
): Promise<{ reviews: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  // Get pending review responses for this user
  const { data, error } = await client
    .from('review_responses')
    .select(`
      id,
      status,
      review:reviews!inner(
        id,
        title,
        message,
        priority,
        due_date,
        file_version,
        created_at,
        file:files(id, file_name, file_path),
        requester:users!requested_by(email, full_name, avatar_url)
      )
    `)
    .eq('reviewer_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  
  if (error) {
    return { reviews: [], error: error.message }
  }
  
  return { reviews: data || [] }
}

/**
 * Respond to a review request
 */
export async function respondToReview(
  reviewResponseId: string,
  reviewerId: string,
  status: 'approved' | 'rejected' | 'changes_requested',
  comment?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Update the response
  const { data: response, error: updateError } = await client
    .from('review_responses')
    .update({
      status,
      comment: comment || null,
      responded_at: new Date().toISOString()
    })
    .eq('id', reviewResponseId)
    .eq('reviewer_id', reviewerId)
    .select('review_id')
    .single()
  
  if (updateError) {
    return { success: false, error: updateError.message }
  }
  
  // Check if all reviewers have responded
  if (response?.review_id) {
    const reviewId = response.review_id
    
    const { data: allResponses, error: responsesError } = await client
      .from('review_responses')
      .select('status')
      .eq('review_id', reviewId)
    
    if (!responsesError && allResponses) {
      const allResponded = allResponses.every(r => r.status !== 'pending')
      
      if (allResponded) {
        const anyRejected = allResponses.some(r => r.status === 'rejected')
        
        // Update review status
        await client
          .from('reviews')
          .update({
            status: anyRejected ? 'rejected' : 'approved',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', reviewId)
      }
    }
  }
  
  return { success: true }
}

/**
 * Cancel a review request
 */
export async function cancelReview(
  reviewId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Verify user is the requester
  const { data: review, error: fetchError } = await client
    .from('reviews')
    .select('requested_by')
    .eq('id', reviewId)
    .single()
  
  if (fetchError || !review) {
    return { success: false, error: 'Review not found' }
  }
  
  if (review.requested_by !== userId) {
    return { success: false, error: 'Only the requester can cancel a review' }
  }
  
  const { error } = await client
    .from('reviews')
    .update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', reviewId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

// ============================================
// Notifications
// ============================================

/**
 * Get notifications for a user
 */
export async function getNotifications(
  userId: string,
  options?: {
    unreadOnly?: boolean
    limit?: number
  }
): Promise<{ notifications: Notification[]; error?: string }> {
  const client = getSupabaseClient()
  
  let query = client
    .from('notifications')
    .select(`
      *,
      from_user:users!from_user_id(email, full_name, avatar_url),
      file:files(file_name, file_path)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  
  if (options?.unreadOnly) {
    query = query.eq('read', false)
  }
  
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  
  const { data, error } = await query
  
  if (error) {
    return { notifications: [], error: error.message }
  }
  
  return { notifications: (data as unknown as Notification[]) || [] }
}

/**
 * Get unread notification count
 */
export async function getUnreadNotificationCount(
  userId: string
): Promise<{ count: number; error?: string }> {
  const client = getSupabaseClient()
  
  const { count, error } = await client
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false)
  
  if (error) {
    return { count: 0, error: error.message }
  }
  
  return { count: count || 0 }
}

/**
 * Mark notifications as read
 */
export async function markNotificationsRead(
  notificationIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('notifications')
    .update({
      read: true,
      read_at: new Date().toISOString()
    })
    .in('id', notificationIds)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsRead(
  userId: string
): Promise<{ success: boolean; updated: number; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('notifications')
    .update({
      read: true,
      read_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .eq('read', false)
    .select('id')
  
  if (error) {
    return { success: false, updated: 0, error: error.message }
  }
  
  return { success: true, updated: data?.length || 0 }
}

/**
 * Delete a notification
 */
export async function deleteNotification(
  notificationId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('notifications')
    .delete()
    .eq('id', notificationId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Clear all notifications for a user
 */
export async function clearAllNotifications(
  userId: string
): Promise<{ success: boolean; deleted: number; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('notifications')
    .delete()
    .eq('user_id', userId)
    .select('id')
  
  if (error) {
    return { success: false, deleted: 0, error: error.message }
  }
  
  return { success: true, deleted: data?.length || 0 }
}

/**
 * Request checkout from someone who has a file checked out
 * Sends a notification to the person who has the file
 */
export async function requestCheckout(
  orgId: string,
  fileId: string,
  fileName: string,
  requesterId: string,
  checkedOutById: string,
  message?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Get requester name
  const { data: requesterData } = await client
    .from('users')
    .select('full_name, email')
    .eq('id', requesterId)
    .single()
  
  const requesterName = requesterData?.full_name || requesterData?.email || 'Someone'
  
  // Create notification for the person who has the file checked out
  const { error } = await client
    .from('notifications')
    .insert({
      org_id: orgId,
      user_id: checkedOutById,
      type: 'checkout_request',
      title: `Checkout Requested: ${fileName}`,
      message: `${requesterName} is waiting for this file${message ? ': ' + message : ''}`,
      file_id: fileId,
      from_user_id: requesterId
    })
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Create a custom notification to one or more users
 */
export async function createCustomNotification(
  orgId: string,
  fromUserId: string,
  toUserIds: string[],
  options: {
    type: string  // notification type
    category: 'review' | 'change' | 'purchasing' | 'quality' | 'workflow' | 'system'
    title: string
    message?: string
    priority?: 'low' | 'normal' | 'high' | 'urgent'
    actionType?: 'approve' | 'reject' | 'view' | 'respond'
    actionUrl?: string
    fileId?: string
    ecoId?: string
    poId?: string
  }
): Promise<{ success: boolean; count: number; error?: string }> {
  const client = getSupabaseClient()
  
  // Create notification for each recipient
  const notifications = toUserIds.map(userId => ({
    org_id: orgId,
    user_id: userId,
    type: options.type,
    category: options.category,
    title: options.title,
    message: options.message || null,
    priority: options.priority || 'normal',
    from_user_id: fromUserId,
    action_type: options.actionType || null,
    action_url: options.actionUrl || null,
    file_id: options.fileId || null,
    eco_id: options.ecoId || null,
    po_id: options.poId || null,
    read: false,
    action_completed: false
  }))
  
  const { data, error } = await client
    .from('notifications')
    .insert(notifications)
    .select()
  
  if (error) {
    return { success: false, count: 0, error: error.message }
  }
  
  return { success: true, count: data?.length || 0 }
}

/**
 * Send a generic file notification to a user
 */
export async function sendFileNotification(
  orgId: string,
  fileId: string,
  fileName: string,
  toUserId: string,
  fromUserId: string,
  type: 'mention' | 'file_updated' | 'checkout_request',
  message?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Get sender name
  const { data: senderData } = await client
    .from('users')
    .select('full_name, email')
    .eq('id', fromUserId)
    .single()
  
  const senderName = senderData?.full_name || senderData?.email || 'Someone'
  
  const titles: Record<string, string> = {
    'mention': `${senderName} mentioned you`,
    'file_updated': `File Updated: ${fileName}`,
    'checkout_request': `Checkout Requested: ${fileName}`
  }
  
  const { error } = await client
    .from('notifications')
    .insert({
      org_id: orgId,
      user_id: toUserId,
      type,
      title: titles[type] || `Notification: ${fileName}`,
      message: message || `${senderName} mentioned you regarding ${fileName}`,
      file_id: fileId,
      from_user_id: fromUserId
    })
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Get the user who has a file checked out (with their info)
 */
export async function getCheckedOutByUser(
  fileId: string
): Promise<{ user: { id: string; email: string; full_name: string | null; avatar_url: string | null } | null; error?: string }> {
  const client = getSupabaseClient()
  
  // First get the file's checked_out_by
  const { data: file, error: fileError } = await client
    .from('files')
    .select('checked_out_by')
    .eq('id', fileId)
    .single()
  
  if (fileError) {
    return { user: null, error: fileError.message }
  }
  
  if (!file?.checked_out_by) {
    return { user: null }
  }
  
  // Then get the user info
  const { data: user, error: userError } = await client
    .from('users')
    .select('id, email, full_name, avatar_url')
    .eq('id', file.checked_out_by)
    .single()
  
  if (userError) {
    return { user: null, error: userError.message }
  }
  
  return { user }
}

// ============================================
// File Watchers (Watch/Subscribe to files)
// ============================================

/**
 * Watch a file to get notified of changes
 */
export async function watchFile(
  orgId: string,
  fileId: string,
  userId: string,
  options?: {
    notifyOnCheckin?: boolean
    notifyOnCheckout?: boolean
    notifyOnStateChange?: boolean
    notifyOnReview?: boolean
  }
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('file_watchers')
    .upsert({
      org_id: orgId,
      file_id: fileId,
      user_id: userId,
      notify_on_checkin: options?.notifyOnCheckin ?? true,
      notify_on_checkout: options?.notifyOnCheckout ?? false,
      notify_on_state_change: options?.notifyOnStateChange ?? true,
      notify_on_review: options?.notifyOnReview ?? true
    }, {
      onConflict: 'file_id,user_id'
    })
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Stop watching a file
 */
export async function unwatchFile(
  fileId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('file_watchers')
    .delete()
    .eq('file_id', fileId)
    .eq('user_id', userId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Check if user is watching a file
 */
export async function isWatchingFile(
  fileId: string,
  userId: string
): Promise<{ watching: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('file_watchers')
    .select('id')
    .eq('file_id', fileId)
    .eq('user_id', userId)
    .maybeSingle()
  
  if (error) {
    return { watching: false, error: error.message }
  }
  
  return { watching: !!data }
}

/**
 * Get all files a user is watching
 */
export async function getWatchedFiles(
  userId: string
): Promise<{ files: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('file_watchers')
    .select(`
      *,
      file:files(id, file_name, file_path, state, version)
    `)
    .eq('user_id', userId)
  
  if (error) {
    return { files: [], error: error.message }
  }
  
  return { files: data || [] }
}

// ============================================
// File Share Links
// ============================================

export interface ShareLinkOptions {
  expiresInDays?: number
  maxDownloads?: number
  requireAuth?: boolean
}

function generateToken(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Create a shareable link for a file - generates actual signed URL from Supabase Storage
 */
export async function createShareLink(
  orgId: string,
  fileId: string,
  createdBy: string,
  options?: ShareLinkOptions
): Promise<{ link: { id: string; token: string; expiresAt: string | null; downloadUrl: string } | null; error?: string }> {
  const client = getSupabaseClient()
  
  // First, get the file info to find the content hash
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
  
  // Calculate expiration in seconds for signed URL (default 7 days, max 1 year)
  const expiresInSeconds = options?.expiresInDays 
    ? Math.min(options.expiresInDays * 24 * 60 * 60, 365 * 24 * 60 * 60)
    : 7 * 24 * 60 * 60 // Default 7 days
  
  // Build storage path: {orgId}/{hash[0:2]}/{hash}
  const storagePath = `${fileData.org_id}/${fileData.content_hash.substring(0, 2)}/${fileData.content_hash}`
  
  // Generate signed URL from Supabase Storage
  const { data: signedUrlData, error: signedUrlError } = await client.storage
    .from('vault')
    .createSignedUrl(storagePath, expiresInSeconds, {
      download: fileData.file_name // Sets Content-Disposition header with filename
    })
  
  if (signedUrlError || !signedUrlData?.signedUrl) {
    return { link: null, error: signedUrlError?.message || 'Failed to generate download URL' }
  }
  
  // Generate a token for tracking (optional - for our database)
  const token = generateToken(12)
  
  // Calculate expiration date
  let expiresAt: string | null = null
  if (options?.expiresInDays) {
    const date = new Date()
    date.setDate(date.getDate() + options.expiresInDays)
    expiresAt = date.toISOString()
  } else {
    // Default 7 days
    const date = new Date()
    date.setDate(date.getDate() + 7)
    expiresAt = date.toISOString()
  }
  
  // Optionally store link metadata in database for tracking
  // This is useful for download counting, revocation, etc.
  try {
    await client
      .from('file_share_links')
      .insert({
        org_id: orgId,
        file_id: fileId,
        token,
        created_by: createdBy,
        expires_at: expiresAt,
        max_downloads: options?.maxDownloads || null,
        require_auth: options?.requireAuth || false
      })
  } catch {
    // Don't fail if we can't track it - the signed URL still works
  }
  
  return { 
    link: { 
      id: token, 
      token, 
      expiresAt,
      downloadUrl: signedUrlData.signedUrl
    } 
  }
}

/**
 * Get share links for a file
 */
export async function getFileShareLinks(
  fileId: string
): Promise<{ links: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('file_share_links')
    .select(`
      *,
      created_by_user:users!created_by(email, full_name)
    `)
    .eq('file_id', fileId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  
  if (error) {
    return { links: [], error: error.message }
  }
  
  return { links: data || [] }
}

/**
 * Revoke/deactivate a share link
 */
export async function revokeShareLink(
  linkId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('file_share_links')
    .update({ is_active: false })
    .eq('id', linkId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Validate a share link token (for public access)
 */
export async function validateShareLink(
  token: string
): Promise<{ 
  valid: boolean
  fileId?: string
  orgId?: string
  requireAuth?: boolean
  error?: string 
}> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('file_share_links')
    .select('*')
    .eq('token', token)
    .eq('is_active', true)
    .single()
  
  if (error || !data) {
    return { valid: false, error: 'Link not found or invalid' }
  }
  
  // Check expiration
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { valid: false, error: 'Link has expired' }
  }
  
  // Check download limit
  if (data.max_downloads && data.download_count >= data.max_downloads) {
    return { valid: false, error: 'Download limit reached' }
  }
  
  return { 
    valid: true, 
    fileId: data.file_id, 
    orgId: data.org_id,
    requireAuth: data.require_auth
  }
}

// ============================================
// ECO Management (Add file to ECO)
// ============================================

/**
 * Get active ECOs for an organization (for selection)
 */
export async function getActiveECOs(
  orgId: string
): Promise<{ ecos: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('ecos')
    .select(`
      id,
      eco_number,
      title,
      status,
      created_at
    `)
    .eq('org_id', orgId)
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false })
  
  if (error) {
    return { ecos: [], error: error.message }
  }
  
  return { ecos: data || [] }
}

/**
 * Add a file to an ECO
 */
export async function addFileToECO(
  fileId: string,
  ecoId: string,
  userId: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('file_ecos')
    .insert({
      file_id: fileId,
      eco_id: ecoId,
      created_by: userId,
      notes: notes || null
    })
  
  if (error) {
    // Check for duplicate
    if (error.code === '23505') {
      return { success: false, error: 'File is already part of this ECO' }
    }
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Remove a file from an ECO
 */
export async function removeFileFromECO(
  fileId: string,
  ecoId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('file_ecos')
    .delete()
    .eq('file_id', fileId)
    .eq('eco_id', ecoId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Get ECOs that a file belongs to
 */
export async function getFileECOs(
  fileId: string
): Promise<{ ecos: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('file_ecos')
    .select(`
      id,
      notes,
      created_at,
      eco:ecos(id, eco_number, title, status)
    `)
    .eq('file_id', fileId)
  
  if (error) {
    return { ecos: [], error: error.message }
  }
  
  return { ecos: data || [] }
}
