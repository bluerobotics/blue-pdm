import { useMemo } from 'react'

import { matchesSerialFormat } from '@/lib/serialization'
import type { SerializationSettings } from '@/lib/serialization'
import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'
import {
  DEFAULT_ASSEMBLY_DESIGNATION,
  DEFAULT_PART_DESIGNATION,
} from '@/types/item'
import type {
  ItemDefinitionSettings,
  ItemDesignation,
  ItemFileType,
  ItemRow,
  ItemWorkflowStage,
} from '@/types/item'

// Priority used to pick the "primary" file of an item group for rolled-up
// description / revision / workflow stage. Lower index = higher priority.
const TYPE_PRIORITY: ItemFileType[] = ['part', 'assembly', 'drawing', 'step', 'pdf', 'other']

function typeRank(type: ItemFileType | undefined): number {
  if (!type) return TYPE_PRIORITY.length
  const index = TYPE_PRIORITY.indexOf(type)
  return index === -1 ? TYPE_PRIORITY.length : index
}

// Display order for the expandable sub-rows: always assembly -> part -> drawing,
// then everything else. Lower rank = shown first.
const SUBROW_TYPE_ORDER: Record<string, number> = { assembly: 0, part: 1, drawing: 2 }

function subRowRank(type: string | undefined): number {
  if (!type) return 3
  return SUBROW_TYPE_ORDER[type] ?? 3
}

function getPartNumber(file: LocalFile): string | null {
  const pending = file.pendingMetadata?.part_number
  if (pending !== undefined && pending !== null) {
    return pending.trim() || null
  }
  const value = file.pdmData?.part_number
  return value ? value.trim() || null : null
}

function fileQualifies(
  file: LocalFile,
  definition: ItemDefinitionSettings,
): boolean {
  if (file.isDirectory) return false
  const pdm = file.pdmData
  if (!pdm) return false

  if (definition.requirePartNumber && !getPartNumber(file)) return false

  if (!definition.anyStage) {
    const stateId = pdm.workflow_state_id
    if (!stateId || !definition.workflowStageIds.includes(stateId)) return false
  }

  if (!definition.anyType) {
    if (!definition.fileTypes.includes(pdm.file_type)) return false
  }

  return true
}

function resolveStage(
  pdm: PDMFile,
  stagesById: Map<string, ItemWorkflowStage>,
): { name: string | null; color: string | null } {
  if (pdm.workflow_state) {
    return { name: pdm.workflow_state.name, color: pdm.workflow_state.color }
  }
  if (pdm.workflow_state_id) {
    const stage = stagesById.get(pdm.workflow_state_id)
    if (stage) return { name: stage.name, color: stage.color }
  }
  // Fall back to legacy state text if present on the record
  const legacyState = (pdm as unknown as { state?: string | null }).state
  return { name: legacyState ?? null, color: null }
}

/**
 * Derive the definitive list of items (unique part numbers) from the in-memory
 * vault files, applying the org item definition and grouping by part number.
 */
export function useItems(
  files: LocalFile[],
  definition: ItemDefinitionSettings,
  stages: ItemWorkflowStage[],
  serializationSettings?: SerializationSettings | null,
  designations: ItemDesignation[] = [],
  designationAssignments: Map<string, string> = new Map(),
): ItemRow[] {
  return useMemo(() => {
    const stagesById = new Map<string, ItemWorkflowStage>()
    for (const stage of stages) stagesById.set(stage.id, stage)

    const designationById = new Map<string, ItemDesignation>()
    const designationByName = new Map<string, ItemDesignation>()
    for (const designation of designations) {
      designationById.set(designation.id, designation)
      designationByName.set(designation.name.toLowerCase(), designation)
    }

    // Resolve an item's designation: an explicit override wins, otherwise the
    // default is derived from file types (assembly -> Assembly, else Part).
    const resolveDesignation = (
      itemNumber: string,
      fileTypes: ItemFileType[],
    ): { designation: string | null; designationId: string | null; isOverride: boolean } => {
      const overrideId = designationAssignments.get(itemNumber)
      if (overrideId) {
        const match = designationById.get(overrideId)
        return {
          designation: match?.name ?? null,
          designationId: overrideId,
          isOverride: true,
        }
      }
      const derivedName = fileTypes.includes('assembly')
        ? DEFAULT_ASSEMBLY_DESIGNATION
        : DEFAULT_PART_DESIGNATION
      const match = designationByName.get(derivedName.toLowerCase())
      return {
        designation: match?.name ?? derivedName,
        designationId: match?.id ?? null,
        isOverride: false,
      }
    }

    // Only enforce the org part-number format when requested and serialization
    // is actually configured/enabled for the org.
    const enforceFormat =
      definition.matchOrgFormat && Boolean(serializationSettings?.enabled)

    const groups = new Map<string, LocalFile[]>()
    for (const file of files) {
      if (!fileQualifies(file, definition)) continue
      const itemNumber = getPartNumber(file)
      if (!itemNumber) continue
      if (enforceFormat && !matchesSerialFormat(itemNumber, serializationSettings!)) continue
      const existing = groups.get(itemNumber)
      if (existing) existing.push(file)
      else groups.set(itemNumber, [file])
    }

    const rows: ItemRow[] = []
    for (const [itemNumber, groupFiles] of groups) {
      const pdmFiles = groupFiles
        .map((f) => f.pdmData)
        .filter((p): p is PDMFile => Boolean(p))

      // Order sub-rows deterministically: assembly -> part -> drawing -> other,
      // then alphabetically by file name within each type.
      pdmFiles.sort((a, b) => {
        const rankDiff = subRowRank(a.file_type) - subRowRank(b.file_type)
        if (rankDiff !== 0) return rankDiff
        return (a.file_name ?? '').localeCompare(b.file_name ?? '', undefined, { numeric: true })
      })

      // Choose primary file: best type priority, then highest version
      const primary = [...groupFiles].sort((a, b) => {
        const rankDiff = typeRank(a.pdmData?.file_type) - typeRank(b.pdmData?.file_type)
        if (rankDiff !== 0) return rankDiff
        return (b.pdmData?.version ?? 0) - (a.pdmData?.version ?? 0)
      })[0]
      const primaryPdm = primary?.pdmData

      const description =
        pdmFiles.find((p) => p.description && p.description.trim())?.description ?? null

      const fileTypes = Array.from(
        new Set(pdmFiles.map((p) => p.file_type)),
      ) as ItemFileType[]

      const resolvedDesignation = resolveDesignation(itemNumber, fileTypes)

      const stage = primaryPdm
        ? resolveStage(primaryPdm, stagesById)
        : { name: null, color: null }

      let lastModified: string | null = null
      for (const file of groupFiles) {
        const candidate = file.modifiedTime ?? file.pdmData?.created_at ?? null
        if (candidate && (!lastModified || candidate > lastModified)) {
          lastModified = candidate
        }
      }

      rows.push({
        itemNumber,
        description,
        revision: primaryPdm?.revision ?? null,
        workflowStateName: stage.name,
        workflowStateColor: stage.color,
        fileTypes,
        fileCount: groupFiles.length,
        lastModified,
        files: pdmFiles,
        primaryFile: primary
          ? {
              name: primary.name,
              path: primary.path,
              relativePath: primary.relativePath,
              extension: primary.extension ?? '',
              isDirectory: primary.isDirectory ?? false,
            }
          : null,
        designation: resolvedDesignation.designation,
        designationId: resolvedDesignation.designationId,
        designationIsOverride: resolvedDesignation.isOverride,
      })
    }

    rows.sort((a, b) => a.itemNumber.localeCompare(b.itemNumber, undefined, { numeric: true }))
    return rows
  }, [files, definition, stages, serializationSettings, designations, designationAssignments])
}
