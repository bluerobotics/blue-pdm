/**
 * BluePLM REST API Server (Fastify + TypeScript)
 *
 * Integration API for external systems (ERP, CI/CD, Slack, etc.)
 *
 * NOTE: This API is designed for INTEGRATIONS, not daily app use.
 * - Desktop app users → Direct to Supabase (faster)
 * - SolidWorks add-in → Direct to Supabase (faster)
 * - ERP systems (Odoo, etc.) → This API (controlled access)
 * - CI/CD, webhooks, automation → This API
 *
 * Features:
 * - JWT authentication via Supabase
 * - JSON Schema validation on all endpoints
 * - OpenAPI/Swagger documentation at /docs
 * - Rate limiting for production
 * - Webhook support for notifications
 * - Signed URLs for file transfers (files go direct to Supabase)
 * - ERP-friendly endpoints (/parts, /bom, state shortcuts)
 *
 * Usage:
 *   npm run api        — run from source with tsx (development)
 *   npm run api:build  — compile to api/dist, which is what the image runs
 */

import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { env } from './src/config/env.js'
import { createLoggerOptions } from './src/infrastructure/logging.js'
import { errorHandlerPlugin, requestContextPlugin } from './src/core/plugins/index.js'
import { authPlugin } from './middleware/index.js'
import { sendError } from './utils/index.js'
import routes from './routes/index.js'

// Import types to ensure Fastify extensions are available
import './types.js'

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load version from API's own package.json
const packageJsonPath = path.join(__dirname, 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
const API_VERSION = packageJson.version || '0.0.0'

// Parse CORS origins from env — require explicit config in production
const CORS_ORIGINS = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : env.NODE_ENV === 'production'
    ? false
    : true

export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: createLoggerOptions(env),
    bodyLimit: 104857600, // 100MB
  })

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  })

  // Register CORS
  await fastify.register(cors, {
    origin: CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })

  // Register Rate Limiting
  await fastify.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    errorResponseBuilder: () => ({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Max ${env.RATE_LIMIT_MAX} requests per ${env.RATE_LIMIT_WINDOW / 1000}s`,
    }),
  })

  // Register core plugins
  await fastify.register(requestContextPlugin)
  await fastify.register(errorHandlerPlugin)

  // Register OpenAPI/Swagger
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'BluePLM REST API',
        description: 'BluePLM REST API',
        version: API_VERSION,
      },
      servers: [{ url: `http://${env.API_HOST}:${env.API_PORT}`, description: 'Local server' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      tags: [
        { name: 'Info', description: 'API info and health' },
        { name: 'Auth', description: 'Authentication endpoints' },
        { name: 'Vaults', description: 'Vault management' },
        { name: 'Files', description: 'File operations' },
        { name: 'ERP', description: 'ERP integration endpoints (Odoo, SAP, etc.)' },
        { name: 'Suppliers', description: 'Supplier/vendor management and costing' },
        { name: 'Customers', description: 'Customer sync and enrichment' },
        { name: 'Versions', description: 'Version history' },
        { name: 'Trash', description: 'Deleted files' },
        { name: 'Activity', description: 'Activity feed' },
        { name: 'Integrations', description: 'External integrations (Odoo)' },
        { name: 'Webhooks', description: 'Webhook management' },
        { name: 'Extensions', description: 'Extension system - sandbox handlers and admin' },
      ],
    },
  })

  if (env.NODE_ENV !== 'production') {
    await fastify.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        displayRequestDuration: true,
      },
      theme: {
        title: 'BluePLM API',
      },
    })
  }

  // Register Auth Plugin
  await fastify.register(authPlugin)

  // DEBUG: Log all requests with auth header info (dev only)
  if (env.NODE_ENV === 'development') {
    fastify.addHook('onRequest', async (request) => {
      const authHeader = request.headers.authorization
      request.log.debug({
        msg: '>>> REQUEST DEBUG',
        url: request.url,
        method: request.method,
        hasAuthHeader: !!authHeader,
        authHeaderStart: authHeader?.substring(0, 30) || 'none',
      })
    })
  }

  // Register all routes
  await fastify.register(routes)

  // Not found handler
  fastify.setNotFoundHandler((_request, reply) => {
    sendError(reply, 404, 'NOT_FOUND', 'Endpoint not found')
  })

  return fastify
}

// Graceful shutdown handler
function setupGracefulShutdown(fastify: FastifyInstance): void {
  const shutdown = async (signal: string) => {
    fastify.log.info({ signal }, 'Shutdown signal received')
    try {
      await fastify.close()
      fastify.log.info('Server closed gracefully')
      process.exit(0)
    } catch (error) {
      fastify.log.error({ error }, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

// Start Server
buildServer()
  .then((fastify) => {
    setupGracefulShutdown(fastify)

    fastify.listen({ port: env.API_PORT, host: env.API_HOST }, (error, address) => {
      if (error) {
        fastify.log.error({ error }, 'Failed to start server')
        process.exit(1)
      }
      fastify.log.info(`\n🚀 BluePLM API v${API_VERSION} running at ${address}`)
      fastify.log.info(`📚 API Documentation: ${address}/docs\n`)
    })
  })
  .catch((error: unknown) => {
    console.error('Failed to build server:', error)
    process.exit(1)
  })
