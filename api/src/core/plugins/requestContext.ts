import { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { randomUUID } from 'crypto'

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string
    startTime: number
  }
}

/**
 * Longest caller-supplied request id accepted. A UUID is 36 characters and a W3C
 * traceparent is 55, so this is generous; the limit is here because the value is
 * carried on every log line for the request and echoed in 5xx bodies.
 */
const MAX_REQUEST_ID_LENGTH = 128

/**
 * Shapes a caller-supplied request id has to match: the characters a correlation id
 * is built from and nothing else.
 *
 * The value arrives in a header, is copied verbatim onto every log line for the
 * request, and is returned to the caller in a 5xx body. Unconstrained, that lets a
 * caller put newlines into the log stream, or a payload of arbitrary length onto
 * every line of it. Restricting the charset is what makes both impossible, rather
 * than relying on the log serialiser to escape and the response encoder to quote.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/

/**
 * The request id to use for this request: the caller's when it is well formed, and a
 * fresh one otherwise.
 *
 * A malformed id is replaced rather than refused. The id exists so an operator can
 * tie a report to a log line; rejecting the request over it would turn a cosmetic
 * header mistake into an outage, and the request is perfectly serviceable without the
 * caller's correlation.
 */
export function resolveRequestId(supplied: unknown): { id: string; accepted: boolean } {
  if (
    typeof supplied === 'string' &&
    supplied.length <= MAX_REQUEST_ID_LENGTH &&
    REQUEST_ID_PATTERN.test(supplied)
  ) {
    return { id: supplied, accepted: true }
  }

  return { id: randomUUID(), accepted: false }
}

async function requestContextPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('requestId', '')
  fastify.decorateRequest('startTime', 0)

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const supplied = request.headers['x-request-id']
    const { id, accepted } = resolveRequestId(supplied)

    request.requestId = id
    request.startTime = Date.now()

    // Add to log context
    request.log = request.log.child({ requestId: request.requestId })

    // The rejected value is deliberately not logged - writing it out is the thing the
    // shape check exists to prevent. Its length is enough to tell a truncating proxy
    // from a probe.
    if (supplied !== undefined && !accepted) {
      request.log.warn(
        { suppliedLength: typeof supplied === 'string' ? supplied.length : null },
        'Ignored a malformed x-request-id header and generated one instead',
      )
    }
  })

  fastify.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - request.startTime
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: duration,
      },
      'Request completed',
    )
  })
}

export default fp(requestContextPlugin, {
  name: 'request-context',
})
