/**
 * Health & Info Routes
 *
 * Provides API status and health check endpoints.
 */

import { FastifyPluginAsync } from 'fastify'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { env } from '../src/config/env.js'
import { checkDatabaseHealth } from '../src/infrastructure/supabase.js'

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load version from package.json
const packageJsonPath = path.join(__dirname, '..', 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
const API_VERSION = packageJson.version || '0.0.0'

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // API info and status
  fastify.get(
    '/',
    {
      schema: {
        description: 'API info and status',
        tags: ['Info'],
        response: {
          200: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              version: { type: 'string' },
              status: { type: 'string' },
              docs: { type: 'string' },
            },
          },
        },
      },
    },
    // `docs` is a relative path rather than a URL built from the bind address,
    // which on any deployment is `0.0.0.0` and points nowhere the caller can
    // reach. It is omitted entirely when the docs are switched off, so this
    // does not advertise a page that answers 404.
    async () => ({
      name: 'BluePLM REST API',
      version: API_VERSION,
      status: 'running',
      ...(env.ENABLE_DOCS ? { docs: '/docs' } : {}),
    }),
  )

  // Health check with database connectivity
  fastify.get(
    '/health',
    {
      schema: {
        description: 'Health check with dependency status',
        tags: ['Info'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              version: { type: 'string' },
              build: { type: ['string', 'null'] },
              checks: {
                type: 'object',
                properties: {
                  database: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      latencyMs: { type: ['number', 'null'] },
                      error: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      // Check database connectivity
      const dbCheck = await checkDatabaseHealth()

      // Determine overall status
      const allHealthy = dbCheck.status === 'healthy'

      return {
        status: allHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        version: API_VERSION,
        // BUILD_COMMIT_SHA is baked into the image at build time, so it is the
        // only one of these that survives a deploy from the registry rather
        // than from the platform's own git integration.
        build:
          process.env.RAILWAY_GIT_COMMIT_SHA?.substring(0, 7) ||
          process.env.RENDER_GIT_COMMIT?.substring(0, 7) ||
          process.env.BUILD_COMMIT_SHA?.substring(0, 7) ||
          null,
        checks: {
          database: {
            status: dbCheck.status,
            latencyMs: dbCheck.latencyMs ?? null,
            error: dbCheck.error ? 'Database check failed' : null,
          },
        },
      }
    },
  )
}

export default healthRoutes
