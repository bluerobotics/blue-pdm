/**
 * useSolidWorksFileCreation - Hook for creating new SOLIDWORKS files from templates
 *
 * This hook provides functionality to create new SOLIDWORKS Part, Assembly, and Drawing
 * files from template files (.prtdot, .asmdot, .drwdot) in the configured template folder.
 *
 * Uses the SolidWorks API to properly convert templates to documents. Simply copying
 * template files and renaming them doesn't work because templates have internal metadata
 * marking them as templates - SolidWorks would still treat them as templates.
 *
 * Designed for future extraction to a SOLIDWORKS extension.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'
import { log } from '@/lib/logger'
import { beginWatcherSuppression } from '@/lib/fileWatcherSuppression'

/** Template settings from organization */
interface TemplateSettings {
  documentTemplates?: string
  sheetFormats?: string
  bomTemplates?: string
  customPropertyFolders?: string
  promptForTemplate?: boolean
}

/** Template file info */
export interface TemplateFile {
  name: string // Display name (filename without extension)
  path: string // Full path to template file
}

/** Available template files discovered in template folder */
export interface AvailableTemplates {
  parts: TemplateFile[] // All .sldprt templates
  assemblies: TemplateFile[] // All .sldasm templates
  drawings: TemplateFile[] // All .slddrw templates
}

/** SOLIDWORKS file type */
export type SolidWorksFileType = 'part' | 'assembly' | 'drawing'

/** Extension mapping */
const FILE_TYPE_EXTENSIONS: Record<SolidWorksFileType, string> = {
  part: '.sldprt',
  assembly: '.sldasm',
  drawing: '.slddrw',
}

/** Default filename bases */
const FILE_TYPE_NAMES: Record<SolidWorksFileType, string> = {
  part: 'Part',
  assembly: 'Assembly',
  drawing: 'Drawing',
}

export interface UseSolidWorksFileCreationReturn {
  /** Whether SOLIDWORKS file creation is available (integration enabled) */
  canCreateSolidWorksFiles: boolean

  /** Whether integration is enabled */
  isIntegrationEnabled: boolean

  /** Whether templates are configured */
  hasTemplatesConfigured: boolean

  /** Resolved template folder path */
  templateFolderPath: string | null

  /** Available template files */
  availableTemplates: AvailableTemplates

  /** Whether templates are being loaded */
  isLoadingTemplates: boolean

  /** Create a new file from a specific template */
  createFromTemplate: (
    templatePath: string,
    targetFolder: string,
    fileType: SolidWorksFileType,
  ) => Promise<string | null>

  /** Refresh template discovery */
  refreshTemplates: () => Promise<void>
}

/**
 * Hook for creating new SOLIDWORKS files from templates.
 *
 * Reads template configuration from organization settings, discovers available
 * template files, and provides methods to create new files.
 */
export function useSolidWorksFileCreation(): UseSolidWorksFileCreationReturn {
  const { organization, vaultPath, solidworksIntegrationEnabled, addToast } = usePDMStore()

  const [availableTemplates, setAvailableTemplates] = useState<AvailableTemplates>({
    parts: [],
    assemblies: [],
    drawings: [],
  })
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false)

  // Get template settings from organization
  const templateSettings = organization?.settings?.solidworks_templates as
    | TemplateSettings
    | undefined
  const hasTemplatesConfigured = !!templateSettings?.documentTemplates

  // Resolve absolute template folder path
  const templateFolderPath = useMemo(() => {
    if (!vaultPath || !templateSettings?.documentTemplates) return null
    // Convert forward slashes to backslashes for Windows
    const relativePath = templateSettings.documentTemplates.replace(/\//g, '\\')
    return `${vaultPath}\\${relativePath}`
  }, [vaultPath, templateSettings?.documentTemplates])

  // Check if creation is available (just need integration enabled and vault path)
  const canCreateSolidWorksFiles = solidworksIntegrationEnabled && !!vaultPath

  /**
   * Discover template files in the template folder
   */
  const discoverTemplates = useCallback(async () => {
    log.debug('[SWFileCreation]', `discoverTemplates called, templateFolderPath: ${templateFolderPath}`)

    if (!templateFolderPath) {
      log.debug('[SWFileCreation]', 'No template folder path configured')
      setAvailableTemplates({ parts: [], assemblies: [], drawings: [] })
      return
    }

    setIsLoadingTemplates(true)
    try {
      // List files in template folder
      log.debug('[SWFileCreation]', `Listing files in: ${templateFolderPath}`)
      const result = await window.electronAPI?.listDirFiles(templateFolderPath)

      log.debug('[SWFileCreation]', `listDirFiles result: ${result?.success}, fileCount: ${result?.files?.length}`)

      if (!result?.success || !result.files) {
        log.warn('[SWFileCreation]', 'Failed to list files or empty result', { error: result?.error })
        setAvailableTemplates({ parts: [], assemblies: [], drawings: [] })
        return
      }

      const templates: AvailableTemplates = {
        parts: [],
        assemblies: [],
        drawings: [],
      }

      // Collect only SOLIDWORKS template files (.prtdot, .asmdot, .drwdot)
      // These are the actual template file formats, not regular documents
      for (const file of result.files) {
        if (file.isDirectory) continue

        const ext = file.extension.toLowerCase()
        // Get display name (filename without extension)
        const displayName = file.name.replace(/\.[^/.]+$/, '')

        log.debug('[SWFileCreation]', `Found file: ${file.name} ext: ${ext}`)

        // Part templates: .prtdot
        if (ext === '.prtdot') {
          templates.parts.push({ name: displayName, path: file.path })
        }
        // Assembly templates: .asmdot
        else if (ext === '.asmdot') {
          templates.assemblies.push({ name: displayName, path: file.path })
        }
        // Drawing templates: .drwdot
        else if (ext === '.drwdot') {
          templates.drawings.push({ name: displayName, path: file.path })
        }
      }

      // Sort templates alphabetically by name
      templates.parts.sort((a, b) => a.name.localeCompare(b.name))
      templates.assemblies.sort((a, b) => a.name.localeCompare(b.name))
      templates.drawings.sort((a, b) => a.name.localeCompare(b.name))

      log.info('[SWFileCreation]', `Discovered templates: parts=${templates.parts.length} assemblies=${templates.assemblies.length} drawings=${templates.drawings.length}`)
      setAvailableTemplates(templates)
    } catch (error) {
      log.error('[SWFileCreation]', 'Failed to discover templates', { error })
      setAvailableTemplates({ parts: [], assemblies: [], drawings: [] })
    } finally {
      setIsLoadingTemplates(false)
    }
  }, [templateFolderPath])

  // Discover templates when path changes
  useEffect(() => {
    if (solidworksIntegrationEnabled && templateFolderPath) {
      discoverTemplates()
    } else {
      setAvailableTemplates({ parts: [], assemblies: [], drawings: [] })
    }
  }, [solidworksIntegrationEnabled, templateFolderPath, discoverTemplates])

  /**
   * Generate a unique filename in the target folder
   */
  const generateUniqueFilename = useCallback(
    async (targetFolder: string, baseName: string, extension: string): Promise<string> => {
      // Try the base name first
      let filename = `${baseName}${extension}`
      let counter = 1

      while (true) {
        const fullPath = `${targetFolder}\\${filename}`
        const exists = await window.electronAPI?.fileExists(fullPath)

        if (!exists) {
          return filename
        }

        // Try with counter suffix
        counter++
        filename = `${baseName}${counter}${extension}`

        // Safety limit
        if (counter > 1000) {
          // Use timestamp as fallback
          const timestamp = Date.now()
          return `${baseName}_${timestamp}${extension}`
        }
      }
    },
    [],
  )

  /**
   * Create a new SOLIDWORKS file from a specific template.
   *
   * Uses the SolidWorks API to properly convert the template to a document.
   * This is necessary because template files (.prtdot, .asmdot, .drwdot) have
   * internal metadata marking them as templates - simply copying and renaming
   * doesn't work.
   */
  const createFromTemplate = useCallback(
    async (
      templatePath: string,
      targetFolder: string,
      fileType: SolidWorksFileType,
    ): Promise<string | null> => {
      try {
        // Use generic name (Part, Assembly, Drawing) - not the template name
        const baseName = FILE_TYPE_NAMES[fileType]
        // Always use document extension (not template extension) for the output file
        const extension = FILE_TYPE_EXTENSIONS[fileType]
        const filename = await generateUniqueFilename(targetFolder, baseName, extension)
        const destPath = `${targetFolder}\\${filename}`

        log.info('[SWFileCreation]', `Creating document from template: ${templatePath} -> ${destPath}`)

        // Use the SolidWorks API to create a proper document from the template
        // This properly converts the template metadata to document metadata
        const result = await window.electronAPI?.solidworks.createDocumentFromTemplate(
          templatePath,
          destPath,
        )

        if (!result?.success) {
          log.error('[SWFileCreation]', 'API error', { error: result?.error })
          addToast('error', result?.error || `Failed to create ${fileType}`)
          return null
        }

        // Immediately add the file to the store for instant UI feedback
        // This prevents the 5-10 second freeze while waiting for file watcher + full refresh
        if (vaultPath) {
          const relativePath = destPath.replace(vaultPath + '\\', '').replace(/\\/g, '/')
          const newFile: LocalFile = {
            name: filename,
            path: destPath,
            relativePath,
            isDirectory: false,
            extension,
            size: 0, // Size will be updated on next refresh
            modifiedTime: new Date().toISOString(),
            diffStatus: 'added', // New file, not in PDM yet
          }

          // Mark as expected change so file watcher doesn't trigger full refresh
          const releaseWatcher = beginWatcherSuppression([relativePath])

          // Add to store - file watcher will skip this as expected change
          const { files, setFiles } = usePDMStore.getState()
          setFiles([...files, newFile])

          // The template copy already finished, so start the clear timer now.
          releaseWatcher()

          log.info('[SWFileCreation]', `Added file to store immediately: ${relativePath}`)
        }

        addToast('success', `Created ${filename}`)
        return destPath
      } catch (error) {
        log.error('[SWFileCreation]', `Failed to create ${fileType}`, { error })
        addToast('error', `Failed to create ${fileType}: ${error}`)
        return null
      }
    },
    [generateUniqueFilename, addToast, vaultPath],
  )

  return {
    canCreateSolidWorksFiles,
    isIntegrationEnabled: solidworksIntegrationEnabled,
    hasTemplatesConfigured,
    templateFolderPath,
    availableTemplates,
    isLoadingTemplates,
    createFromTemplate,
    refreshTemplates: discoverTemplates,
  }
}
