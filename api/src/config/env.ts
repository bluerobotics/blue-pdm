import { z } from 'zod'

// PORT is the standard env var for Railway/Render/Heroku/Fly.io
// API_PORT is our custom fallback, 3001 is the local dev default
const portDefault = process.env.PORT || process.env.API_PORT || '3001'

/**
 * The spellings people actually type into a deployment dashboard.
 *
 * Anything outside this list is a configuration error rather than a `false`:
 * `ENABLE_DOCS=flase` must not quietly mean "on", and `ENABLE_DOCS=off` must
 * not quietly mean "on" either, which is what `z.coerce.boolean()` does with
 * every non-empty string.
 */
const BOOLEAN_LITERALS: Readonly<Record<string, boolean>> = {
  true: true,
  '1': true,
  yes: true,
  on: true,
  false: false,
  '0': false,
  no: false,
  off: false,
}

function booleanEnv(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return defaultValue

      const parsed = BOOLEAN_LITERALS[value.trim().toLowerCase()]
      if (parsed === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must be one of ${Object.keys(BOOLEAN_LITERALS).join(', ')} (got ${JSON.stringify(value)})`,
        })
        return z.NEVER
      }
      return parsed
    })
}

const envSchema = z.object({
  API_PORT: z.coerce.number().default(parseInt(portDefault, 10)),
  API_HOST: z.string().default('0.0.0.0'),

  /**
   * Whether this process is a developer's local machine, and nothing else.
   *
   * It used to decide three unrelated things at once - whether stack traces
   * went to the caller, whether CORS allowed anything, and whether `/docs`
   * existed - so a deployment that simply never set it got the least safe
   * answer to all three. Those are now decided on their own terms: 5xx bodies
   * never carry internals, the CORS allowlist always contains the desktop app,
   * and `/docs` has `ENABLE_DOCS`.
   *
   * What is left is developer convenience: pretty-printed debug logs, the
   * request-debug hook, and the Vite dev server in the CORS allowlist. The
   * default is `production` because an unset variable has to mean the
   * conservative thing, the same way every secret in this file fails closed.
   * Development is opted into explicitly by the `api` and `api:dev` scripts.
   */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_KEY: z.string().min(1),
  SUPABASE_SERVICE_KEY: z.string().optional(),

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60000),

  /**
   * Extra browser origins allowed to call this API, comma-separated.
   *
   * This adds to the allowlist rather than replacing it - the desktop app is
   * always allowed - so setting it for an ERP domain cannot take the app
   * offline. Server-to-server callers send no `Origin` at all and are not
   * subject to CORS in the first place, so most deployments never need it.
   */
  CORS_ORIGINS: z.string().optional(),

  /**
   * Whether to serve the Swagger UI and the OpenAPI document at `/docs`.
   *
   * On by default: this is an integration API whose whole surface is already
   * published in `api/README.md`, and three separate documents send
   * integrators to `/docs` to read it. Hiding it is a documentation decision
   * for an operator who wants a smaller public surface, not a security
   * control, so it is one switch of its own and not a rider on another.
   */
  ENABLE_DOCS: booleanEnv(true),

  // Extension system encryption key for secrets
  EXTENSION_ENCRYPTION_KEY: z.string().min(32).optional(),
})

export type Env = z.infer<typeof envSchema>

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format())
    process.exit(1)
  }
  return result.data
}

export const env = validateEnv()

// Constants
export const SIGNED_URL_EXPIRY = 3600 // 1 hour
