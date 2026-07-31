/**
 * Customer Enrichment Shared Types
 *
 * Narrow, transport-agnostic shapes used by the customer grouping and
 * redaction modules. These are deliberately independent of the Odoo and
 * Supabase row types: the pure modules below are the safety-critical part of
 * the enrichment pipeline and must not churn every time a schema changes.
 *
 * @module customers/types
 */

/**
 * Whether an account represents an organisation or a private person.
 *
 * This single discriminator drives the privacy boundary in
 * {@link module:customers/redaction}, so it must be decided once, in
 * {@link module:customers/grouping}, and then carried through unchanged.
 */
export type AccountKind = 'company' | 'individual'

/**
 * The minimum a customer row needs to expose for account derivation.
 */
export interface CustomerInput {
  /** Stable identifier from the source system (Odoo partner id). */
  id: string | number
  /** Contact or partner name. For company partners this is the company name. */
  name?: string | null
  /** Primary email address, possibly malformed or empty. */
  email?: string | null
  /** Parent/commercial company name, when the source system records one. */
  company?: string | null
  /** Source system flag marking the row itself as a company rather than a person. */
  isCompany?: boolean | null
}

/**
 * Postal address fields used only for conservative site disambiguation.
 */
export interface CustomerAddress {
  street?: string | null
  street2?: string | null
  city?: string | null
  postcode?: string | null
  state?: string | null
  country?: string | null
}

/**
 * The unit that expensive AI research attaches to.
 *
 * Many customer rows collapse into one account; research is paid for once per
 * account, not once per row.
 */
export interface Account {
  /** Stable, kind-prefixed grouping key. */
  accountKey: string
  kind: AccountKind
  /** Human-readable label for the account. Never sent to the model for individuals. */
  displayName: string
  /**
   * Which rule produced the key and label.
   *
   * Several customers land on one account, and they do not all name it equally
   * well - a company's own record gives its real name, an email domain gives
   * `acme.com`, and an individual gives a person's name. The caller uses this
   * to pick the best label rather than whichever row it happened to see first.
   */
  source: 'company-name' | 'email-domain' | 'individual'
}
