import { FastifyInstance, FastifyError } from 'fastify'
import fp from 'fastify-plugin'

import { ErrorCode } from '../../../utils/errors.js'

const HTTP_STATUS_CLIENT_ERROR = 400
const HTTP_STATUS_SERVER_ERROR = 500

/**
 * The code that goes with each client-error status, so a thrown error reaches
 * the caller under the same vocabulary as `sendError`. Anything else in the 4xx
 * range is a malformed request as far as the caller is concerned.
 */
const ERROR_CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.RATE_LIMIT_EXCEEDED,
}

async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      request.log.warn({ err: error }, 'Validation error')
      return reply.status(400).send({
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: error.validation,
      })
    }

    const statusCode = error.statusCode ?? HTTP_STATUS_SERVER_ERROR

    // A 4xx describes something the caller did, and its message is the only way
    // the caller can find out what. Withholding it - which is what happened to
    // rate-limit rejections, reported as "Internal server error" - leaves a
    // client with no way to react correctly. Only 5xx messages can carry
    // server internals, so only those are replaced.
    if (statusCode >= HTTP_STATUS_CLIENT_ERROR && statusCode < HTTP_STATUS_SERVER_ERROR) {
      request.log.warn({ err: error, statusCode }, 'Client error')
      return reply.status(statusCode).send({
        error: ERROR_CODE_BY_STATUS[statusCode] ?? ErrorCode.BAD_REQUEST,
        message: error.message || 'Request rejected',
      })
    }

    request.log.error({ err: error }, 'Unhandled error')

    // A 5xx describes the server, not the caller: absolute paths inside the
    // container, dependency versions, the shape of the call that failed. None
    // of it tells the caller anything they can act on, and all of it is worth
    // having to someone probing the service, so it goes to the log and only to
    // the log. This is not conditional on how the process was configured -
    // deciding it per environment is what leaked it, since a deployment that
    // set nothing got the developer's answer.
    //
    // What the caller gets instead is the request id, which is in the log line
    // above. It is the one thing that turns "I got a 500" into a specific
    // stack trace an operator can read, and it discloses nothing.
    return reply.status(statusCode).send({
      error: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
      ...(request.requestId ? { requestId: request.requestId } : {}),
    })
  })
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
})
