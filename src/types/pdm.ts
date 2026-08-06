// PDM Types for SolidWorks and CAD file management

// Revision follows engineering convention (A, B, C... then AA, AB, etc.)
export type RevisionScheme = 'letter' | 'numeric'

// Supported CAD file types - comprehensive list for PLM/PDM systems
export const CAD_EXTENSIONS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // SOLIDWORKS
  // ═══════════════════════════════════════════════════════════════════════════
  '.sldprt', // Part
  '.sldasm', // Assembly
  '.slddrw', // Drawing
  '.slddrt', // Drawing template
  '.sldlfp', // Library feature part
  '.sldblk', // Block
  '.asmdot', // Assembly template
  '.prtdot', // Part template
  '.drwdot', // Drawing template
  '.sldstd', // Drafting standard
  '.sldftp', // Form tool part
  '.sldprt~', // Backup part
  '.sldasm~', // Backup assembly
  '.slddrw~', // Backup drawing

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTODESK INVENTOR
  // ═══════════════════════════════════════════════════════════════════════════
  '.ipt', // Part
  '.iam', // Assembly
  '.idw', // Drawing
  '.dwg', // AutoCAD drawing (also Inventor)
  '.ipn', // Presentation
  '.ipj', // Project file

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTODESK AUTOCAD / CIVIL / MECHANICAL
  // ═══════════════════════════════════════════════════════════════════════════
  '.dxf', // Drawing exchange
  '.dwt', // Template
  '.dws', // Standards
  '.dwf', // Design web format
  '.dwfx', // Design web format XPS

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTODESK FUSION 360 / ALIAS
  // ═══════════════════════════════════════════════════════════════════════════
  '.f3d', // Fusion 360 design
  '.f3z', // Fusion 360 archive
  '.wire', // Alias wire

  // ═══════════════════════════════════════════════════════════════════════════
  // PTC CREO / PRO-ENGINEER
  // ═══════════════════════════════════════════════════════════════════════════
  '.prt', // Part (also NX)
  '.asm', // Assembly
  '.drw', // Drawing
  '.frm', // Format/template
  '.sec', // Section
  '.lay', // Layout
  '.neu', // Neutral

  // ═══════════════════════════════════════════════════════════════════════════
  // SIEMENS NX (UNIGRAPHICS)
  // ═══════════════════════════════════════════════════════════════════════════
  // Uses .prt for all types - versioned like part.prt.1, part.prt.2

  // ═══════════════════════════════════════════════════════════════════════════
  // SIEMENS SOLID EDGE
  // ═══════════════════════════════════════════════════════════════════════════
  '.par', // Part
  '.psm', // Sheet metal part
  '.pwd', // Weldment
  '.dft', // Draft/drawing

  // ═══════════════════════════════════════════════════════════════════════════
  // DASSAULT CATIA
  // ═══════════════════════════════════════════════════════════════════════════
  '.catpart', // Part
  '.catproduct', // Assembly
  '.catdrawing', // Drawing
  '.catshape', // Shape
  '.catmaterial', // Material
  '.cgr', // Graphical representation
  '.3dxml', // 3D XML

  // ═══════════════════════════════════════════════════════════════════════════
  // RHINO / GRASSHOPPER
  // ═══════════════════════════════════════════════════════════════════════════
  '.3dm', // Rhino model
  '.gh', // Grasshopper definition
  '.ghx', // Grasshopper definition XML

  // ═══════════════════════════════════════════════════════════════════════════
  // SKETCHUP
  // ═══════════════════════════════════════════════════════════════════════════
  '.skp', // SketchUp model
  '.skb', // SketchUp backup
  '.layout', // SketchUp Layout

  // ═══════════════════════════════════════════════════════════════════════════
  // FREECAD / OPENSCAD / OPEN SOURCE
  // ═══════════════════════════════════════════════════════════════════════════
  '.fcstd', // FreeCAD standard
  '.scad', // OpenSCAD
  '.brep', // OpenCASCADE boundary representation

  // ═══════════════════════════════════════════════════════════════════════════
  // BLENDER / 3D VISUALIZATION
  // ═══════════════════════════════════════════════════════════════════════════
  '.blend', // Blender
  '.blend1', // Blender backup
  '.max', // 3ds Max
  '.ma', // Maya ASCII
  '.mb', // Maya binary
  '.c4d', // Cinema 4D
  '.hda', // Houdini digital asset
  '.hip', // Houdini
  '.hipnc', // Houdini non-commercial

  // ═══════════════════════════════════════════════════════════════════════════
  // NEUTRAL / EXCHANGE FORMATS
  // ═══════════════════════════════════════════════════════════════════════════
  '.step', // STEP AP203/AP214/AP242
  '.stp', // STEP alternate
  '.stpz', // Compressed STEP
  '.p21', // STEP physical file
  '.iges', // IGES
  '.igs', // IGES alternate
  '.x_t', // Parasolid text
  '.x_b', // Parasolid binary
  '.xmt_txt', // Parasolid transmit text
  '.xmt_bin', // Parasolid transmit binary
  '.sat', // ACIS text
  '.sab', // ACIS binary
  '.asat', // ACIS annotated
  '.jt', // JT (Siemens/Jupiter)
  '.vda', // VDA-FS
  '.vdafs', // VDA-FS alternate

  // ═══════════════════════════════════════════════════════════════════════════
  // MESH / 3D PRINTING / VISUALIZATION
  // ═══════════════════════════════════════════════════════════════════════════
  '.stl', // Stereolithography
  '.3mf', // 3D Manufacturing Format
  '.obj', // Wavefront OBJ
  '.mtl', // OBJ material library
  '.fbx', // Filmbox
  '.dae', // COLLADA
  '.gltf', // GL Transmission Format
  '.glb', // GL Transmission Format binary
  '.usdz', // Universal Scene Description
  '.usda', // USD ASCII
  '.usdc', // USD crate/binary
  '.ply', // Polygon file format
  '.wrl', // VRML
  '.vrml', // VRML alternate
  '.x3d', // X3D
  '.amf', // Additive Manufacturing File
  '.off', // Object File Format
  '.smesh', // Surface mesh

  // ═══════════════════════════════════════════════════════════════════════════
  // ELECTRONICS / PCB / SCHEMATIC - KICAD
  // ═══════════════════════════════════════════════════════════════════════════
  '.kicad_pcb', // KiCad PCB
  '.kicad_sch', // KiCad schematic
  '.kicad_mod', // KiCad footprint module
  '.kicad_sym', // KiCad symbol
  '.kicad_pro', // KiCad project
  '.kicad_wks', // KiCad worksheet
  '.kicad_dru', // KiCad design rules
  '.fp-lib-table', // Footprint library table
  '.sym-lib-table', // Symbol library table

  // ═══════════════════════════════════════════════════════════════════════════
  // ELECTRONICS / PCB / SCHEMATIC - EAGLE
  // ═══════════════════════════════════════════════════════════════════════════
  '.brd', // Eagle/Altium board
  '.sch', // Eagle/generic schematic
  '.lbr', // Eagle library

  // ═══════════════════════════════════════════════════════════════════════════
  // ELECTRONICS / PCB / SCHEMATIC - ALTIUM
  // ═══════════════════════════════════════════════════════════════════════════
  '.pcbdoc', // Altium PCB document
  '.schdoc', // Altium schematic
  '.prjpcb', // Altium PCB project
  '.prjsch', // Altium schematic project
  '.schlib', // Altium schematic library
  '.pcblib', // Altium PCB library
  '.intlib', // Altium integrated library

  // ═══════════════════════════════════════════════════════════════════════════
  // ELECTRONICS / PCB - CADENCE ALLEGRO / ORCAD
  // ═══════════════════════════════════════════════════════════════════════════
  '.dsn', // OrCAD schematic
  '.brd', // Allegro board (shared with Eagle)
  '.spm', // Allegro symbol
  '.dra', // Allegro drawing
  '.psm', // Allegro padstack (also Solid Edge part)

  // ═══════════════════════════════════════════════════════════════════════════
  // GERBER / NC DRILL / MANUFACTURING OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════
  '.gbr', // Gerber RS-274X
  '.ger', // Gerber alternate
  '.pho', // Gerber photo
  '.gtl', // Gerber top copper
  '.gbl', // Gerber bottom copper
  '.gts', // Gerber top soldermask
  '.gbs', // Gerber bottom soldermask
  '.gto', // Gerber top silkscreen
  '.gbo', // Gerber bottom silkscreen
  '.gtp', // Gerber top paste
  '.gbp', // Gerber bottom paste
  '.gko', // Gerber keep-out
  '.gm1', // Gerber mechanical 1
  '.gm2', // Gerber mechanical 2
  '.gd1', // Gerber drill drawing
  '.drl', // NC drill
  '.xln', // Excellon drill
  '.exc', // Excellon

  // ═══════════════════════════════════════════════════════════════════════════
  // EMBEDDED / FIRMWARE
  // ═══════════════════════════════════════════════════════════════════════════
  '.hex', // Intel HEX
  '.bin', // Binary firmware
  '.elf', // Executable and Linkable Format
  '.uf2', // USB Flashing Format (RP2040, etc)
  '.dfu', // Device Firmware Upgrade

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCUMENTS / OFFICE
  // ═══════════════════════════════════════════════════════════════════════════
  '.pdf', // PDF
  '.doc', // Word (legacy)
  '.docx', // Word
  '.xls', // Excel (legacy)
  '.xlsx', // Excel
  '.xlsm', // Excel with macros
  '.csv', // Comma-separated values
  '.ppt', // PowerPoint (legacy)
  '.pptx', // PowerPoint
  '.odt', // OpenDocument text
  '.ods', // OpenDocument spreadsheet
  '.odp', // OpenDocument presentation
  '.rtf', // Rich text
  '.txt', // Plain text
  '.md', // Markdown
  '.rst', // ReStructuredText

  // ═══════════════════════════════════════════════════════════════════════════
  // IMAGES / GRAPHICS
  // ═══════════════════════════════════════════════════════════════════════════
  '.png', // PNG
  '.jpg', // JPEG
  '.jpeg', // JPEG alternate
  '.gif', // GIF
  '.bmp', // Bitmap
  '.tiff', // TIFF
  '.tif', // TIFF alternate
  '.webp', // WebP
  '.svg', // SVG vector
  '.ai', // Adobe Illustrator
  '.eps', // Encapsulated PostScript
  '.psd', // Photoshop
  '.xcf', // GIMP
  '.raw', // Camera RAW
  '.cr2', // Canon RAW
  '.nef', // Nikon RAW
  '.arw', // Sony RAW
  '.dng', // Digital Negative
  '.heic', // HEIF/HEIC
  '.ico', // Icon
  '.icns', // macOS icon

  // ═══════════════════════════════════════════════════════════════════════════
  // VIDEO
  // ═══════════════════════════════════════════════════════════════════════════
  '.mp4', // MPEG-4
  '.avi', // AVI
  '.mov', // QuickTime
  '.mkv', // Matroska
  '.wmv', // Windows Media
  '.webm', // WebM
  '.m4v', // MPEG-4 Video
  '.flv', // Flash Video

  // ═══════════════════════════════════════════════════════════════════════════
  // CAM / CNC / G-CODE
  // ═══════════════════════════════════════════════════════════════════════════
  '.nc', // Numerical control
  '.gcode', // G-code
  '.ngc', // G-code (LinuxCNC)
  '.tap', // G-code (generic)
  '.cnc', // CNC program
  '.ncc', // NC code
  '.iso', // ISO G-code (also disk image)
  '.mpf', // Main program file (Siemens)
  '.spf', // Subprogram file (Siemens)

  // ═══════════════════════════════════════════════════════════════════════════
  // CAM / TOOLPATH
  // ═══════════════════════════════════════════════════════════════════════════
  '.mastercam', // Mastercam
  '.mcam', // Mastercam alternate
  '.emcam', // EdgeCAM
  '.hsm', // HSMWorks

  // ═══════════════════════════════════════════════════════════════════════════
  // CAE / FEA / SIMULATION
  // ═══════════════════════════════════════════════════════════════════════════
  '.sldcmp', // SolidWorks Composer
  '.smg', // SolidWorks Composer
  '.sldpfl', // SolidWorks Profile
  '.cdb', // ANSYS database
  '.db', // ANSYS database
  '.inp', // Abaqus input
  '.odb', // Abaqus output
  '.cas', // Fluent case
  '.dat', // Data file (various)
  '.msh', // Mesh (GMSH/Fluent)
  '.nas', // Nastran
  '.bdf', // Nastran bulk data
  '.fem', // FEM model
  '.op2', // Nastran output

  // ═══════════════════════════════════════════════════════════════════════════
  // ARCHIVES
  // ═══════════════════════════════════════════════════════════════════════════
  '.zip', // ZIP
  '.7z', // 7-Zip
  '.rar', // RAR
  '.tar', // Tape archive
  '.gz', // Gzip
  '.bz2', // Bzip2
  '.xz', // XZ
  '.zst', // Zstandard
  '.tgz', // Tar + Gzip
  '.tbz2', // Tar + Bzip2

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA / CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════
  '.json', // JSON
  '.xml', // XML
  '.yaml', // YAML
  '.yml', // YAML alternate
  '.toml', // TOML
  '.ini', // INI config
  '.cfg', // Configuration
  '.conf', // Configuration
  '.properties', // Java properties

  // ═══════════════════════════════════════════════════════════════════════════
  // SOURCE CODE (for reference designs, libraries, scripts)
  // ═══════════════════════════════════════════════════════════════════════════
  '.py', // Python
  '.js', // JavaScript
  '.ts', // TypeScript
  '.c', // C
  '.cpp', // C++
  '.h', // C/C++ header
  '.hpp', // C++ header
  '.cs', // C#
  '.java', // Java
  '.rs', // Rust
  '.go', // Go
  '.swift', // Swift
  '.kt', // Kotlin
  '.m', // MATLAB/Objective-C
  '.mlx', // MATLAB live script
  '.mat', // MATLAB data
  '.html', // HTML
  '.css', // CSS
  '.scss', // SCSS
  '.less', // LESS
  '.sql', // SQL
  '.sh', // Shell script
  '.bash', // Bash script
  '.ps1', // PowerShell
  '.bat', // Batch file
  '.cmd', // Command script

  // ═══════════════════════════════════════════════════════════════════════════
  // MISC ENGINEERING
  // ═══════════════════════════════════════════════════════════════════════════
  '.smc', // Simulation/multi-body
  '.eprt', // eDrawings part
  '.easm', // eDrawings assembly
  '.edrw', // eDrawings drawing
  '.stla', // STL ASCII
  '.stlb', // STL binary
] as const

export type CADExtension = (typeof CAD_EXTENSIONS)[number]

// File metadata stored in Supabase
export interface PDMFile {
  id: string
  org_id: string
  vault_id: string | null // Vault this file belongs to (files table column)

  // File identity
  file_path: string // Relative path in vault
  file_name: string // Display name
  extension: string // .sldprt, .sldasm, etc.
  file_type: 'part' | 'assembly' | 'drawing' | 'pdf' | 'step' | 'other'

  // Engineering metadata
  part_number: string | null
  description: string | null
  revision: string // A, B, C or 01, 02, 03
  version: number // Auto-incrementing save version

  // State management (references workflow_states)
  workflow_state_id: string | null
  workflow_state?: {
    id: string
    name: string
    label: string | null
    color: string
    icon: string
    is_editable: boolean
    requires_checkout: boolean
  } | null
  state_changed_at: string | null
  state_changed_by: string | null

  // Lock/checkout
  checked_out_by: string | null
  checked_out_at: string | null
  lock_message: string | null
  checked_out_by_machine_id: string | null // Machine ID that checked out the file
  checked_out_by_machine_name: string | null // Machine name for display
  checked_out_user?: {
    full_name: string | null
    email: string
    avatar_url: string | null
  } | null

  // Content tracking
  content_hash: string | null // SHA-256 hash of file content
  file_size: number | null // Bytes

  // Timestamps
  created_at: string | null
  created_by: string
  updated_at: string | null
  updated_by: string | null

  // Custom properties (from SolidWorks custom properties)
  custom_properties: Record<string, string | number | null> | unknown | null

  // Configuration-specific revisions (for multi-config parts/assemblies)
  // Map of configuration name -> revision letter, e.g. { "Default": "B", "Anodized": "C" }
  // Updated when drawings referencing this file's configs are released
  configuration_revisions?: Record<string, string> | null

  // ECO tags (denormalized from file_ecos junction table)
  eco_tags?: string[] | null

  // Soft delete (trash bin)
  deleted_at: string | null
  deleted_by: string | null
}

// Assembly/part relationships for where-used
export interface FileReference {
  id: string
  org_id: string
  parent_file_id: string // Assembly that uses the part
  child_file_id: string // Part being used
  reference_type: 'component' | 'drawing_view' | 'derived' | 'copy'
  quantity: number // How many instances
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
  content_hash: string
  file_size: number | null
  comment: string | null
  workflow_state_id: string | null
  created_at: string | null
  created_by: string
}

// Organization (determined by email domain)
export interface Organization {
  id: string
  name: string // "Blue Robotics"
  slug: string // "bluerobotics"
  email_domains: string[] // ["bluerobotics.com"]
  revision_scheme: RevisionScheme
  settings: OrgSettings
  created_at: string
  // Company profile
  logo_url?: string | null // Signed URL for logo (may expire)
  logo_storage_path?: string | null // Path in Supabase storage bucket
  // Company contact info
  phone?: string | null
  website?: string | null
  contact_email?: string | null
  // Company address (legacy single address)
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country?: string | null
  // Google Drive integration
  google_drive_enabled?: boolean
  google_drive_client_id?: string | null
  google_drive_client_secret?: string | null
  // RFQ settings
  rfq_settings?: RFQSettings | null
  // Serialization settings
  serialization_settings?: SerializationSettings | null
  // Module defaults for organization members
  module_defaults?: Record<string, unknown> | null
  // Timestamp when module_defaults was force-pushed to all users
  module_defaults_forced_at?: string | null
  // Auth provider settings
  auth_providers?: AuthProviderSettings | null
}

// Auth provider settings for controlling which sign-in methods are allowed
export interface AuthProviderSettings {
  users: {
    google: boolean
    email: boolean
    phone: boolean
  }
  suppliers: {
    google: boolean
    email: boolean
    phone: boolean
  }
}

// Default auth provider settings (all enabled)
export const DEFAULT_AUTH_PROVIDERS: AuthProviderSettings = {
  users: { google: true, email: true, phone: true },
  suppliers: { google: true, email: true, phone: true },
}

// RFQ template settings
export interface RFQSettings {
  default_payment_terms: string
  default_incoterms: string
  default_valid_days: number
  show_company_logo: boolean
  show_revision_column: boolean
  show_material_column: boolean
  show_finish_column: boolean
  show_notes_column: boolean
  terms_and_conditions: string
  footer_text: string
}

// Serialization settings for sequential item numbers
export interface SerializationSettings {
  enabled: boolean
  prefix: string
  suffix: string
  padding_digits: number
  letter_count: number
  current_counter: number
  use_letters_before_numbers: boolean
  letter_prefix: string
  keepout_zones: Array<{ start: number; end_num: number; description: string }>
  auto_apply_extensions: string[]
  // Tab number settings
  tab_enabled: boolean
  tab_separator: string
  tab_padding_digits: number
  tab_required: boolean // If false, tab is optional (base numbers can exist without tab)
  // Tab character settings
  tab_allow_letters: boolean // Allow A-Z in tab numbers
  tab_allow_numbers: boolean // Allow 0-9 in tab numbers
  tab_allow_special: boolean // Allow special characters in tab numbers
  tab_special_chars: string // Which special characters are allowed (e.g., "-_")
  // Auto-format settings
  auto_pad_numbers: boolean // Auto-add leading zeros when editing
}

export interface OrgSettings {
  require_checkout: boolean
  auto_increment_part_numbers: boolean
  part_number_prefix: string
  part_number_digits: number
  allowed_extensions: string[]
  require_description: boolean
  require_approval_for_release: boolean
  max_file_size_mb: number
  // Email domain enforcement
  enforce_email_domain?: boolean // If true, only users with matching email domains can join
  // SolidWorks integration (org-wide)
  solidworks_dm_license_key?: string // Document Manager API key for fast file reading
  solidworks_templates?: SolidWorksTemplateSettingsOrg // Template folder configuration
  /** When true (default), keep a hidden SolidWorks instance warm so the first property edit is instant instead of a ~40s cold-start. */
  solidworks_prewarm_full_app?: boolean
  // REST API (org-wide)
  api_url?: string // External API server URL for ERP integrations
  // Export settings (org-wide)
  export_settings?: ExportSettings
  // Revision policy (org-wide)
  /** When false, .sldprt/.sldasm files cannot have file-level revisions (config revisions from drawings still apply). Default: false */
  allow_file_level_revision_for_models?: boolean
  /**
   * Vault-relative folder paths hidden from non-admins in the interface, and skipped
   * by the serial number vault scan. Cosmetic decluttering only — the rows remain
   * readable through the API, so this is not an access restriction.
   */
  admin_only_folders?: string[]
}

/**
 * SOLIDWORKS template folder configuration stored in org settings.
 * Paths are relative to the vault root.
 */
export interface SolidWorksTemplateSettingsOrg {
  /** Relative path in vault for document templates, e.g., "_templates/Documents" */
  documentTemplates?: string
  /** Relative path in vault for sheet formats, e.g., "_templates/SheetFormats" */
  sheetFormats?: string
  /** Relative path in vault for BOM templates, e.g., "_templates/BOM" */
  bomTemplates?: string
  /** ISO timestamp of last push to all users */
  lastPushedAt?: string
  /** User ID who performed the last push */
  lastPushedBy?: string
}

/**
 * Export filename pattern settings
 * Supported tokens:
 * {filename} - Original file name (without extension)
 * {config} - Configuration name
 * {partNumber} or {number} - Part/Item number from properties
 * {revision} or {rev} - Revision from properties
 * {description} or {desc} - Description from properties
 * {date} - Current date (YYYY-MM-DD)
 * {time} - Current time (HH-MM-SS)
 * {datetime} - Current date and time (YYYY-MM-DD_HH-MM-SS)
 */
export interface ExportSettings {
  // Filename pattern for exports, e.g., "{partNumber}_Rev{rev}" -> "BR-101011-394_RevA.step"
  filename_pattern: string
  // Whether to include config name in filename when exporting specific configs
  include_config_in_filename: boolean
  // Default export format for parts/assemblies
  default_export_format?: 'step' | 'iges' | 'stl'

  // STL-specific settings
  stl_resolution?: 'coarse' | 'fine' | 'custom'
  stl_binary_format?: boolean // true = binary (smaller), false = ASCII
  stl_custom_deviation?: number // mm, only for custom resolution
  stl_custom_angle?: number // degrees, only for custom resolution
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  filename_pattern: '{filename}_{config}',
  include_config_in_filename: true,
  default_export_format: 'step',
  // STL defaults: Custom resolution with fine-quality settings + 1° angular resolution
  stl_resolution: 'custom',
  stl_binary_format: true,
  stl_custom_deviation: 0.05, // mm (fine-quality deviation)
  stl_custom_angle: 1, // degrees (high angular resolution)
}

// User with org membership
export interface User {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null // Google/OAuth avatar URL (auto-populated)
  custom_avatar_url: string | null // User-uploaded custom avatar (takes priority)
  job_title: string | null
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
  expires_at: string | null // Optional expiry for stale locks
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
  workflow_state_ids?: string[]
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
  level: number // Depth in assembly tree
  path: string[] // Path from root assembly
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
  action:
    | 'checkout'
    | 'checkin'
    | 'create'
    | 'delete'
    | 'restore'
    | 'state_change'
    | 'revision_change'
    | 'rename'
    | 'move'
    | 'rollback'
    | 'roll_forward'
  details: Record<string, unknown>
  created_at: string
}

// Deleted file info (for trash bin)
export interface DeletedFile {
  id: string
  file_path: string
  file_name: string
  extension: string
  file_type: 'part' | 'assembly' | 'drawing' | 'pdf' | 'step' | 'other'
  part_number: string | null
  description: string | null
  revision: string
  version: number
  content_hash: string | null
  file_size: number
  workflow_state_id: string | null
  deleted_at: string
  deleted_by: string | null
  vault_id: string
  org_id: string
  updated_at: string
  deleted_by_user?: {
    email: string
    full_name: string | null
    avatar_url: string | null
  } | null
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

// Icon types for UI display (more specific than database file_type)
export type FileIconType =
  | 'part'
  | 'assembly'
  | 'drawing'
  | 'step'
  | 'pdf'
  | 'image'
  | 'spreadsheet'
  | 'archive'
  | 'pcb'
  | 'schematic'
  | 'library'
  | 'code'
  | 'text'
  | 'video'
  | 'gcode'
  | 'simulation'
  | 'firmware'
  | 'presentation'
  | 'other'
