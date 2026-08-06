/**
 * Logging Configuration
 *
 * Provides Pino logger configuration for the API server.
 */

import pino from 'pino'
import type { FastifyLoggerOptions } from 'fastify'
import type { LoggerOptions as PinoLoggerOptions } from 'pino'

import { env as validatedEnv, type Env } from '../config/env.js'

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

export interface LoggerConfig {
  level: LogLevel
  prettyPrint: boolean
}

/**
 * Get default logger configuration based on environment
 */
export function getLoggerConfig(env: Env): LoggerConfig {
  const isDev = env.NODE_ENV === 'development'
  return {
    level: isDev ? 'debug' : 'info',
    prettyPrint: isDev,
  }
}

/**
 * Create Fastify logger options
 */
export function createLoggerOptions(env: Env): FastifyLoggerOptions & PinoLoggerOptions {
  const config = getLoggerConfig(env)

  if (config.prettyPrint) {
    return {
      level: config.level,
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
          colorize: true,
        },
      },
    }
  }

  // Production: structured JSON logs
  return {
    level: config.level,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  }
}

/**
 * Standalone Pino logger for modules that don't have access to the Fastify instance.
 *
 * Built from the same function and the same input as Fastify's own logger.
 * These two used to read the environment separately - one the validated
 * `env.NODE_ENV`, the other a raw `process.env.NODE_ENV` - and they disagreed
 * whenever the variable was unset, so one stream carried pretty-printed debug
 * lines and JSON info lines interleaved, and neither format could be parsed.
 */
export const log = pino(createLoggerOptions(validatedEnv))
