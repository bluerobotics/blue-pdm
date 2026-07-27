// Item Browser domain types
//
// An "item" is a unique part number (files.part_number) in a vault. The
// ItemDefinitionSettings below control which files count toward an item.

import type { PDMFile } from './pdm'

// Coarse file categories, mirrors the DB `file_type` enum
export type ItemFileType = 'part' | 'assembly' | 'drawing' | 'pdf' | 'step' | 'other'

export const ITEM_FILE_TYPES: ItemFileType[] = [
  'part',
  'assembly',
  'drawing',
  'pdf',
  'step',
  'other',
]

// Org-wide definition of what constitutes an item (persisted as JSONB)
export interface ItemDefinitionSettings {
  // When true, files in any workflow stage qualify. When false, only files
  // whose workflow_state_id is in workflowStageIds qualify.
  anyStage: boolean
  workflowStageIds: string[]
  // When true, files of any type qualify. When false, only files whose
  // file_type is in fileTypes qualify.
  anyType: boolean
  fileTypes: ItemFileType[]
  // Only count files that have a part number (recommended: true)
  requirePartNumber: boolean
  // Only show items whose number matches the org serialization format
  matchOrgFormat: boolean
}

export const DEFAULT_ITEM_DEFINITION: ItemDefinitionSettings = {
  anyStage: true,
  workflowStageIds: [],
  anyType: true,
  fileTypes: [],
  requirePartNumber: true,
  matchOrgFormat: true,
}

// Minimal file shape needed to render a preview/thumbnail in the grid card.
// Mirrors the fields consumed by the file-browser useThumbnail + FileCardIcon.
export interface ItemPrimaryFile {
  name: string
  path?: string
  // Vault-relative path, used to reveal the file in the Explorer view
  relativePath?: string
  extension: string
  isDirectory: boolean
}

// Org-configurable item designation (e.g. Part, Assembly, Packed Assembly)
export interface ItemDesignation {
  id: string
  name: string
  sortOrder: number
}

// The default designation names an item falls back to when it has no explicit
// override. Assemblies default to "Assembly", everything else to "Part".
export const DEFAULT_PART_DESIGNATION = 'Part'
export const DEFAULT_ASSEMBLY_DESIGNATION = 'Assembly'

// Designation names that mark an item as an assembly (BOMs section is shown).
export const ASSEMBLY_DESIGNATION_NAMES = ['Assembly', 'Packed Assembly']

// A single row in the Item Browser (one unique part number)
export interface ItemRow {
  itemNumber: string
  description: string | null
  revision: string | null
  workflowStateName: string | null
  workflowStateColor: string | null
  fileTypes: ItemFileType[]
  fileCount: number
  lastModified: string | null
  files: PDMFile[]
  // Primary underlying file (best type priority) used for the grid preview
  primaryFile: ItemPrimaryFile | null
  // Resolved designation name (from override, or derived from file types)
  designation: string | null
  // Resolved designation id, whether from an explicit override or a matched
  // default. Null when no matching designation exists in the org list.
  designationId: string | null
  // True when the designation comes from an explicit per-item override
  designationIsOverride: boolean
}

// Per-item visual override (keyed by part_number, shared org-wide).
// 'preview' = default SolidWorks thumbnail, 'icon' = a Lucide icon,
// 'image' = an uploaded image stored in the vault bucket.
export type ItemImageType = 'preview' | 'icon' | 'image'

export interface ItemImage {
  partNumber: string
  type: ItemImageType
  iconName?: string | null
  iconColor?: string | null
  // Resolved (signed) URL for type 'image'
  imageUrl?: string | null
  storagePath?: string | null
}

// Minimal workflow stage info used by the browser and definition modal
export interface ItemWorkflowStage {
  id: string
  name: string
  label: string | null
  color: string | null
}
