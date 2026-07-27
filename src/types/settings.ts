// Settings-related type definitions

export type SettingsTab =
  | 'profile'
  | 'preferences'
  | 'keybindings'
  | 'modules' // Displays as "Sidebar" in UI
  | 'vaults'
  | 'team-members'
  | 'company-profile'
  | 'auth-providers'
  | 'serialization'
  | 'export'
  | 'rfq'
  | 'metadata-columns'
  | 'item-designations'
  | 'backup'
  | 'solidworks'
  | 'google-drive'
  | 'odoo'
  | 'slack' // Hidden from nav, coming soon
  | 'webhooks'
  | 'api'
  | 'supabase'
  | 'recovery-codes'
  | 'performance'
  | 'logs'
  | 'dev-tools'
  | 'about'
  | 'delete-account'
  | 'extension-store'

// Keybinding action identifiers
export type KeybindingAction =
  | 'navigateUp'
  | 'navigateDown'
  | 'expandFolder'
  | 'collapseFolder'
  | 'selectAll'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'delete'
  | 'escape'
  | 'openFile'
  | 'toggleDetailsPanel'
  | 'refresh'

// Keybinding configuration
export interface Keybinding {
  key: string // e.g., 'ArrowUp', 'a', 'Delete'
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

export type KeybindingsConfig = Record<KeybindingAction, Keybinding>

// ============================================
// SOLIDWORKS Template Settings
// ============================================

/**
 * Organization-level SOLIDWORKS template folder configuration.
 * Paths are relative to the vault root.
 */
export interface SolidWorksTemplateSettings {
  /** Relative path in vault for document templates, e.g., "_templates/Documents" */
  documentTemplates?: string
  /** Relative path in vault for sheet formats, e.g., "_templates/SheetFormats" */
  sheetFormats?: string
  /** Relative path in vault for BOM templates, e.g., "_templates/BOM" */
  bomTemplates?: string
  /** Relative path in vault for custom property files, e.g., "_templates/CustomProperties" */
  customPropertyFolders?: string
  /** Whether SOLIDWORKS should prompt user to select a template when creating new documents */
  promptForTemplate?: boolean
  /** ISO timestamp of last push to all users */
  lastPushedAt?: string
  /** User ID who performed the last push */
  lastPushedBy?: string
}

/**
 * User-local SOLIDWORKS template overrides (stored in localStorage).
 */
export interface SolidWorksLocalTemplateSettings {
  /** Whether user has personal overrides enabled */
  usePersonalOverrides: boolean
  /** User's personal template paths (absolute paths) */
  documentTemplates?: string
  sheetFormats?: string
  bomTemplates?: string
  /** When settings were last synced from org */
  lastSyncedAt?: string
}
