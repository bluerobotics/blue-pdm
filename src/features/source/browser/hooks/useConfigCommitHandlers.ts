import { useCallback } from 'react'

import { beginWatcherSuppression } from '@/lib/fileWatcherSuppression'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { reportMetadataWrite } from '@/lib/metadata/reportMetadataWrite'
import {
  beginMetadataWrite,
  configurationWriteKey,
  endMetadataWrite,
} from '@/lib/metadata/writeInFlight'
import { writeMetadataWithVerification } from '@/lib/metadata/writeMetadataToFile'
import { refreshLocalFileFacts } from '@/lib/refreshLocalFileFacts'
import { getSerializationSettings } from '@/lib/serialization'
import { getTabValidationOptions } from '@/lib/tabValidation'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import type { PendingMetadata, PendingMetadataEdit } from '@/stores/types'
import type { MetadataWriteAddress, MetadataWriteState } from '@/lib/metadata/writeState'
import type { PlanSerialization } from '@/lib/metadata/writePlan'
import {
  checkOutConfigDrawings,
  prepareConfigDrawingUpdate,
  syncConfigDrawings,
  type ConfigDrawingUpdatePlan,
} from './useConfigDrawingUpdate'
import { buildConfigurationCommitWritePlan } from './configWritePlan'
import type { ConfigDrawingCheckoutConfirmState, UseDialogStateReturn } from './useDialogState'

type ToastType = 'success' | 'error' | 'info' | 'warning'
type CommitMode = 'update-drawings' | 'model-only'

const DIRTY_WRITE_STATES: ReadonlySet<MetadataWriteState> = new Set(['pending', 'failed'])

export interface ConfigCommitHandlersDeps {
  setConfigDrawingCheckoutConfirm: UseDialogStateReturn['setConfigDrawingCheckoutConfirm']
}

export interface UseConfigCommitHandlersReturn {
  commitConfigurationEdits: (file: LocalFile, configNames: string[]) => Promise<void>
}

function hasConfigurationValue(
  values: Record<string, string> | undefined,
  configuration: string,
): boolean {
  return values !== undefined && Object.prototype.hasOwnProperty.call(values, configuration)
}

function configurationDirtyAddresses(
  file: LocalFile,
  configuration: string,
): MetadataWriteAddress[] {
  const addresses: MetadataWriteAddress[] = []
  const pending = file.pendingMetadata
  const state = file.metadataWriteState

  const candidates: MetadataWriteAddress[] = []
  if (hasConfigurationValue(pending?.config_tabs, configuration)) {
    candidates.push({ scope: 'configuration', field: 'config_tab', configuration })
  }
  if (hasConfigurationValue(pending?.config_descriptions, configuration)) {
    candidates.push({ scope: 'configuration', field: 'config_description', configuration })
  }

  for (const address of candidates) {
    const entry =
      address.field === 'config_tab'
        ? state?.config_tabs?.[configuration]
        : state?.config_descriptions?.[configuration]
    const writeState = entry?.state ?? 'pending'
    if (DIRTY_WRITE_STATES.has(writeState)) addresses.push(address)
  }

  return addresses
}

/** Whether a configuration still has an edit that this action can write to SolidWorks. */
export function isConfigurationDirty(file: LocalFile, configuration: string): boolean {
  return configurationDirtyAddresses(file, configuration).length > 0
}

function pendingEditForConfiguration(
  file: LocalFile,
  configuration: string,
  addresses: readonly MetadataWriteAddress[],
): PendingMetadataEdit {
  const pending: PendingMetadata = {}
  const fields: PendingMetadataEdit['fields'] = []

  for (const address of addresses) {
    if (address.field === 'config_tab') {
      const value = file.pendingMetadata?.config_tabs?.[configuration] ?? ''
      pending.config_tabs = { [configuration]: value }
      fields.push('config_tabs')
    } else {
      const value = file.pendingMetadata?.config_descriptions?.[configuration] ?? ''
      pending.config_descriptions = { [configuration]: value }
      fields.push('config_descriptions')
    }
  }

  return {
    path: file.path,
    fields: [...new Set(fields)],
    pending,
  }
}

async function readPlanSerialization(
  organizationId: string | undefined,
): Promise<PlanSerialization | null> {
  if (!organizationId) return null
  const settings = await getSerializationSettings(organizationId)
  if (!settings) return null
  return {
    tabEnabled: !!settings.tab_enabled,
    settings,
    validation: getTabValidationOptions(settings),
  }
}

function writeParity(): { date: string; drawnBy: string } {
  const user = usePDMStore.getState().user
  return {
    date: new Date().toISOString().split('T')[0],
    drawnBy: user?.full_name || user?.email || '',
  }
}

function addressesMatch(left: MetadataWriteAddress, right: MetadataWriteAddress): boolean {
  if (left.scope !== right.scope || left.field !== right.field) return false
  if (left.scope === 'configuration' && right.scope === 'configuration') {
    return left.configuration === right.configuration
  }
  return true
}

function allAddressesAccepted(
  expected: readonly MetadataWriteAddress[],
  actual: readonly { address: MetadataWriteAddress; state: MetadataWriteState }[],
): boolean {
  return (
    expected.length > 0 &&
    expected.every((address) =>
      actual.some(
        (entry) =>
          addressesMatch(address, entry.address) &&
          (entry.state === 'verified' || entry.state === 'unverified'),
      ),
    )
  )
}

function hasRejectedAddress(
  expected: readonly MetadataWriteAddress[],
  actual: readonly { address: MetadataWriteAddress; state: MetadataWriteState }[],
): boolean {
  return expected.some((address) => {
    const result = actual.find((entry) => addressesMatch(address, entry.address))
    return result === undefined || result.state === 'failed' || result.state === 'unattempted'
  })
}

function countPlanDrawings(plan: ConfigDrawingUpdatePlan): number {
  return plan.mine.length + plan.available.length + plan.blocked.length + plan.unresolved.length
}

function uniqueFiles(files: LocalFile[]): LocalFile[] {
  return [...new Map(files.map((file) => [file.path, file])).values()]
}

function showCommitSummary(
  addToast: (type: ToastType, message: string) => void,
  configurationsWritten: number,
  drawingsUpdated: number,
  drawingsSkipped: number,
  failed: number,
): void {
  addToast(
    failed > 0 ? 'warning' : 'success',
    t('source.configCommit.summary', {
      configurations: configurationsWritten,
      written: configurationsWritten,
      updated: drawingsUpdated,
      skipped: drawingsSkipped,
      failed,
    }),
  )
}

export function useConfigCommitHandlers(
  deps: ConfigCommitHandlersDeps,
): UseConfigCommitHandlersReturn {
  const { setConfigDrawingCheckoutConfirm } = deps

  const commitConfigurationEdits = useCallback(
    async (file: LocalFile, configNames: string[]): Promise<void> => {
      const state = usePDMStore.getState()
      const currentFile = state.files.find((candidate) => candidate.path === file.path) ?? file
      const uniqueConfigNames = [...new Set(configNames)]
      const dirtyConfigNames = uniqueConfigNames.filter((configuration) =>
        isConfigurationDirty(currentFile, configuration),
      )

      if (dirtyConfigNames.length === 0) return

      const solidWorksStatus = state.integrations.solidworks.status
      if (solidWorksStatus !== 'online' && solidWorksStatus !== 'partial') {
        state.addToast('error', t('source.configCommit.swOffline'))
        return
      }

      let plan: ConfigDrawingUpdatePlan
      try {
        plan = await prepareConfigDrawingUpdate({
          file: currentFile,
          configNames: dirtyConfigNames,
        })
      } catch (error) {
        log.error('[ConfigCommit]', 'Failed to prepare configuration drawing update', {
          filePath: currentFile.path,
          configNames: dirtyConfigNames,
          error,
        })
        showCommitSummary(state.addToast, 0, 0, 0, dirtyConfigNames.length)
        return
      }

      const runCommit = async (mode: CommitMode): Promise<void> => {
        let checkedOut: LocalFile[] = []
        let drawingsFailed = 0
        let drawingsSkipped =
          mode === 'model-only'
            ? countPlanDrawings(plan)
            : plan.blocked.length + plan.unresolved.length

        if (mode === 'update-drawings') {
          try {
            const checkoutResult = await checkOutConfigDrawings(plan)
            checkedOut = checkoutResult.checkedOut
            drawingsFailed += checkoutResult.failed.length
          } catch (error) {
            log.error('[ConfigCommit]', 'Failed to check out configuration drawings', {
              filePath: currentFile.path,
              error,
            })
            drawingsFailed += plan.available.length
          }
        }

        let serialization = null
        try {
          serialization = await readPlanSerialization(usePDMStore.getState().organization?.id)
        } catch (error) {
          log.error('[ConfigCommit]', 'Failed to read serialization settings', {
            filePath: currentFile.path,
            error,
          })
        }
        const parity = writeParity()
        let useLiveApi = false
        try {
          const openResult = await window.electronAPI?.solidworks?.isDocumentOpen?.(
            currentFile.path,
          )
          useLiveApi = !!(openResult?.success && openResult.data?.isOpen)
        } catch (error) {
          log.debug('[ConfigCommit]', 'Could not determine whether the model is open', {
            filePath: currentFile.path,
            error,
          })
        }
        let configurationsWritten = 0
        let configurationFailures = 0

        for (const configuration of dirtyConfigNames) {
          const latestFile =
            usePDMStore.getState().files.find((candidate) => candidate.path === currentFile.path) ??
            currentFile
          const addresses = configurationDirtyAddresses(latestFile, configuration)
          if (addresses.length === 0) continue

          const edit = pendingEditForConfiguration(latestFile, configuration, addresses)
          const documentTabNumber = usePDMStore
            .getState()
            .fileConfigurations.get(latestFile.path)
            ?.find((candidate) => candidate.name === configuration)?.tabNumber
          const inFlightKey = configurationWriteKey(latestFile.path, configuration)
          const releaseWatcher = beginWatcherSuppression([latestFile.relativePath])
          beginMetadataWrite(inFlightKey)

          try {
            const groups = buildConfigurationCommitWritePlan({
              file: latestFile,
              configuration,
              documentTabNumber,
              serialization,
              parity,
            })
            if (groups.length === 0) {
              configurationFailures++
              log.warn('[ConfigCommit]', 'No writable metadata plan for dirty configuration', {
                filePath: latestFile.path,
                configuration,
              })
              continue
            }

            const result = await writeMetadataWithVerification({
              path: latestFile.path,
              groups,
              useLiveApi,
            })
            reportMetadataWrite(edit, result)
            const accepted = allAddressesAccepted(addresses, result.addresses)
            const rejected = hasRejectedAddress(addresses, result.addresses)
            if (accepted) configurationsWritten++
            if (!accepted || rejected) configurationFailures++

            if (result.outcome === 'verified' || result.outcome === 'unverified') {
              await refreshLocalFileFacts(latestFile)
            }
          } catch (error) {
            configurationFailures++
            log.error('[ConfigCommit]', 'Failed to write configuration metadata', {
              filePath: latestFile.path,
              configuration,
              error,
            })
            reportMetadataWrite(edit, {
              outcome: 'failed',
              addresses: addresses.map((address) => ({
                address,
                state: 'failed' as const,
                reason: error instanceof Error ? error.message : String(error),
              })),
            })
          } finally {
            releaseWatcher()
            endMetadataWrite(inFlightKey)
          }
        }

        let drawingsUpdated = 0
        if (mode === 'update-drawings') {
          const drawings = uniqueFiles([...plan.mine, ...checkedOut])
          const modelWriteSucceeded =
            configurationFailures === 0 && configurationsWritten === dirtyConfigNames.length
          if (!modelWriteSucceeded) {
            drawingsSkipped += drawings.length
          } else if (drawings.length > 0) {
            try {
              const syncResult = await syncConfigDrawings(drawings)
              drawingsUpdated = syncResult.updated
              drawingsFailed += syncResult.failed
            } catch (error) {
              drawingsFailed += drawings.length
              log.error('[ConfigCommit]', 'Failed to sync configuration drawings', {
                filePath: currentFile.path,
                drawingCount: drawings.length,
                error,
              })
            }
          }
        }

        showCommitSummary(
          usePDMStore.getState().addToast,
          configurationsWritten,
          drawingsUpdated,
          drawingsSkipped,
          drawingsFailed + configurationFailures,
        )
      }

      if (
        plan.available.length > 0 ||
        plan.blocked.length > 0 ||
        plan.unresolved.length > 0
      ) {
        const dialogState: ConfigDrawingCheckoutConfirmState = {
          plan,
          onCheckOutAndUpdate: () => {
            setConfigDrawingCheckoutConfirm(null)
            void runCommit('update-drawings')
          },
          onForceModelOnly: () => {
            setConfigDrawingCheckoutConfirm(null)
            void runCommit('model-only')
          },
        }
        setConfigDrawingCheckoutConfirm(dialogState)
        return
      }

      await runCommit('update-drawings')
    },
    [setConfigDrawingCheckoutConfirm],
  )

  return { commitConfigurationEdits }
}
