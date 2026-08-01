import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { changeFileStateViaWorkflow, stateChangeErrorResponse } from './workflow.js'

/** Minimal stand-in for the client: only `rpc` is reached by the helper. */
function clientReturning(response: { data?: unknown; error?: { message: string } | null }) {
  return {
    rpc: async () => ({ data: response.data ?? null, error: response.error ?? null }),
  } as unknown as SupabaseClient
}

const FILE_ID = '00000000-0000-0000-0000-000000000001'

describe('changeFileStateViaWorkflow', () => {
  it('reports an advance with the state the file landed on', async () => {
    const client = clientReturning({
      data: { success: true, new_state_name: 'Released' },
    })

    await expect(changeFileStateViaWorkflow(client, FILE_ID, 'released')).resolves.toEqual({
      outcome: 'advanced',
      newState: 'Released',
    })
  })

  it('reports files that are not on a workflow as unmanaged', async () => {
    const client = clientReturning({
      data: { success: false, error_code: 'NO_WORKFLOW', error_message: 'not assigned' },
    })

    await expect(changeFileStateViaWorkflow(client, FILE_ID, 'released')).resolves.toEqual({
      outcome: 'unmanaged',
    })
  })

  it('reports a gated transition as waiting on review rather than as a failure', async () => {
    const client = clientReturning({
      data: { success: true, requires_review: true },
    })

    const result = await changeFileStateViaWorkflow(client, FILE_ID, 'released')
    expect(result.outcome).toBe('review_required')
  })

  it('treats an already-pending review as waiting, not as a new request', async () => {
    const client = clientReturning({
      data: {
        success: false,
        requires_review: true,
        error_code: 'REVIEW_PENDING',
        error_message: 'This transition is already waiting on a review',
      },
    })

    const result = await changeFileStateViaWorkflow(client, FILE_ID, 'released')
    expect(result).toEqual({
      outcome: 'review_required',
      message: 'This transition is already waiting on a review',
    })
  })

  it('passes the engine refusal through with its code', async () => {
    const client = clientReturning({
      data: {
        success: false,
        error_code: 'ROLE_REQUIRED',
        error_message: 'You do not hold a workflow role that allows this transition',
      },
    })

    await expect(changeFileStateViaWorkflow(client, FILE_ID, 'released')).resolves.toEqual({
      outcome: 'rejected',
      code: 'ROLE_REQUIRED',
      message: 'You do not hold a workflow role that allows this transition',
    })
  })

  it('rejects when the RPC itself fails', async () => {
    const client = clientReturning({ error: { message: 'connection reset' } })

    await expect(changeFileStateViaWorkflow(client, FILE_ID, 'released')).resolves.toEqual({
      outcome: 'rejected',
      code: 'INTERNAL_ERROR',
      message: 'connection reset',
    })
  })

  it('rejects an empty response rather than reporting a silent success', async () => {
    const client = clientReturning({ data: null })

    const result = await changeFileStateViaWorkflow(client, FILE_ID, 'released')
    expect(result.outcome).toBe('rejected')
  })
})

describe('stateChangeErrorResponse', () => {
  it('maps a missing role to 403', () => {
    expect(stateChangeErrorResponse('ROLE_REQUIRED')).toEqual({
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('maps checkout and stale-state conflicts to 409', () => {
    expect(stateChangeErrorResponse('CHECKOUT_REQUIRED').status).toBe(409)
    expect(stateChangeErrorResponse('CHECKED_OUT').status).toBe(409)
    expect(stateChangeErrorResponse('WRONG_STATE').status).toBe(409)
    expect(stateChangeErrorResponse('NO_TRANSITION').status).toBe(409)
  })

  it('maps a missing file to 404', () => {
    expect(stateChangeErrorResponse('FILE_NOT_FOUND')).toEqual({ status: 404, code: 'NOT_FOUND' })
  })

  it('falls back to 400 for a code it does not know', () => {
    expect(stateChangeErrorResponse('SOMETHING_NEW')).toEqual({
      status: 400,
      code: 'BAD_REQUEST',
    })
  })
})
