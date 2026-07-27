/**
 * Change State submenu - shows the workflow transitions available from a file's
 * current state and executes the chosen transition through the workflow engine.
 */
import React, { useEffect, useState } from 'react'
import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react'

import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'
import {
  getAvailableTransitions,
  getFileWorkflowAssignment,
  getDefaultWorkflow,
  getWorkflowStates,
  assignWorkflowToFile,
  executeTransition,
} from '@/lib/workflows'
import { log } from '@/lib/logger'
import type { AvailableTransition } from '@/types/workflow'

import { ContextSubmenu } from '../components'

interface ChangeStateSubmenuProps {
  targetFile: LocalFile
  onClose: () => void
  onRefresh: (silent?: boolean) => void
  handleOpenReviewModal: (file: LocalFile) => void
  showStateSubmenu: boolean
  setShowStateSubmenu: (show: boolean) => void
  stateSubmenuTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
}

export function ChangeStateSubmenu({
  targetFile,
  onClose,
  onRefresh,
  handleOpenReviewModal,
  showStateSubmenu,
  setShowStateSubmenu,
  stateSubmenuTimeoutRef,
}: ChangeStateSubmenuProps) {
  const { user, organization, addToast } = usePDMStore()

  const [loading, setLoading] = useState(false)
  const [transitions, setTransitions] = useState<AvailableTransition[]>([])
  const [executing, setExecuting] = useState(false)

  const fileId = targetFile.pdmData?.id ?? null

  // Ensure the file has a workflow assignment so transitions can be resolved.
  // Returns true when an assignment exists or was created.
  const ensureAssignment = async (): Promise<boolean> => {
    if (!fileId || !user) return false

    const { data: existing } = await getFileWorkflowAssignment(fileId)
    if (existing) return true

    const currentStateId = targetFile.pdmData?.workflow_state_id ?? null

    // If the file already references a workflow state, assign it to that state's workflow.
    if (currentStateId) {
      const { data: stateRow } = await supabase
        .from('workflow_states')
        .select('id, workflow_id')
        .eq('id', currentStateId)
        .single()
      if (stateRow?.workflow_id) {
        await assignWorkflowToFile(fileId, stateRow.workflow_id, currentStateId, user.id)
        return true
      }
    }

    // Otherwise fall back to the org's default workflow at its initial state.
    if (!organization) return false
    const { data: workflow } = await getDefaultWorkflow(organization.id)
    if (!workflow) return false

    const { data: states } = await getWorkflowStates(workflow.id)
    if (!states || states.length === 0) return false

    const initialState =
      [...states].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0] ?? states[0]

    await assignWorkflowToFile(fileId, workflow.id, initialState.id, user.id)
    return true
  }

  const loadTransitions = async () => {
    if (!fileId) return
    setLoading(true)
    try {
      let result = await getAvailableTransitions(fileId)

      // No transitions usually means the file isn't assigned to a workflow yet.
      if (!result.error && (!result.data || result.data.length === 0)) {
        const assigned = await ensureAssignment()
        if (assigned) {
          result = await getAvailableTransitions(fileId)
        }
      }

      if (result.error) {
        log.error('[Workflow]', 'Failed to load available transitions', { error: result.error })
        setTransitions([])
      } else {
        setTransitions(result.data ?? [])
      }
    } catch (error) {
      log.error('[Workflow]', 'Failed to load available transitions', { error })
      setTransitions([])
    } finally {
      setLoading(false)
    }
  }

  // Load transitions whenever the submenu opens.
  useEffect(() => {
    if (showStateSubmenu) {
      void loadTransitions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStateSubmenu, fileId])

  const handleTransitionClick = async (transition: AvailableTransition) => {
    if (!fileId || !user || executing) return

    setExecuting(true)
    try {
      const result = await executeTransition(fileId, transition.transition_id, user.id)

      if (result.success) {
        addToast('success', `Moved to ${transition.to_state_name}`)
        onRefresh(true)
        onClose()
        setShowStateSubmenu(false)
        return
      }

      if ('requiresReview' in result && result.requiresReview) {
        addToast('info', 'This transition requires review approval')
        handleOpenReviewModal(targetFile)
        onClose()
        setShowStateSubmenu(false)
        return
      }

      const message =
        result.error instanceof Error ? result.error.message : 'Failed to change state'
      addToast('error', message)
    } catch (error) {
      log.error('[Workflow]', 'Failed to execute transition', { error })
      addToast('error', 'Failed to change state')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div
      className="context-menu-item relative"
      onMouseEnter={() => {
        if (stateSubmenuTimeoutRef.current) {
          clearTimeout(stateSubmenuTimeoutRef.current)
        }
        setShowStateSubmenu(true)
      }}
      onMouseLeave={() => {
        stateSubmenuTimeoutRef.current = setTimeout(() => {
          setShowStateSubmenu(false)
        }, 150)
      }}
      onClick={(e) => {
        e.stopPropagation()
        setShowStateSubmenu(!showStateSubmenu)
      }}
    >
      <RefreshCw size={14} />
      Change State
      <span className="text-xs text-plm-fg-muted ml-auto">▶</span>

      {showStateSubmenu && (
        <ContextSubmenu
          minWidth={180}
          onMouseEnter={() => {
            if (stateSubmenuTimeoutRef.current) {
              clearTimeout(stateSubmenuTimeoutRef.current)
            }
            setShowStateSubmenu(true)
          }}
          onMouseLeave={() => {
            stateSubmenuTimeoutRef.current = setTimeout(() => {
              setShowStateSubmenu(false)
            }, 150)
          }}
        >
          {loading ? (
            <div className="context-menu-item opacity-60">
              <Loader2 size={14} className="animate-spin" />
              Loading transitions…
            </div>
          ) : transitions.length === 0 ? (
            <div className="context-menu-item disabled text-plm-fg-muted">
              No transitions available
            </div>
          ) : (
            transitions.map((transition) => (
              <div
                key={transition.transition_id}
                className={`context-menu-item ${executing ? 'opacity-60' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void handleTransitionClick(transition)
                }}
                title={
                  transition.has_gates
                    ? 'This transition requires review approval'
                    : `Move to ${transition.to_state_name}`
                }
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: transition.to_state_color || 'var(--plm-fg-muted)' }}
                />
                {transition.transition_name || transition.to_state_name}
                {transition.has_gates && (
                  <ShieldCheck size={12} className="text-plm-warning ml-auto" />
                )}
              </div>
            ))
          )}
        </ContextSubmenu>
      )}
    </div>
  )
}
