import { describe, expect, it } from 'vitest'

import { resolveRequestId } from './requestContext.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('resolveRequestId', () => {
  it('keeps a well-formed id, so a caller can correlate its own request', () => {
    for (const supplied of [
      '0f2c9a3e-6b41-4c9e-9d55-1a2b3c4d5e6f',
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      'checkin.42_retry',
      'A',
    ]) {
      expect(resolveRequestId(supplied), supplied).toEqual({ id: supplied, accepted: true })
    }
  })

  it('generates one when the caller sends none', () => {
    const { id, accepted } = resolveRequestId(undefined)

    expect(accepted).toBe(false)
    expect(id).toMatch(UUID_PATTERN)
  })

  it('refuses a value that would break the log stream or the response body', () => {
    // The id is copied onto every log line for the request and returned in 5xx bodies,
    // so a newline forges a log line and a control character corrupts the stream.
    for (const supplied of [
      'a\nlevel=fatal msg="forged"',
      'a\rb',
      'a\u0000b',
      'a b',
      '../../etc/passwd',
      '<script>alert(1)</script>',
      '"quoted"',
      '',
    ]) {
      const { id, accepted } = resolveRequestId(supplied)

      expect(accepted, JSON.stringify(supplied)).toBe(false)
      expect(id).toMatch(UUID_PATTERN)
    }
  })

  it('refuses one long enough to dominate every log line it appears on', () => {
    expect(resolveRequestId('a'.repeat(128)).accepted).toBe(true)
    expect(resolveRequestId('a'.repeat(129)).accepted).toBe(false)
  })

  it('refuses a repeated header, which Node hands over as an array', () => {
    expect(resolveRequestId(['first', 'second']).accepted).toBe(false)
  })

  it('generates a distinct id each time, so two rejected requests do not share one', () => {
    expect(resolveRequestId(undefined).id).not.toBe(resolveRequestId(undefined).id)
  })
})
