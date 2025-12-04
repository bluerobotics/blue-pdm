// PDM Types for SolidWorks and CAD file management

// File states following engineering lifecycle
export type FileState = 'wip' | 'in_review' | 'released' | 'obsolete'

// Revision follows engineering convention (A, B, C... then AA, AB, etc.)
export type RevisionScheme = 'letter' | 'numeric'

// Supported CAD file types
export const CAD_EXTENSIONS = [
  // SolidWorks
  '.sldprt',   // Parts
  '.sldasm',   // Assemblies  
  '.slddrw',   // Drawings
  '.slddrt',   // Drawing templates
  '.sldlfp',   // Library feature parts
  '.sldblk',   // Blocks
  // Neutral formats
  '.step',
  '.stp',
  '.iges',
  '.igs',
  '.x_t',      // Parasolid
  '.x_b',
  '.sat',      // ACIS
  // Mesh/visualization
  '.stl',
  '.3mf',
  '.obj',
  // Documents
  '.pdf',
  '.dxf',
  '.dwg',
  // Other CAD
  '.catpart',  // CATIA
  '.catproduct',
  '.prt',      // Creo/Pro-E, NX
  '.asm',
  '.ipt',      // Inventor
  '.iam',
] as const

export type CADExtension = typeof CAD_EXTENSIONS[number]

// File metadata stored in Supabase
export interface PDMFile {
  id: string
  org_id: string
  
  // File identity
  file_path: string           // Relative path in vault
  file_name: string           // Display name
  extension: string           // .sldprt, .sldasm, etc.
  file_type: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
  
  // Engineering metadata
  part_number: string | null
  description: string | null
  revision: string            // A, B, C or 01, 02, 03
  version: number             // Auto-incrementing save version
  
  // State management
  state: FileState
  state_changed_at: string
  state_changed_by: string | null
  
  // Lock/checkout
  checked_out_by: string | null
  checked_out_at: string | null
  lock_message: string | null
  
  // Content tracking
  content_hash: string | null  // SHA-256 hash of file content
  file_size: number           // Bytes
  
  // Timestamps
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string | null
  
  // Custom properties (from SolidWorks custom properties)
  custom_properties: Record<string, string | number | null>
}

// Assembly/part relationships for where-used
export interface FileReference {
  id: string
  org_id: string
  parent_file_id: string      // Assembly that uses the part
  child_file_id: string       // Part being used
  reference_type: 'component' | 'drawing_view' | 'derived' | 'copy'
  quantity: number            // How many instances
  configuration: string | null // SolidWorks configuration name
  created_at: string
  updated_at: string
}

// File version history
export interface FileVersion {
  id: string
  file_id: string
  version: number
  revision: string
  git_hash: string
  lfs_oid: string | null
  file_size: number
  comment: string | null
  state: FileState
  created_at: string
  created_by: string
}

// Organization (determined by email domain)
export interface Organization {
  id: string
  name: string                // "Blue Robotics"
  slug: string                // "bluerobotics"
  email_domains: string[]     // ["bluerobotics.com"]
  vault_path: string          // Local path to Git vault
  git_remote_url: string | null
  revision_scheme: RevisionScheme
  settings: OrgSettings
  created_at: string
}

export interface OrgSettings {
  require_checkout: boolean
  auto_increment_part_numbers: boolean
  part_number_prefix: string
  part_number_digits: number
  allowed_extensions: string[]
  require_description: boolean
  require_approval_for_release: boolean
}

// User with org membership
export interface User {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  org_id: string | null
  role: 'admin' | 'engineer' | 'viewer'
  created_at: string
  last_sign_in: string | null
}

// Check-out request/lock
export interface CheckoutLock {
  id: string
  file_id: string
  user_id: string
  user_email: string
  user_name: string | null
  message: string | null
  checked_out_at: string
  expires_at: string | null   // Optional expiry for stale locks
}

// File operation result
export interface FileOperationResult {
  success: boolean
  message: string
  file?: PDMFile
  error?: string
}

// Search/filter options
export interface FileFilter {
  search?: string
  file_types?: PDMFile['file_type'][]
  states?: FileState[]
  extensions?: string[]
  checked_out_only?: boolean
  checked_out_by_me?: boolean
  folder?: string
  part_number?: string
  revision?: string
}

// Bulk operation
export interface BulkOperation {
  type: 'checkout' | 'checkin' | 'change_state' | 'update_revision'
  file_ids: string[]
  params?: Record<string, unknown>
}

// Conflict info when checking in
export interface ConflictInfo {
  file_id: string
  file_path: string
  local_version: number
  remote_version: number
  local_hash: string
  remote_hash: string
  remote_user: string
  remote_time: string
}

// Where-used result
export interface WhereUsedResult {
  file: PDMFile
  reference_type: FileReference['reference_type']
  quantity: number
  level: number               // Depth in assembly tree
  path: string[]              // Path from root assembly
}

// Contains (BOM) result  
export interface ContainsResult {
  file: PDMFile
  reference_type: FileReference['reference_type']
  quantity: number
  level: number
  configuration: string | null
}

// Activity log entry
export interface ActivityEntry {
  id: string
  org_id: string
  file_id: string | null
  user_id: string
  user_email: string
  action: 'checkout' | 'checkin' | 'create' | 'delete' | 'state_change' | 'revision_change' | 'rename' | 'move'
  details: Record<string, unknown>
  created_at: string
}

// Helper to get next revision letter
export function getNextRevision(current: string, scheme: RevisionScheme): string {
  if (scheme === 'numeric') {
    const num = parseInt(current) || 0
    return String(num + 1).padStart(2, '0')
  }
  
  // Letter scheme: A -> B -> ... -> Z -> AA -> AB -> ...
  if (!current || current === '-') return 'A'
  
  const chars = current.split('')
  let i = chars.length - 1
  
  while (i >= 0) {
    if (chars[i] === 'Z') {
      chars[i] = 'A'
      i--
    } else {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1)
      return chars.join('')
    }
  }
  
  return 'A' + chars.join('')
}

// Get file type from extension
export function getFileType(extension: string): PDMFile['file_type'] {
  const ext = extension.toLowerCase()
  
  if (['.sldprt', '.prt', '.ipt', '.catpart', '.x_t', '.x_b', '.sat'].includes(ext)) {
    return 'part'
  }
  if (['.sldasm', '.asm', '.iam', '.catproduct'].includes(ext)) {
    return 'assembly'
  }
  if (['.slddrw', '.dwg', '.dxf'].includes(ext)) {
    return 'drawing'
  }
  if (['.pdf', '.step', '.stp', '.iges', '.igs', '.stl', '.3mf', '.obj'].includes(ext)) {
    return 'document'
  }
  
  return 'other'
}

// Check if file is a CAD file
export function isCADFile(filename: string): boolean {
  const ext = '.' + filename.split('.').pop()?.toLowerCase()
  return CAD_EXTENSIONS.includes(ext as CADExtension)
}

// Format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// State display info
export const STATE_INFO: Record<FileState, { label: string; color: string; description: string }> = {
  wip: {
    label: 'Work in Progress',
    color: 'pdm-wip',
    description: 'File is being actively worked on'
  },
  in_review: {
    label: 'In Review',
    color: 'pdm-info',
    description: 'File is pending approval for release'
  },
  released: {
    label: 'Released',
    color: 'pdm-released',
    description: 'File is approved for production use'
  },
  obsolete: {
    label: 'Obsolete',
    color: 'pdm-inactive',
    description: 'File is no longer active'
  }
}

