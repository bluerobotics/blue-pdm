// Query functions - read operations
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
  getDrawingsForFileConfig,
  getMyCheckedOutFiles,
  getAllCheckedOutFiles,
  getFileReferenceDiagnostics,
  getVaultFilesForDiagnostics,
} from './queries'

// Export types for recursive BOM queries, drawing refs, and diagnostics
export type {
  BomTreeNode,
  DrawingRefItem,
  FileReferenceDiagnostic,
  VaultFileSummary,
} from './queries'

// Checkout functions - check out/in operations
export {
  checkoutFile,
  checkinFile,
  syncSolidWorksFileMetadata,
  undoCheckout,
  adminForceDiscardCheckout,
} from './checkout'

// Mutation functions - sync and metadata updates
export {
  syncFile,
  updateFileMetadata,
  updateFilePath,
  updateFolderPath,
  upsertFileReferences,
  updateConfigurationRevision,
  propagateDrawingRevisionToConfigurations,
} from './mutations'

// Export types for file references
export type { SWReference, UpsertReferencesResult, SkippedReferenceReason } from './mutations'

// Trash functions - soft delete, restore, permanent delete
export {
  softDeleteFile,
  softDeleteFiles,
  restoreFile,
  restoreFiles,
  permanentlyDeleteFile,
  permanentlyDeleteFiles,
  getDeletedFiles,
  getDeletedFilesCount,
  emptyTrash,
} from './trash'

// Version functions - rollback, state transitions, notes
export { rollbackToVersion, transitionFileState, updateVersionNote } from './versions'

// Inspection table functions - drawing inspection characteristics + version snapshots
export {
  getInspectionRows,
  getInspectionRowsForVersion,
  saveInspectionRows,
  getInspectionMethods,
  addInspectionMethod,
  updateInspectionMethod,
  deleteInspectionMethod,
} from './inspection'

export type { InspectionRowValues, InspectionRowInput, InspectionMethodOption } from './inspection'

// Move functions - atomic file move operations
export { moveFileOnServer, moveFilesOnServer } from './move'

// Folder functions - sync empty folders to server
export {
  syncFolder,
  getVaultFolders,
  updateFolderServerPath,
  deleteFolderOnServer,
  deleteFolderByPath,
} from './folders'

export type { FolderRecord } from './folders'
