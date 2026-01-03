// @ts-nocheck - Supabase type inference issues
// Barrel export file - re-exports everything for backward compatibility
// All imports from '../lib/supabase' will continue to work unchanged

// ============================================
// Client exports
// ============================================
export { 
  supabase,
  getSupabaseClient,
  isSupabaseConfigured,
  getCurrentConfig,
  reconfigureSupabase,
  authLog
} from './client'

// ============================================
// Auth exports
// ============================================
export {
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  signInWithPhone,
  verifyPhoneOTP,
  checkIfSupplierAccount,
  getSupplierContact,
  signOut,
  getCurrentUser,
  getCurrentSession,
  getCurrentUserEmail,
  clearCachedUserEmail,
  setCurrentAccessToken
} from './auth'

// ============================================
// Organization exports
// ============================================
export {
  getUserProfile,
  getOrganization,
  getOrgAuthProviders,
  linkUserToOrganization,
  getOrgUsers
} from './organizations'

export type { AuthProviders } from './organizations'

// ============================================
// File exports
// ============================================
export {
  getFiles,
  getFilesLightweight,
  getCheckedOutUsers,
  getUserBasicInfo,
  getFile,
  getFileByPath,
  getFileVersions,
  getWhereUsed,
  getContains,
  getMyCheckedOutFiles,
  getAllCheckedOutFiles,
  syncFile,
  checkoutFile,
  checkinFile,
  syncSolidWorksFileMetadata,
  undoCheckout,
  adminForceDiscardCheckout,
  updateFileMetadata,
  updateFilePath,
  updateFolderPath,
  softDeleteFile,
  softDeleteFiles,
  restoreFile,
  restoreFiles,
  permanentlyDeleteFile,
  getDeletedFiles,
  getDeletedFilesCount,
  emptyTrash
} from './files'

// ============================================
// Team exports
// ============================================
export {
  updateUserRole,
  removeUserFromOrg,
  addUserToOrg,
  getUserTeams,
  getUserPermissions,
  loadImpersonatedUserContext,
  checkPermission,
  checkPermissions,
  getOrgTeams
} from './teams'

// ============================================
// Vault exports
// ============================================
export {
  getUserVaultAccess,
  getOrgVaultAccess,
  grantVaultAccess,
  revokeVaultAccess,
  setUserVaultAccess,
  checkVaultAccess,
  getEffectiveUserVaultAccess,
  getAccessibleVaults
} from './vaults'

// ============================================
// Activity exports
// ============================================
export { 
  getRecentActivity,
  getFileActivity 
} from './activity'

// ============================================
// Notification exports
// ============================================
export {
  // Reviews
  createReviewRequest,
  getMyReviews,
  getPendingReviewsForUser,
  respondToReview,
  cancelReview,
  // Notifications
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  markAllNotificationsRead,
  deleteNotification,
  clearAllNotifications,
  requestCheckout,
  createCustomNotification,
  sendFileNotification,
  getCheckedOutByUser,
  // File Watchers
  watchFile,
  unwatchFile,
  isWatchingFile,
  getWatchedFiles,
  // Share Links
  createShareLink,
  getFileShareLinks,
  revokeShareLink,
  validateShareLink,
  // ECOs
  getActiveECOs,
  addFileToECO,
  removeFileFromECO,
  getFileECOs
} from './notifications'

export type { ShareLinkOptions } from './notifications'

// ============================================
// Session exports
// ============================================
export {
  registerDeviceSession,
  syncUserSessionsOrgId,
  ensureUserOrgId,
  sendSessionHeartbeat,
  startSessionHeartbeat,
  stopSessionHeartbeat,
  endDeviceSession,
  endRemoteSession,
  getActiveSessions,
  isMachineOnline,
  subscribeToSessions,
  getOrgOnlineUsers,
  subscribeToOrgOnlineUsers,
  updateLastOnline
} from './sessions'

export type { UserSession, OnlineUser } from './sessions'

// ============================================
// Recovery exports
// ============================================
export {
  generateAdminRecoveryCode,
  listAdminRecoveryCodes,
  revokeAdminRecoveryCode,
  deleteAdminRecoveryCode,
  useAdminRecoveryCode
} from './recovery'

export type { AdminRecoveryCode } from './recovery'
