/**
 * Workflow engine access for the REST endpoints.
 *
 * The legacy `files.state` column is a projection of the workflow graph, so
 * endpoints that used to write it directly go through
 * `execute_transition_to_legacy_state` instead. That RPC enforces the same
 * state, role and checkout guards as the desktop app, bumps the revision and
 * writes history in one transaction.
 *
 * Files that were never assigned to a workflow have no graph to walk, so the
 * helper reports `unmanaged` and the caller falls back to a direct write.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { ErrorCode } from './errors.js'

/** Legacy state values that map onto a workflow state. */
export type LegacyFileState = 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'

export type StateChangeResult =
  /** The file moved; `newState` is the workflow state it landed on. */
  | { outcome: 'advanced'; newState: string | null }
  /** Blocking gates opened pending reviews; the file has not moved yet. */
  | { outcome: 'review_required'; message: string }
  /** The file is not on a workflow, so there is nothing for the engine to do. */
  | { outcome: 'unmanaged' }
  /** The engine refused the change. */
  | { outcome: 'rejected'; code: string; message: string }

interface RpcResponse {
  success?: boolean
  requires_review?: boolean
  error_code?: string
  error_message?: string
  new_state_name?: string | null
}

/** HTTP shape for each refusal the engine can return. */
const RESPONSE_BY_CODE: Record<string, { status: number; code: ErrorCode }> = {
  FILE_NOT_FOUND: { status: 404, code: ErrorCode.NOT_FOUND },
  TRANSITION_NOT_FOUND: { status: 404, code: ErrorCode.NOT_FOUND },
  NO_TRANSITION: { status: 409, code: ErrorCode.CONFLICT },
  AMBIGUOUS_TRANSITION: { status: 409, code: ErrorCode.CONFLICT },
  WRONG_STATE: { status: 409, code: ErrorCode.CONFLICT },
  CHECKOUT_REQUIRED: { status: 409, code: ErrorCode.CONFLICT },
  CHECKED_OUT: { status: 409, code: ErrorCode.CONFLICT },
  REVIEW_PENDING: { status: 409, code: ErrorCode.CONFLICT },
  ROLE_REQUIRED: { status: 403, code: ErrorCode.FORBIDDEN },
  FORBIDDEN: { status: 403, code: ErrorCode.FORBIDDEN },
  NOT_AUTHENTICATED: { status: 401, code: ErrorCode.UNAUTHORIZED },
  INTERNAL_ERROR: { status: 500, code: ErrorCode.INTERNAL_ERROR },
}

/** Map an engine refusal onto the API's status code and error code. */
export function stateChangeErrorResponse(code: string): { status: number; code: ErrorCode } {
  return RESPONSE_BY_CODE[code] ?? { status: 400, code: ErrorCode.BAD_REQUEST }
}

/**
 * Move a file to the workflow state that maps to the given legacy state.
 */
export async function changeFileStateViaWorkflow(
  supabase: SupabaseClient,
  fileId: string,
  targetState: LegacyFileState,
  comment?: string,
): Promise<StateChangeResult> {
  const { data, error } = await supabase.rpc('execute_transition_to_legacy_state', {
    p_file_id: fileId,
    p_target_state: targetState,
    p_comment: comment ?? null,
  })

  if (error) {
    return { outcome: 'rejected', code: 'INTERNAL_ERROR', message: error.message }
  }

  const result = (data ?? {}) as RpcResponse

  if (result.error_code === 'NO_WORKFLOW') {
    return { outcome: 'unmanaged' }
  }

  if (result.requires_review) {
    return {
      outcome: 'review_required',
      message: result.error_message ?? 'The change is waiting on workflow approvals',
    }
  }

  if (!result.success) {
    return {
      outcome: 'rejected',
      code: result.error_code ?? 'INTERNAL_ERROR',
      message: result.error_message ?? 'The workflow engine refused the state change',
    }
  }

  return { outcome: 'advanced', newState: result.new_state_name ?? null }
}
