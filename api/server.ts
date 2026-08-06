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
import rateLimit, { type errorResponseBuilderContext } from '@fastify/rate-limit'
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

/**
 * The origin an opaque browser context sends, kept allowed for the desktop app.
 *
 * A packaged build loads its renderer with `loadFile`, so it is a `file://`
 * page, and the expectation was that Chromium would give it the opaque origin
 * `null` and enforce CORS on it like any other page. **Measured against
 * Electron 39.2.7 on Windows, it does not.** A `file://` page's `fetch()`
 * sends no `Origin` header at all, the response arrives with
 * `response.type === 'basic'` rather than `'cors'`, and a server that returns
 * no CORS headers whatsoever is read successfully. So the packaged app is not
 * a CORS client of this API and does not currently need this entry - unlike a
 * `npm run dev` renderer, which is served over http, does send an `Origin`,
 * and is subject to CORS in the ordinary way.
 *
 * The entry stays anyway, because what it costs is nothing and what it buys is
 * that "the desktop app works" stops depending on an undocumented Chromium
 * behaviour holding. If the renderer ever moves to a custom scheme, or is
 * served over http, or Electron tightens `file://` to match the web, the app
 * keeps working instead of going dark for every user at once. It is also
 * always in the allowlist even when `CORS_ORIGINS` names something else, so
 * that adding an ERP's domain can never be the thing that switches the product
 * off.
 *
 * Allowing `null` is normally worth arguing about, since a sandboxed iframe on
 * any site can produce it. It costs little here: this API authenticates with a
 * bearer token that such a frame has no way to obtain, and it reads no cookie,
 * so there is no ambient credential to borrow and nothing to reach beyond the
 * unauthenticated `/` and `/health`. If that ever changes - a session cookie,
 * an IP allowlist, anything the browser attaches on its own - this constant
 * has to be revisited with it, and at that point the measurement above says it
 * can simply be deleted.
 */
const DESKTOP_APP_ORIGIN = 'null'

/**
 * Where `npm run dev` serves the renderer from.
 *
 * Unlike the packaged app, this one really is subject to CORS: a page on
 * `http://localhost:5173` was observed being refused by a production-mode
 * server and served by a development-mode one.
 */
const VITE_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

/**
 * `*` is not an origin, and it is not accepted as one.
 *
 * It shipped in `render.yaml`, so it is sitting in real deployments, and it
 * really did mean "any website may read this API's responses". It is dropped
 * with a warning rather than refused outright: we are the ones who put it
 * there, and a container that exits on a value we shipped turns an unattended
 * `:latest` pull into an outage. The warning names it, and the effective
 * allowlist is logged either way.
 */
const CORS_WILDCARD = '*'

function resolveCorsOrigins(): { origins: string[]; wildcardIgnored: boolean } {
  const configured = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  const wildcardIgnored = configured.includes(CORS_WILDCARD)

  const origins = [
    DESKTOP_APP_ORIGIN,
    ...configured.filter((origin) => origin !== CORS_WILDCARD),
    ...(env.NODE_ENV === 'production' ? [] : VITE_DEV_ORIGINS),
  ]

  return { origins: [...new Set(origins)], wildcardIgnored }
}

const { origins: CORS_ORIGINS, wildcardIgnored: CORS_WILDCARD_IGNORED } = resolveCorsOrigins()

const MS_PER_SECOND = 1000

/**
 * How long a request may take to arrive in full, headers and body.
 *
 * Fastify's default is 0, and 0 means never: a client that dribbles one byte a
 * second holds a connection open forever. That was measured against this
 * server, not inferred - the connection was still open and unbothered after 90
 * seconds, and nothing in the stack would ever have closed it.
 *
 * The value is a hard ceiling on the whole transfer, not an idle timer. A body
 * arriving steadily is still cut off when the ceiling is reached (a 90 KB body
 * sent evenly over 45 seconds was cut off at 16 seconds under a 15-second
 * ceiling), so it has to clear the slowest *legitimate* request rather than the
 * slowest reasonable one.
 *
 * The binding case is `POST /files/sync`, which carries a whole file
 * base64-encoded in the JSON body, up to the 100 MB `bodyLimit`. Fifteen
 * minutes is 100 MB sustained at roughly 1 Mbit: below any link an integration
 * host would be on, so no upload that was going to succeed is cut short.
 *
 * The cost of being that generous is that it is also how long a stalled request
 * can hold a connection. One knob sets both, so the only ways to tighten it are
 * a smaller `bodyLimit` or a cap on concurrent connections. Fifteen minutes is
 * the wrong side of that trade to be stingy on: a bound that exists is the
 * whole improvement over one that does not, and cutting off a large sync that
 * would have completed is an outage we would have inflicted on ourselves.
 *
 * Node will not enforce a deadline shorter than its own 60-second
 * `headersTimeout`, which Fastify does not surface; below that the value has no
 * effect on its own. Well above it, it fires on time - a 90-second setting was
 * observed ending a dribbling request at 90 seconds with a 408.
 */
const REQUEST_TIMEOUT_MS = 15 * 60 * MS_PER_SECOND

/**
 * How long an idle keep-alive connection is held open between requests.
 *
 * Must stay *above* the idle timeout of whatever proxy sits in front of the
 * API - 60 seconds on both Render and Railway. If this expires first, the
 * proxy can dispatch a request onto a socket the server is already closing,
 * which surfaces to the caller as a sporadic 502 with no matching server log.
 * 72 seconds is Fastify's default and clears the 60-second edge; it is pinned
 * here so the relationship is a decision rather than a coincidence.
 */
const KEEP_ALIVE_TIMEOUT_MS = 72 * MS_PER_SECOND

/**
 * How long boot may take before Fastify gives up on a plugin.
 *
 * A miss here is a crash loop, not a slow start, and the registrations below
 * are cheap. The default of 10 seconds leaves little room on a cold, throttled
 * container; 30 still catches a plugin that never calls back.
 */
const PLUGIN_TIMEOUT_MS = 30 * MS_PER_SECOND

// `connectionTimeout` is deliberately left unlimited. It is an inactivity timer
// on the socket, and it cannot tell an idle attacker from a request whose
// handler is working: a customer sync is a single HTTP request that runs for
// many minutes with nothing on the wire. Setting it to 5 seconds was observed
// to kill an 8-second handler mid-flight. The case it would cover - a client
// that connects and sends nothing - is already closed after 60 seconds by
// Node's headers timeout, which was also observed. So it buys nothing here and
// would cost long-running syncs.

/**
 * The rate limiter throws whatever this builder returns, and the error handler
 * decides the response from the thrown value's `statusCode`. The plugin types
 * the return as a bare `object`, so a plain `{ error, message }` compiles and
 * then arrives with no status at all - which is how a rate-limit rejection came
 * to be served as a 500 with the reason replaced by "Internal server error".
 * Returning an `Error` that carries `context.statusCode` keeps the status
 * attached to the throw, and follows the plugin's own default builder.
 */
function buildRateLimitError(
  _request: unknown,
  context: errorResponseBuilderContext,
): Error & { statusCode: number } {
  const seconds = env.RATE_LIMIT_WINDOW / MS_PER_SECOND
  const error = new Error(
    `Rate limit exceeded. Max ${env.RATE_LIMIT_MAX} requests per ${seconds}s. Retry in ${context.after}.`,
  ) as Error & { statusCode: number }

  // 429 normally, 403 if a ban threshold is ever configured. Taking it from the
  // context rather than hardcoding keeps the two in step.
  error.statusCode = context.statusCode
  return error
}

export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: createLoggerOptions(env),
    bodyLimit: 104857600, // 100MB
    requestTimeout: REQUEST_TIMEOUT_MS,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    pluginTimeout: PLUGIN_TIMEOUT_MS,
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

  if (CORS_WILDCARD_IGNORED) {
    fastify.log.warn(
      'CORS_ORIGINS contains "*", which allowed any website to read this API and has been ignored. ' +
        'List the origins you need, or leave it unset - the desktop app does not need it.',
    )
  }

  // A CORS failure looks like a network error in the browser and leaves no
  // trace on the server, so the allowlist is stated at boot rather than
  // reconstructed from the environment after someone reports a blank screen.
  fastify.log.info({ corsOrigins: CORS_ORIGINS }, 'CORS allowlist')

  // Register Rate Limiting
  await fastify.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    errorResponseBuilder: buildRateLimitError,
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

  if (env.ENABLE_DOCS) {
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
      fastify.log.info(
        env.ENABLE_DOCS
          ? `📚 API Documentation: ${address}/docs\n`
          : '📚 API Documentation disabled (ENABLE_DOCS=false)\n',
      )
    })
  })
  .catch((error: unknown) => {
    console.error('Failed to build server:', error)
    process.exit(1)
  })
