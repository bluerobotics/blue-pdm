/**
 * Applies explicit choices for findings where the audit cannot decide which side is authoritative.
 *
 * The two directions use different existing writers:
 *
 * - BluePLM -> document is Sync Metadata, which is deliberately per file.
 * - document -> BluePLM is the metadata promotion path, which can update a scalar column or one
 *   reserved configuration-map entry while preserving the rest of the row.
 *
 * Choices are stored in the Vault Audit slice so leaving the settings tab does not discard an
 * administrator's decisions while the scan result is still on screen.
 */

import { useCallback, useMemo } from 'react'

import { syncSolidWorksFileMetadata } from '@/lib/supabase'
import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from '@/lib/metadata/divergence'
import { readConfigurationMap } from '@/lib/metadata/configurationMaps'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { OwnedField } from '@/lib/metadata/divergence'
import type { VaultAuditFinding } from '@/types/vaultAudit'

const FILE_SCOPE_FIELDS = new Set<OwnedField>(['part_number', 'description', 'revision'])

export type VaultAuditConflictBlockReason = 'file-not-loaded'

interface AuditMetadataUpdates {
  part_number?: string | null
  description?: string | null
  revision?: string | null
  custom_properties?: Record<string, unknown>
}

type ScalarMetadataKey = 'part_number' | 'description' | 'revision'

interface ConflictWriteGroup {
  fileId: string
  relativePath: string
  findingIds: string[]
  metadata: AuditMetadataUpdates
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function copyCustomProperties(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? { ...value } : null
}

function findLocalFile(
  finding: VaultAuditFinding,
  loadedFiles: readonly LocalFile[],
): LocalFile | undefined {
  const byId = loadedFiles.find((file) => file.pdmData?.id === finding.fileId)
  if (byId) return byId

  const path = normalizePath(finding.relativePath)
  return loadedFiles.find((file) => normalizePath(file.relativePath) === path)
}

function configurationMapKey(field: OwnedField): string | null {
  if (field === 'config_tab') return CONFIG_TABS_KEY
  if (field === 'config_description') return CONFIG_DESCRIPTIONS_KEY
  return null
}

function scalarKey(field: OwnedField): ScalarMetadataKey | null {
  if (field === 'part_number') return 'part_number'
  if (field === 'description') return 'description'
  if (field === 'revision') return 'revision'
  return null
}

function addFindingToGroup(
  groups: Map<string, ConflictWriteGroup>,
  finding: VaultAuditFinding,
  localFile: LocalFile | undefined,
): void {
  if (finding.fileValue === null) return

  let group = groups.get(finding.fileId)
  if (!group) {
    group = {
      fileId: finding.fileId,
      relativePath: finding.relativePath,
      findingIds: [],
      metadata: {},
    }
    groups.set(finding.fileId, group)
  }

  const scalar = scalarKey(finding.field)
  if (scalar && FILE_SCOPE_FIELDS.has(finding.field)) {
    group.metadata[scalar] = finding.fileValue
    group.findingIds.push(finding.id)
    return
  }

  const mapKey = configurationMapKey(finding.field)
  if (!mapKey || finding.configuration === null || !localFile?.pdmData) return

  const customProperties =
    group.metadata.custom_properties ?? copyCustomProperties(localFile.pdmData.custom_properties)
  if (!customProperties) return

  const map = readConfigurationMap(customProperties, mapKey)
  map[finding.configuration] = finding.fileValue
  customProperties[mapKey] = map
  group.metadata.custom_properties = customProperties
  group.findingIds.push(finding.id)
}

function buildWriteGroups(
  findings: readonly VaultAuditFinding[],
  selectedIds: ReadonlySet<string>,
  loadedFiles: readonly LocalFile[],
): ConflictWriteGroup[] {
  const groups = new Map<string, ConflictWriteGroup>()

  for (const finding of findings) {
    if (finding.resolution !== 'choose-a-side' || !selectedIds.has(finding.id)) continue
    addFindingToGroup(groups, finding, findLocalFile(finding, loadedFiles))
  }

  return [...groups.values()].filter((group) => group.findingIds.length > 0)
}

export interface UseVaultAuditConflictResult {
  selectedFindingIds: ReadonlySet<string>
  settledFindingIds: ReadonlySet<string>
  selectedCount: number
  applying: boolean
  error: string | null
  canApply: boolean
  canAdoptFileValue: (finding: VaultAuditFinding) => boolean
  blockedReasonFor: (finding: VaultAuditFinding) => VaultAuditConflictBlockReason | null
  setMany: (findingIds: readonly string[], selected: boolean) => void
  apply: () => Promise<void>
}

export function useVaultAuditConflict(
  findings: readonly VaultAuditFinding[],
): UseVaultAuditConflictResult {
  const loadedFiles = usePDMStore((state) => state.files)
  const user = usePDMStore((state) => state.user)
  const conflict = usePDMStore((state) => state.vaultAuditConflict)
  const setSelection = usePDMStore((state) => state.setVaultAuditConflictSelection)
  const startConflict = usePDMStore((state) => state.startVaultAuditConflict)
  const finishConflict = usePDMStore((state) => state.finishVaultAuditConflict)
  const addToast = usePDMStore((state) => state.addToast)

  const selectedFindingIds = useMemo(
    () => new Set(conflict.selectedFindingIds),
    [conflict.selectedFindingIds],
  )
  const settledFindingIds = useMemo(
    () => new Set(conflict.settledFindingIds),
    [conflict.settledFindingIds],
  )

  const blockedReasonFor = useCallback(
    (finding: VaultAuditFinding): VaultAuditConflictBlockReason | null => {
      if (finding.resolution !== 'choose-a-side') return null
      if (FILE_SCOPE_FIELDS.has(finding.field)) return null

      const localFile = findLocalFile(finding, loadedFiles)
      return localFile?.pdmData && isRecord(localFile.pdmData.custom_properties)
        ? null
        : 'file-not-loaded'
    },
    [loadedFiles],
  )

  const canAdoptFileValue = useCallback(
    (finding: VaultAuditFinding) =>
      finding.resolution === 'choose-a-side' &&
      finding.fileValue !== null &&
      blockedReasonFor(finding) === null,
    [blockedReasonFor],
  )

  const selectedFindings = useMemo(
    () =>
      findings.filter(
        (finding) => selectedFindingIds.has(finding.id) && canAdoptFileValue(finding),
      ),
    [findings, selectedFindingIds, canAdoptFileValue],
  )

  const setMany = useCallback(
    (findingIds: readonly string[], shouldSelect: boolean) => {
      const next = new Set(conflict.selectedFindingIds)
      for (const id of findingIds) {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      }
      setSelection([...next])
    },
    [conflict.selectedFindingIds, setSelection],
  )

  const apply = useCallback(async () => {
    if (usePDMStore.getState().vaultAuditConflict.applying) return
    if (!user?.id) {
      finishConflict({ error: t('vaultAudit.conflict.noUser') })
      return
    }

    const groups = buildWriteGroups(findings, selectedFindingIds, loadedFiles)
    if (groups.length === 0) return

    startConflict()
    const settled: string[] = []
    const errors: string[] = []

    for (const group of groups) {
      try {
        const result = await syncSolidWorksFileMetadata(group.fileId, user.id, group.metadata)
        if (result.success) {
          settled.push(...group.findingIds)
        } else {
          errors.push(
            `${group.relativePath}: ${result.error ?? t('vaultAudit.conflict.updateFailed')}`,
          )
        }
      } catch (error) {
        errors.push(
          `${group.relativePath}: ${
            error instanceof Error ? error.message : t('vaultAudit.conflict.updateFailed')
          }`,
        )
      }
    }

    const error = errors.length > 0 ? errors.join(' ') : null
    finishConflict({ settledFindingIds: settled, error })

    if (settled.length > 0) {
      addToast(
        errors.length > 0 ? 'warning' : 'success',
        t('vaultAudit.conflict.appliedToast', { values: settled.length }),
      )
    }

    if (errors.length > 0) {
      log.error('[VaultAudit]', 'Conflict choices could not all be applied', {
        settled: settled.length,
        failed: errors.length,
      })
    }
  }, [addToast, finishConflict, findings, loadedFiles, selectedFindingIds, startConflict, user?.id])

  return {
    selectedFindingIds,
    settledFindingIds,
    selectedCount: selectedFindings.length,
    applying: conflict.applying,
    error: conflict.error,
    canApply: !conflict.applying && selectedFindings.length > 0,
    canAdoptFileValue,
    blockedReasonFor,
    setMany,
    apply,
  }
}
