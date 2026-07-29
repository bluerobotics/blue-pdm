/**
 * Customer Enrichment Redaction
 *
 * Enforces the privacy boundary between company accounts and private
 * individuals. The customer base skews European, so GDPR applies: sending a
 * named private person's home address to a third-party API and asking it to
 * search the web about them is materially different from researching a company.
 *
 * The rule is enforced in exactly one place, {@link buildEnrichmentPayload}, a
 * pure function that builds the payload handed to the model. It is an
 * allow-list, not a filter: nothing reaches the model unless a field is
 * explicitly listed for that account kind. Expressing the rule as code rather
 * than as a prompt instruction is the whole point, because a prompt instruction
 * fails silently and cannot be unit-tested.
 *
 * @module customers/redaction
 */

import type { AccountKind } from './types.js'

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Everything the pipeline knows about an account before redaction.
 *
 * Passing the full record in is deliberate: the redaction decision must be made
 * here, from complete information, rather than by callers deciding piecemeal
 * what to hand over.
 */
export interface EnrichmentInput {
  /** Grouping key from `deriveAccount`. Used for correlation only. */
  accountKey: string
  kind: AccountKind
  /** Human label for the account. For individuals this is a person's name. */
  displayName: string
  companyName?: string | null
  /** Name of the human contact. Never sent to the model, for either kind. */
  contactName?: string | null
  /** Never sent to the model, for either kind. */
  email?: string | null
  /** Never sent to the model, for either kind. */
  phone?: string | null
  emailDomain?: string | null
  jobTitle?: string | null
  industry?: string | null
  website?: string | null
  vatNumber?: string | null
  street?: string | null
  street2?: string | null
  city?: string | null
  postcode?: string | null
  state?: string | null
  country?: string | null
  internalNotes?: string | null
  productNames?: readonly string[] | null
  orderCount?: number | null
  totalSpend?: number | null
  currency?: string | null
}

/**
 * The only fields that may ever be shown to the model.
 */
export interface EnrichmentContext {
  companyName?: string
  emailDomain?: string
  website?: string
  vatNumber?: string
  jobTitle?: string
  industry?: string
  street?: string
  street2?: string
  city?: string
  postcode?: string
  state?: string
  country?: string
  internalNotes?: string
  productsOrdered?: string[]
  orderCount?: number
  totalSpend?: number
  currency?: string
}

export interface EnrichmentPayload {
  /**
   * Correlation key for writing results back to the right account.
   *
   * This is NOT model-facing content and must not be interpolated into a
   * prompt: for individuals it embeds the person's email address. The
   * model-facing surface is {@link EnrichmentPayload.context}, rendered by
   * {@link renderEnrichmentPrompt}.
   */
  accountKey: string
  kind: AccountKind
  /**
   * Whether the caller may attach a web search tool to this request.
   *
   * Always false for individuals: we do not search the web about private people.
   */
  webSearchAllowed: boolean
  /** Redacted context. Safe to serialise and send. */
  context: EnrichmentContext
  /** Fields that were present on the input but withheld. For audit logging. */
  redactedFields: readonly string[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALLOW LISTS
// ═══════════════════════════════════════════════════════════════════════════════

type ContextField = keyof EnrichmentContext

/**
 * Canonical field order. Also the company allow-list: an organisation has no
 * privacy interest in its own registered details.
 */
export const COMPANY_CONTEXT_FIELDS: readonly ContextField[] = [
  'companyName',
  'emailDomain',
  'website',
  'vatNumber',
  'jobTitle',
  'industry',
  'street',
  'street2',
  'city',
  'postcode',
  'state',
  'country',
  'internalNotes',
  'productsOrdered',
  'orderCount',
  'totalSpend',
  'currency',
]

/**
 * Everything a private individual may contribute.
 *
 * Country and region only: enough to know roughly where a customer sits for
 * territory analysis, not enough to locate a person. No street, no exact city,
 * no postcode, no name, no email, no phone, no VAT.
 */
export const INDIVIDUAL_CONTEXT_FIELDS: readonly ContextField[] = [
  'state',
  'country',
  'productsOrdered',
  'orderCount',
  'totalSpend',
  'currency',
]

/**
 * Input fields that are withheld from the model regardless of account kind.
 * Researching a company does not require the names or contact details of the
 * people who work there.
 */
const NEVER_SENT_FIELDS = ['contactName', 'email', 'phone'] as const

// ═══════════════════════════════════════════════════════════════════════════════
// VALUE CLEANING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Trim, collapse whitespace, and treat blanks as absent so the renderer never
 * emits a label with nothing after it.
 */
function cleanText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed || undefined
}

/**
 * Zero is kept: "0 orders" is information, not an empty field.
 */
function cleanNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function cleanList(values: readonly string[] | null | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined
  }
  const seen = new Set<string>()
  for (const value of values) {
    const cleaned = cleanText(value)
    if (cleaned) {
      seen.add(cleaned)
    }
  }
  return seen.size > 0 ? [...seen] : undefined
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYLOAD CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the payload handed to the model, applying the privacy boundary.
 *
 * Companies get their full context and may be researched with web search.
 * Individuals get country, region, and their order history, and web search is
 * refused.
 *
 * @param input - Everything known about the account
 * @returns Redacted, model-safe payload
 */
export function buildEnrichmentPayload(input: EnrichmentInput): EnrichmentPayload {
  const isCompany = input.kind === 'company'

  // Assembled for every account, then filtered by the allow-list below. The
  // allow-list is the enforcement point; nothing here decides what is safe.
  const candidate: EnrichmentContext = {
    companyName:
      cleanText(input.companyName) ?? (isCompany ? cleanText(input.displayName) : undefined),
    emailDomain: cleanText(input.emailDomain),
    website: cleanText(input.website),
    vatNumber: cleanText(input.vatNumber),
    jobTitle: cleanText(input.jobTitle),
    industry: cleanText(input.industry),
    street: cleanText(input.street),
    street2: cleanText(input.street2),
    city: cleanText(input.city),
    postcode: cleanText(input.postcode),
    state: cleanText(input.state),
    country: cleanText(input.country),
    internalNotes: cleanText(input.internalNotes),
    productsOrdered: cleanList(input.productNames),
    orderCount: cleanNumber(input.orderCount),
    totalSpend: cleanNumber(input.totalSpend),
    currency: cleanText(input.currency),
  }

  const allowed = new Set<ContextField>(
    isCompany ? COMPANY_CONTEXT_FIELDS : INDIVIDUAL_CONTEXT_FIELDS,
  )

  const context: EnrichmentContext = {}
  const redactedFields: string[] = []

  for (const field of COMPANY_CONTEXT_FIELDS) {
    const value = candidate[field]
    if (value === undefined) {
      continue
    }
    if (allowed.has(field)) {
      Object.assign(context, { [field]: value })
    } else {
      redactedFields.push(field)
    }
  }

  for (const field of NEVER_SENT_FIELDS) {
    if (cleanText(input[field]) !== undefined) {
      redactedFields.push(field)
    }
  }

  // The display name is a person's name for individuals, so it never reaches
  // the context; for companies it only appears as a companyName fallback.
  if (!isCompany && cleanText(input.displayName) !== undefined) {
    redactedFields.push('displayName')
  }

  // Currency on its own says nothing, and the renderer only uses it to qualify
  // total spend, so drop it when there is no spend to qualify.
  if (context.totalSpend === undefined) {
    delete context.currency
  }

  return {
    accountKey: input.accountKey,
    kind: input.kind,
    webSearchAllowed: isCompany,
    context,
    redactedFields,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

const CONTEXT_LABELS: ReadonlyArray<readonly [ContextField, string]> = [
  ['companyName', 'Company name'],
  ['emailDomain', 'Email domain'],
  ['website', 'Website'],
  ['vatNumber', 'VAT number'],
  ['jobTitle', 'Contact job title'],
  ['industry', 'Industry'],
  ['street', 'Street'],
  ['street2', 'Street (line 2)'],
  ['city', 'City'],
  ['postcode', 'Postcode'],
  ['state', 'State/Region'],
  ['country', 'Country'],
  ['internalNotes', 'Internal notes'],
  ['productsOrdered', 'Products ordered'],
  ['orderCount', 'Order count'],
  ['totalSpend', 'Total spend'],
]

/**
 * Render a payload into the text block given to the model.
 *
 * Only reads {@link EnrichmentPayload.context}, so it inherits the redaction
 * guarantee. Absent fields are omitted entirely rather than rendered as an
 * empty or `undefined` value.
 */
export function renderEnrichmentPrompt(payload: EnrichmentPayload): string {
  const { context } = payload

  const lines: string[] = [
    `Account type: ${payload.kind === 'company' ? 'Company' : 'Individual (private person)'}`,
    payload.webSearchAllowed
      ? 'Web search: permitted'
      : 'Web search: not permitted - this is a private individual, do not research them',
  ]

  for (const [field, label] of CONTEXT_LABELS) {
    const value = context[field]
    if (value === undefined) {
      continue
    }

    if (field === 'productsOrdered') {
      lines.push(`${label}: ${(value as string[]).join(', ')}`)
    } else if (field === 'totalSpend') {
      lines.push(`${label}: ${value}${context.currency ? ` ${context.currency}` : ''}`)
    } else {
      lines.push(`${label}: ${value}`)
    }
  }

  return lines.join('\n')
}
