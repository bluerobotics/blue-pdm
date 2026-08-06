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

    const isDev = process.env.NODE_ENV !== 'production'
    return reply.status(statusCode).send({
      error: ErrorCode.INTERNAL_ERROR,
      message: isDev ? error.message : 'Internal server error',
      ...(isDev && { stack: error.stack }),
    })
  })
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
})
