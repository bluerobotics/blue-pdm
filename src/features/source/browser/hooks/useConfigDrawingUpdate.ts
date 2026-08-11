import { useCallback } from 'react'

import { findLocalFileByPath } from '@/features/source/browser/utils/localFileLookup'
import { deriveCheckoutDisplay } from '@/lib/checkout/checkoutDisplay'
import { executeCommand } from '@/lib/commands/executor'
import { t } from '@/lib/i18n'
import { sleep } from '@/lib/network'
import { log } from '@/lib/logger'
import {
  confirmConfigDrawingsWithSolidWorks,
  loadConfigDrawingsFromDatabase,
} from '@/lib/solidworks/configDrawingLookup'
import { usePDMStore } from '@/stores/pdmStore'
import type { DrawingRefItem, LocalFile } from '@/stores/types'

import { getFileStatus } from './useFileStatus'
import { useDrawingRefHandlers } from './useDrawingRefHandlers'

const DRAWING_EXTENSION = '.slddrw'
const CLOUD_ONLY_DIFF_STATUS = 'cloud'
const DELETED_DIFF_STATUS = 'deleted'
const CHECKOUT_STATUS_POLL_INTERVAL_MS = 100
const CHECKOUT_STATUS_TIMEOUT_MS = 30_000
const CONFIG_DRAWING_LOAD_POLL_INTERVAL_MS = 100
const CONFIG_DRAWING_LOAD_TIMEOUT_MS = 30_000

export interface ConfigDrawingUpdatePlan {
  mine: LocalFile[]
  available: LocalFile[]
  blocked: { file: LocalFile; holderName: string }[]
  unresolved: DrawingRefItem[]
}

export interface ConfigDrawingUpdateActions {
  prepareConfigDrawingUpdate: (args: {
    file: LocalFile
    configNames: string[]
  }) => Promise<ConfigDrawingUpdatePlan>
  checkOutConfigDrawings: (
    plan: ConfigDrawingUpdatePlan,
  ) => Promise<{ checkedOut: LocalFile[]; failed: LocalFile[] }>
  syncConfigDrawings: (drawings: LocalFile[]) => Promise<{ updated: number; failed: number }>
}

type ConfigDrawingLoader = (file: LocalFile, configName: string) => Promise<void>

function normalizePath(path: string): string {
  return path.toLowerCase().replace(/\\/g, '/')
}

function isAssemblyFile(file: LocalFile): boolean {
  return !file.isDirectory && file.extension.toLowerCase() === '.sldasm'
}

function isDrawingFile(file: LocalFile): boolean {
  return !file.isDirectory && file.extension.toLowerCase() === DRAWING_EXTENSION
}

function isLocallySynced(file: LocalFile): boolean {
  return (
    Boolean(file.pdmData?.id) &&
    file.diffStatus !== CLOUD_ONLY_DIFF_STATUS &&
    file.diffStatus !== DELETED_DIFF_STATUS
  )
}

function isDrawingItem(item: DrawingRefItem): boolean {
  return (
    item.file_type === 'drawing' ||
    item.file_name.toLowerCase().endsWith(DRAWING_EXTENSION) ||
    item.file_path.toLowerCase().endsWith(DRAWING_EXTENSION)
  )
}

function getConfigKey(file: LocalFile, configName: string): string {
  return `${file.path}::${configName}`
}

function getConfigNames(configNames: string[]): string[] {
  return Array.from(new Set(configNames.filter((configName) => configName.length > 0)))
}

function ensureConfigSectionVisible(file: LocalFile, configName: string): void {
  const configKey = getConfigKey(file, configName)
  const state = usePDMStore.getState()
  if (!state.expandedConfigSections.has(configKey)) {
    state.toggleConfigSectionsExpansion(configKey)
  }
}

function ensureDrawingGroupVisible(file: LocalFile, configName: string): void {
  const configKey = getConfigKey(file, configName)
  const state = usePDMStore.getState()
  if (!state.expandedConfigDrawings.has(configKey)) {
    state.toggleConfigDrawingExpansion(configKey)
  }
}

function getFreshFile(file: LocalFile): LocalFile | undefined {
  const files = usePDMStore.getState().files
  return files.find((candidate) => candidate.path === file.path) || findLocalFileByPath(file.path, files)
}

function resolveDrawingFile(item: DrawingRefItem, files: LocalFile[]): LocalFile | undefined {
  const localFile = findLocalFileByPath(item.file_path, files)
  return localFile && isDrawingFile(localFile) ? localFile : undefined
}

function getDrawingIdentity(item: DrawingRefItem): string {
  const path = normalizePath(item.file_path)
  return path || item.file_id || item.id
}

function unionDrawingItems(
  target: Map<string, DrawingRefItem>,
  items: DrawingRefItem[],
): void {
  for (const item of items) {
    if (!isDrawingItem(item)) continue

    const key = getDrawingIdentity(item)
    const existing = target.get(key)
    if (!existing || (item.configurationConfirmed && !existing.configurationConfirmed)) {
      target.set(key, item)
    }
  }
}

function addUniqueFile(target: Map<string, LocalFile>, file: LocalFile): void {
  target.set(normalizePath(file.path), file)
}

function getHolderName(file: LocalFile): string {
  const display = deriveCheckoutDisplay(file, usePDMStore.getState().user)
  return (
    display.displayName ||
    file.pdmData?.checked_out_by ||
    t('checkoutDisplay.ownerUnavailable', 'Checkout owner unavailable')
  )
}

function partitionDrawingItems(items: DrawingRefItem[], files: LocalFile[]): ConfigDrawingUpdatePlan {
  const user = usePDMStore.getState().user
  const mine = new Map<string, LocalFile>()
  const available = new Map<string, LocalFile>()
  const blocked = new Map<string, { file: LocalFile; holderName: string }>()
  const unresolved = new Map<string, DrawingRefItem>()

  for (const item of items) {
    const localFile = resolveDrawingFile(item, files)
    if (!localFile) {
      unresolved.set(getDrawingIdentity(item), item)
      continue
    }

    const status = getFileStatus(localFile, user?.id)
    const fileKey = normalizePath(localFile.path)

    if (status.isLocalOnly || status.isCheckedOutByMe) {
      addUniqueFile(mine, localFile)
    } else if (status.isCheckedOutByOthers) {
      blocked.set(fileKey, {
        file: localFile,
        holderName: getHolderName(localFile),
      })
    } else if (isLocallySynced(localFile)) {
      addUniqueFile(available, localFile)
    } else {
      unresolved.set(getDrawingIdentity(item), item)
    }
  }

  return {
    mine: Array.from(mine.values()),
    available: Array.from(available.values()),
    blocked: Array.from(blocked.values()),
    unresolved: Array.from(unresolved.values()),
  }
}

async function waitForConfigDrawingLoad(configKey: string): Promise<void> {
  const deadline = Date.now() + CONFIG_DRAWING_LOAD_TIMEOUT_MS

  while (Date.now() < deadline) {
    const state = usePDMStore.getState()
    if (state.configDrawingData.has(configKey) || !state.loadingConfigDrawings.has(configKey)) {
      return
    }
    await sleep(CONFIG_DRAWING_LOAD_POLL_INTERVAL_MS)
  }

  log.warn('[ConfigDrawingUpdate]', 'Timed out waiting for config drawing load', { configKey })
}

/**
 * Standalone fallback for callers outside React. The React hook below delegates to the existing
 * drawing-reference handler, while this implementation uses the same shared two-phase lookup
 * primitives for command and test callers that cannot invoke a React hook.
 */
async function loadConfigDrawingsStandalone(file: LocalFile, configName: string): Promise<void> {
  const configKey = getConfigKey(file, configName)
  const initialState = usePDMStore.getState()
  if (initialState.configDrawingData.has(configKey)) return

  if (initialState.loadingConfigDrawings.has(configKey)) {
    await waitForConfigDrawingLoad(configKey)
    return
  }

  ensureDrawingGroupVisible(file, configName)
  usePDMStore.getState().addLoadingConfigDrawing(configKey)

  try {
    let dbItems: DrawingRefItem[] = []
    const fileId = file.pdmData?.id

    if (fileId) {
      const databaseResult = await loadConfigDrawingsFromDatabase(fileId, configName)
      if (databaseResult.error) {
        log.warn('[ConfigDrawingUpdate]', 'Failed to load config drawings from database', {
          configKey,
          error: databaseResult.error,
        })
      } else {
        dbItems = databaseResult.items
        const state = usePDMStore.getState()
        if (
          state.expandedConfigSections.has(configKey) &&
          state.expandedConfigDrawings.has(configKey)
        ) {
          state.setConfigDrawingData(configKey, dbItems)
        }
      }
    }

    const liveResult = await confirmConfigDrawingsWithSolidWorks({
      file,
      configName,
      files: usePDMStore.getState().files,
      dbItems,
    })
    const state = usePDMStore.getState()
    if (state.expandedConfigSections.has(configKey) && state.expandedConfigDrawings.has(configKey)) {
      state.setConfigDrawingData(configKey, liveResult.items)
    }
  } catch (error) {
    log.error('[ConfigDrawingUpdate]', 'Exception loading config drawings', {
      configKey,
      error,
    })
  } finally {
    usePDMStore.getState().removeLoadingConfigDrawing(configKey)
  }
}

async function loadConfigDrawingsThroughHandler(
  file: LocalFile,
  configName: string,
  toggleConfigDrawingExpansion: (file: LocalFile, configName: string) => Promise<void>,
): Promise<void> {
  const configKey = getConfigKey(file, configName)
  const state = usePDMStore.getState()
  if (state.configDrawingData.has(configKey)) return

  if (state.loadingConfigDrawings.has(configKey)) {
    await waitForConfigDrawingLoad(configKey)
    return
  }

  await toggleConfigDrawingExpansion(file, configName)
}

async function prepareConfigDrawingUpdateWithLoader(
  args: { file: LocalFile; configNames: string[] },
  loadMissing: ConfigDrawingLoader,
): Promise<ConfigDrawingUpdatePlan> {
  const configNames = getConfigNames(args.configNames)

  // Make every requested row visible before the first database or SolidWorks read starts.
  for (const configName of configNames) {
    ensureConfigSectionVisible(args.file, configName)
  }

  for (const configName of configNames) {
    const configKey = getConfigKey(args.file, configName)
    const state = usePDMStore.getState()

    if (state.configDrawingData.has(configKey)) {
      if (isAssemblyFile(args.file)) {
        ensureDrawingGroupVisible(args.file, configName)
      }
      continue
    }

    await loadMissing(args.file, configName)
  }

  const items = new Map<string, DrawingRefItem>()
  const state = usePDMStore.getState()
  for (const configName of configNames) {
    unionDrawingItems(items, state.configDrawingData.get(getConfigKey(args.file, configName)) || [])
  }

  return partitionDrawingItems(Array.from(items.values()), state.files)
}

export async function prepareConfigDrawingUpdate(args: {
  file: LocalFile
  configNames: string[]
}): Promise<ConfigDrawingUpdatePlan> {
  return prepareConfigDrawingUpdateWithLoader(args, loadConfigDrawingsStandalone)
}

function hasMatchingPath(paths: string[], file: LocalFile): boolean {
  const normalizedPaths = new Set([normalizePath(file.path), normalizePath(file.relativePath)])
  return paths.some((path) => normalizedPaths.has(normalizePath(path)))
}

function hasActiveOperationForFile(file: LocalFile): boolean {
  const state = usePDMStore.getState()
  const queued = state.operationQueue.some((operation) => hasMatchingPath(operation.paths, file))
  const running = state.currentOperation ? hasMatchingPath(state.currentOperation.paths, file) : false
  const processing = Array.from(state.processingOperations.entries()).some(
    ([path]) => hasMatchingPath([path], file),
  )
  return queued || running || processing
}

async function waitForCheckoutResult(
  file: LocalFile,
  userId: string,
  previousCompletionAt: number,
): Promise<LocalFile | undefined> {
  const deadline = Date.now() + CHECKOUT_STATUS_TIMEOUT_MS
  let observedOperation = false

  while (Date.now() < deadline) {
    const currentFile = getFreshFile(file)
    if (currentFile && getFileStatus(currentFile, userId).isCheckedOutByMe) {
      return currentFile
    }

    const state = usePDMStore.getState()
    const operationActive = hasActiveOperationForFile(file)
    observedOperation ||= operationActive

    if (
      state.lastOperationCompletedAt > previousCompletionAt &&
      (observedOperation || !operationActive)
    ) {
      return undefined
    }

    await sleep(CHECKOUT_STATUS_POLL_INTERVAL_MS)
  }

  const finalFile = getFreshFile(file)
  return finalFile && getFileStatus(finalFile, userId).isCheckedOutByMe ? finalFile : undefined
}

export async function checkOutConfigDrawings(plan: ConfigDrawingUpdatePlan): Promise<{
  checkedOut: LocalFile[]
  failed: LocalFile[]
}> {
  const requested = new Map<string, LocalFile>()
  for (const file of plan.available) {
    if (isDrawingFile(file)) addUniqueFile(requested, file)
  }

  const checkedOut: LocalFile[] = []
  const failed: LocalFile[] = []
  const userId = usePDMStore.getState().user?.id

  if (!userId) {
    return { checkedOut, failed: Array.from(requested.values()) }
  }

  for (const requestedFile of requested.values()) {
    const currentFile = getFreshFile(requestedFile) || requestedFile
    const status = getFileStatus(currentFile, userId)

    if (status.isCheckedOutByMe) {
      checkedOut.push(currentFile)
      continue
    }

    if (status.isLocalOnly) {
      checkedOut.push(currentFile)
      continue
    }

    if (!isLocallySynced(currentFile) || status.isCheckedOutByOthers) {
      failed.push(requestedFile)
      continue
    }

    const previousCompletionAt = usePDMStore.getState().lastOperationCompletedAt
    try {
      const result = await executeCommand('checkout', { files: [currentFile] })
      if (!result.success) {
        failed.push(requestedFile)
        continue
      }

      const checkedOutFile = await waitForCheckoutResult(
        currentFile,
        userId,
        previousCompletionAt,
      )
      if (checkedOutFile) checkedOut.push(checkedOutFile)
      else failed.push(requestedFile)
    } catch (error) {
      log.error('[ConfigDrawingUpdate]', 'Exception checking out config drawing', {
        filePath: requestedFile.path,
        error,
      })
      failed.push(requestedFile)
    }
  }

  return { checkedOut, failed }
}

export async function syncConfigDrawings(drawings: LocalFile[]): Promise<{
  updated: number
  failed: number
}> {
  const requested = new Map<string, LocalFile>()
  for (const file of drawings) {
    if (isDrawingFile(file)) addUniqueFile(requested, file)
  }

  const eligible: LocalFile[] = []
  let ineligibleCount = 0
  const userId = usePDMStore.getState().user?.id

  for (const requestedFile of requested.values()) {
    const currentFile = getFreshFile(requestedFile) || requestedFile
    const status = getFileStatus(currentFile, userId)
    if (status.isLocalOnly || status.isCheckedOutByMe) {
      eligible.push(currentFile)
    } else {
      ineligibleCount++
    }
  }

  if (eligible.length === 0) {
    return { updated: 0, failed: ineligibleCount }
  }

  try {
    const result = await executeCommand('sync-metadata', { files: eligible })
    const updated = Math.max(0, Math.min(result.succeeded, eligible.length))
    const commandFailed = Math.max(result.failed, eligible.length - updated)
    return {
      updated,
      failed: ineligibleCount + commandFailed,
    }
  } catch (error) {
    log.error('[ConfigDrawingUpdate]', 'Exception syncing config drawings', {
      fileCount: eligible.length,
      error,
    })
    return {
      updated: 0,
      failed: ineligibleCount + eligible.length,
    }
  }
}

export function useConfigDrawingUpdate(): ConfigDrawingUpdateActions {
  const files = usePDMStore((state) => state.files)
  const addToast = usePDMStore((state) => state.addToast)
  const { toggleConfigDrawingExpansion } = useDrawingRefHandlers({ files, addToast })

  const prepare = useCallback(
    (args: { file: LocalFile; configNames: string[] }) =>
      prepareConfigDrawingUpdateWithLoader(args, (file, configName) =>
        loadConfigDrawingsThroughHandler(file, configName, toggleConfigDrawingExpansion),
      ),
    [toggleConfigDrawingExpansion],
  )

  return {
    prepareConfigDrawingUpdate: prepare,
    checkOutConfigDrawings,
    syncConfigDrawings,
  }
}
