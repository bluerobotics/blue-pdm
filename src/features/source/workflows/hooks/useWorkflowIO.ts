// Import/Export operations for workflows
import { useCallback, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import type {
  WorkflowTemplate,
  WorkflowState,
  WorkflowTransition,
  WorkflowGate,
} from '@/types/workflow'

import { workflowService } from '../services'
import {
  buildExportPayload,
  parseWorkflowExport,
  type WorkflowExport,
  type ParseResult,
} from '../utils'

/** Pending import info for confirmation dialog */
export interface PendingImport {
  file: File
  payload: WorkflowExport
  stateCount: number
  transitionCount: number
  gateCount: number
}

interface UseWorkflowIOOptions {
  // Core data
  selectedWorkflow: WorkflowTemplate | null
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  gates: Record<string, WorkflowGate[]>
  isAdmin: boolean

  // Reload the canvas from the database once the import transaction commits
  reloadWorkflow: () => Promise<void>

  // Selection
  setSelectedStateId: (id: string | null) => void
  setSelectedTransitionId: (id: string | null) => void

  // Notifications
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
}

const INVALID_FILE_MESSAGES: Record<Exclude<ParseResult, { ok: true }>['reason'], string> = {
  'not-an-object': 'workflows.import.notAWorkflowFile',
  'no-states': 'workflows.import.noStates',
  'bad-state': 'workflows.import.badState',
  'bad-transition': 'workflows.import.badTransition',
}

export function useWorkflowIO(options: UseWorkflowIOOptions) {
  const {
    selectedWorkflow,
    states,
    transitions,
    gates,
    isAdmin,
    reloadWorkflow,
    setSelectedStateId,
    setSelectedTransitionId,
    addToast,
  } = options

  // File input ref for import
  const importInputRef = useRef<HTMLInputElement>(null)

  // Pending import state for confirmation dialog
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  /**
   * Export workflow to JSON file
   */
  const exportWorkflow = useCallback(() => {
    if (!selectedWorkflow) return

    const payload = buildExportPayload(selectedWorkflow, states, transitions, gates)

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflow-${selectedWorkflow.name.toLowerCase().replace(/\s+/g, '-')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    addToast('success', 'Workflow exported')
  }, [selectedWorkflow, states, transitions, gates, addToast])

  /**
   * Request import - validates the file and sets pending state for confirmation
   */
  const requestImport = useCallback(
    async (file: File) => {
      if (!selectedWorkflow || !isAdmin) return

      let raw: unknown
      try {
        raw = JSON.parse(await file.text())
      } catch (error) {
        log.error('[Workflow]', 'Failed to parse workflow file', { error })
        addToast('error', t('workflows.import.unreadableFile'))
        return
      }

      const result = parseWorkflowExport(raw)
      if (!result.ok) {
        addToast('error', t(INVALID_FILE_MESSAGES[result.reason]))
        return
      }

      setPendingImport({
        file,
        payload: result.payload,
        stateCount: result.payload.states.length,
        transitionCount: result.payload.transitions.length,
        gateCount: result.payload.transitions.reduce((sum, tr) => sum + tr.gates.length, 0),
      })
    },
    [selectedWorkflow, isAdmin, addToast],
  )

  /**
   * Confirm and execute import.
   *
   * The whole replacement happens in one database transaction, so a failure
   * leaves the existing workflow exactly as it was rather than half-wiped.
   */
  const confirmImport = useCallback(async () => {
    if (!selectedWorkflow || !isAdmin || !pendingImport) return

    setIsImporting(true)
    try {
      const { data, error } = await workflowService.importGraph(
        selectedWorkflow.id,
        pendingImport.payload,
      )
      if (error) throw error

      if (pendingImport.payload.workflow.canvas_config) {
        await workflowService.update(selectedWorkflow.id, {
          description: pendingImport.payload.workflow.description,
          canvas_config: pendingImport.payload.workflow.canvas_config,
        })
      }

      setSelectedStateId(null)
      setSelectedTransitionId(null)
      await reloadWorkflow()

      addToast(
        'success',
        `Imported ${data?.state_count ?? 0} states and ${data?.transition_count ?? 0} transitions`,
      )
    } catch (error) {
      log.error('[Workflow]', 'Failed to import workflow', { error })
      addToast(
        'error',
        `Failed to import workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsImporting(false)
      setPendingImport(null)
    }
  }, [
    selectedWorkflow,
    isAdmin,
    pendingImport,
    reloadWorkflow,
    setSelectedStateId,
    setSelectedTransitionId,
    addToast,
  ])

  /**
   * Cancel pending import
   */
  const cancelImport = useCallback(() => {
    setPendingImport(null)
  }, [])

  /**
   * Trigger file input for import
   */
  const triggerImport = useCallback(() => {
    importInputRef.current?.click()
  }, [])

  /**
   * Handle file input change
   */
  const handleImportFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        requestImport(file)
        // Reset input so same file can be selected again
        e.target.value = ''
      }
    },
    [requestImport],
  )

  return {
    exportWorkflow,
    requestImport,
    confirmImport,
    cancelImport,
    pendingImport,
    isImporting,
    importInputRef,
    triggerImport,
    handleImportFileChange,
  }
}
