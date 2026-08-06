/**
 * Export a CSV table (BR number, description, revision) for selected PDF / STEP files.
 */
import { useState, useRef } from 'react'
import { Loader2, Table } from 'lucide-react'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import { getSerializationSettings, combineBaseAndTab } from '@/lib/serialization'
import {
  resolveConfigurationTabs,
  resolveDescription,
  resolvePartNumber,
  resolveRevision,
  resolvedText,
} from '@/lib/metadata/overlay'
import { log } from '@/lib/logger'
import { ContextSubmenu } from '../components'
import type { ActionComponentProps } from './types'

/** Same as file type detection in supabase/files/mutations (STEP + PDF). */
const PDF_STEP_EXTENSIONS = new Set(['.pdf', '.step', '.stp', '.stpz', '.p21'])

function isPdfOrStepFile(f: LocalFile): boolean {
  if (f.isDirectory) return false
  const ext = f.extension?.toLowerCase() || ''
  return PDF_STEP_EXTENSIONS.has(ext)
}

function csvEscapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

async function getBrNumberForFile(
  file: LocalFile,
  organizationId: string | undefined,
): Promise<string> {
  const baseNumber = resolvedText(resolvePartNumber(file))
  const configTabs = resolveConfigurationTabs(file)
  const tabNumber =
    configTabs['Default'] || configTabs['default'] || Object.values(configTabs)[0] || ''
  let fullItemNumber = baseNumber
  if (tabNumber && organizationId) {
    try {
      const serSettings = await getSerializationSettings(organizationId)
      if (serSettings?.tab_enabled) {
        fullItemNumber = combineBaseAndTab(baseNumber, tabNumber, serSettings)
      } else if (baseNumber && tabNumber) {
        fullItemNumber = `${baseNumber}-${tabNumber}`
      }
    } catch (error) {
      log.debug('[ExportTable]', 'Serialization settings', { error: error })
      if (baseNumber && tabNumber) {
        fullItemNumber = `${baseNumber}-${tabNumber}`
      }
    }
  }
  return fullItemNumber
}

export function ExportMetadataTableActions({ contextFiles, onClose }: ActionComponentProps) {
  const { addToast, organization } = usePDMStore()
  const [isSaving, setIsSaving] = useState(false)
  const [submenuOpen, setSubmenuOpen] = useState(false)
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const tableFiles = contextFiles.filter(isPdfOrStepFile)

  if (
    tableFiles.length === 0 ||
    typeof window === 'undefined' ||
    !window.electronAPI?.saveTextFileWithDialog
  ) {
    return null
  }

  const handleMouseEnter = () => {
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current)
    setSubmenuOpen(true)
  }

  const handleMouseLeave = () => {
    submenuTimeoutRef.current = setTimeout(() => setSubmenuOpen(false), 150)
  }

  const buildCsv = async (): Promise<string> => {
    const rows: string[][] = [['BR Number', 'Description', 'Revision']]
    const orgId = organization?.id

    for (const file of tableFiles) {
      const brNumber = await getBrNumberForFile(file, orgId)
      const description = resolvedText(resolveDescription(file))
      const revision = resolvedText(resolveRevision(file)).trim()
      rows.push([csvEscapeCell(brNumber), csvEscapeCell(description), csvEscapeCell(revision)])
    }

    return rows.map((row) => row.join(',')).join('\r\n')
  }

  const handleSaveCsv = async () => {
    if (isSaving) return
    setIsSaving(true)
    onClose()
    try {
      const body = await buildCsv()
      const utf8 = `\uFEFF${body}`
      const defaultName = `export-${tableFiles.length}-files.csv`
      const result = await window.electronAPI.saveTextFileWithDialog(defaultName, utf8, [
        { name: 'CSV', extensions: ['csv'] },
      ])
      if (result?.success && result.path) {
        addToast('success', `Saved table (${tableFiles.length} rows)`)
      } else if (result?.canceled) {
        // no toast
      } else {
        addToast('error', result?.error ? `Save failed: ${result.error}` : 'Save failed')
      }
    } catch (error) {
      addToast('error', `Export failed: ${error}`)
    } finally {
      setIsSaving(false)
    }
  }

  const countLabel = tableFiles.length > 1 ? ` (${tableFiles.length})` : ''

  return (
    <div
      className={`context-menu-item relative ${isSaving ? 'opacity-50' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={(e) => {
        e.stopPropagation()
        setSubmenuOpen((s) => !s)
      }}
    >
      {isSaving ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Table size={14} className="text-sky-400" />
      )}
      Table{countLabel}
      <span className="text-xs text-plm-fg-muted ml-auto">▶</span>
      {submenuOpen && (
        <ContextSubmenu
          minWidth={160}
          onMouseEnter={() => {
            if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current)
            setSubmenuOpen(true)
          }}
          onMouseLeave={handleMouseLeave}
        >
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation()
              if (!isSaving) void handleSaveCsv()
            }}
          >
            <Table size={14} className="text-sky-400" />
            Save as CSV…
          </div>
        </ContextSubmenu>
      )}
    </div>
  )
}
