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
  authLog,
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
  setCurrentAccessToken,
} from './auth'

// ============================================
// Organization exports
// ============================================
export {
  getUserProfile,
  getOrganization,
  getOrgAuthProviders,
  linkUserToOrganization,
  getOrgUsers,
} from './organizations'

export type { AuthProviders } from './organizations'

// ============================================
// Item Definition (Item Browser) exports
// ============================================
export {
  getItemDefinitionSettings,
  updateItemDefinitionSettings,
  getOrgWorkflowStages,
} from './itemDefinition'

export {
  getItemImages,
  uploadItemImage,
  setItemIcon,
  resetItemImage,
} from './itemImages'

export {
  getItemDesignations,
  upsertItemDesignation,
  deleteItemDesignation,
  getItemDesignationAssignments,
  setItemDesignationAssignment,
} from './itemDesignations'

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
  getContainsRecursive,
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
  upsertFileReferences,
  updateConfigurationRevision,
  propagateDrawingRevisionToConfigurations,
  softDeleteFile,
  softDeleteFiles,
  restoreFile,
  restoreFiles,
  permanentlyDeleteFile,
  permanentlyDeleteFiles,
  getDeletedFiles,
  getDeletedFilesCount,
  emptyTrash,
  rollbackToVersion,
  transitionFileState,
  updateVersionNote,
  getFileReferenceDiagnostics,
  getVaultFilesForDiagnostics,
  // Inspection table operations
  getInspectionRows,
  getInspectionRowsForVersion,
  saveInspectionRows,
  getInspectionMethods,
  addInspectionMethod,
  updateInspectionMethod,
  deleteInspectionMethod,
  // Folder operations
  syncFolder,
  getVaultFolders,
  updateFolderServerPath,
  deleteFolderOnServer,
  deleteFolderByPath,
} from './files'

export type {
  SWReference,
  UpsertReferencesResult,
  BomTreeNode,
  FileReferenceDiagnostic,
  VaultFileSummary,
  FolderRecord,
  InspectionRowValues,
  InspectionRowInput,
  InspectionMethodOption,
} from './files'

// ============================================
// Team exports
// ============================================
export {
  updateUserRole,
  removeUserFromOrg,
  addUserToOrg,
  getUserTeams,
  getUserWorkflowRoles,
  getUserPermissions,
  loadImpersonatedUserContext,
  checkPermission,
  checkPermissions,
  getOrgTeams,
  getTeamReviewers,
  addTeamReviewer,
  removeTeamReviewer,
} from './teams'

export type { TeamReviewerRow } from './teams'

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
  getAccessibleVaults,
} from './vaults'

// ============================================
// Activity exports
// ============================================
export { getRecentActivity, getFileActivity } from './activity'

// ============================================
// Review exports
// ============================================
export {
  createReviewRequest,
  getMyReviews,
  getPendingReviewsForUser,
  respondToReview,
  cancelReview,
  checkReviewTrigger,
  getOrgTeamsWithMembers,
  resolveTeamReviewers,
} from './reviews'

export type { TeamMember, TeamWithMembers, TeamReviewerConfig } from './reviews'

// ============================================
// File Watcher exports
// ============================================
export {
  getCheckedOutByUser,
  watchFile,
  unwatchFile,
  isWatchingFile,
  getWatchedFiles,
} from './fileWatchers'

// ============================================
// Share Link exports
// ============================================
export { createShareLink } from './shareLinks'

export type { ShareLinkOptions } from './shareLinks'

// ============================================
// ECO Helper exports
// ============================================
export { getActiveECOs, addFileToECO, removeFileFromECO, getFileECOs } from './ecoHelpers'

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
  updateLastOnline,
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
  useAdminRecoveryCode,
} from './recovery'

export type { AdminRecoveryCode } from './recovery'

// ============================================
// Part Supplier (Vendor) exports
// ============================================
export {
  getPartSuppliers,
  addPartSupplier,
  updatePartSupplier,
  setPreferredPartSupplier,
  removePartSupplier,
  deletePartSupplier,
} from './partSuppliers'

// ============================================
// Annotation exports
// ============================================
export {
  getFileAnnotations,
  getAnnotationCount,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  resolveAnnotation,
  unresolveAnnotation,
} from './annotations'

export type { CreateAnnotationParams } from './annotations'
