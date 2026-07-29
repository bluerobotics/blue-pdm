/**
 * Customer Account Grouping
 *
 * Collapses many customer rows into "accounts". An account is the unit that
 * expensive AI research attaches to: dozens of rows routinely share one
 * company, and researching once per company instead of once per row is the
 * main cost saving in the enrichment pipeline.
 *
 * Everything here is a pure function. No database, no network.
 *
 * The account key is the load-bearing part. If the key is unstable, a trivial
 * rename in Odoo ("Acme Ltd" to "Acme Limited") mints a brand new account and
 * silently orphans research that has already been paid for. Normalisation is
 * therefore aggressive about cosmetic differences (case, punctuation, legal
 * suffixes, accents) and conservative about anything that could be a genuinely
 * different organisation.
 *
 * @module customers/grouping
 */

import type { Account, CustomerAddress, CustomerInput } from './types.js'

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANY NAME NORMALISATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Legal-form suffixes stripped from the end of a company name.
 *
 * Stored without punctuation because normalisation removes periods and joins
 * single-letter slash forms first, so "L.L.C.", "l.l.c" and "LLC" all arrive
 * here as `llc`, and "A/S" arrives as `as`.
 */
export const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  // Anglosphere
  'ltd',
  'limited',
  'llc',
  'llp',
  'lp',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'plc',
  'pty',
  'pte',
  'sdn',
  'bhd',
  // German-speaking
  'gmbh',
  'mbh',
  'ag',
  'kg',
  'ug',
  'ohg',
  'gbr',
  // Romance
  'srl',
  'sarl',
  'sas',
  'sa',
  'sl',
  'spa',
  'snc',
  'scs',
  'eurl',
  'ltda',
  'lda',
  // Low Countries
  'bv',
  'nv',
  'bvba',
  'cvba',
  'vof',
  // Nordics
  'ab',
  'as',
  'asa',
  'aps',
  'oy',
  'oyj',
  'hf',
  'ehf',
  // Central and Eastern Europe
  'kft',
  'sro',
  'doo',
  'zoo',
  'jsc',
  'pjsc',
  // Asia
  'kk',
  'gk',
])

/**
 * Trailing connector words left dangling once a suffix is removed.
 *
 * "Acme GmbH & Co. KG" normalises to `acme gmbh and co kg`; stripping only
 * legal suffixes would leave `acme gmbh and`, which would never match the same
 * company recorded as plain "Acme GmbH".
 */
const TRAILING_CONNECTORS: ReadonlySet<string> = new Set(['and', 'und', 'et', 'og', 'och'])

/**
 * Characters that do not decompose under NFKD but still need folding.
 */
const TRANSLITERATIONS: ReadonlyArray<[RegExp, string]> = [
  [/ø/g, 'o'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ß/g, 'ss'],
  [/ł/g, 'l'],
  [/đ/g, 'd'],
  [/ð/g, 'd'],
  [/þ/g, 'th'],
]

/**
 * Reduce a company name to a stable grouping token.
 *
 * Lowercases, folds accents, expands `&` to `and`, strips punctuation,
 * collapses whitespace and removes trailing legal-form suffixes, so that
 * "Acme Ltd", "ACME Limited" and "Acme Ltd." all produce `acme`.
 *
 * The result contains only `[a-z0-9]` and single spaces. That is relied upon
 * elsewhere: because periods are removed, a normalised name can never look
 * like a domain, which is what keeps name-derived and domain-derived account
 * keys from colliding.
 *
 * @param name - Raw company name from the source system
 * @returns Normalised key fragment, or an empty string if nothing survives
 */
export function normalizeCompanyName(name: string): string {
  if (typeof name !== 'string') {
    return ''
  }

  let folded = name.toLowerCase()
  for (const [pattern, replacement] of TRANSLITERATIONS) {
    folded = folded.replace(pattern, replacement)
  }

  const cleaned = folded
    // Strip combining marks left by decomposition, so "Café" matches "Cafe".
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // "R&D" and "R & D" must agree, so expand rather than delete.
    .replace(/&/g, ' and ')
    // Join single-letter slash forms ("A/S", "S/A") before the generic pass
    // turns the slash into a word break.
    .replace(/\b([a-z0-9])\/([a-z0-9])\b/g, '$1$2')
    // Periods and apostrophes join rather than split: "S.R.L." -> "srl".
    .replace(/[.'\u2019\u02bc`\u00b4]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  const tokens = cleaned.split(' ').filter(Boolean)
  while (
    tokens.length > 1 &&
    (LEGAL_SUFFIXES.has(tokens[tokens.length - 1]) ||
      TRAILING_CONNECTORS.has(tokens[tokens.length - 1]))
  ) {
    tokens.pop()
  }

  return tokens.join(' ')
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL PARSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Deliberately stricter than RFC 5322: the domain must have at least one dot,
 * labels may not start or end with a hyphen, and the TLD must be alphabetic.
 * A domain we cannot trust is worse than no domain, because it would be used
 * as an account key.
 */
const EMAIL_PATTERN = /^[^\s@]+@((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})$/

/**
 * Parse and normalise an email address, tolerating the `Name <addr>` form that
 * Odoo sometimes stores.
 *
 * @returns Lowercased address, or null if it is not confidently well-formed
 */
function parseEmailAddress(raw: string): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) {
    return null
  }

  const bracketed = /<([^<>]+)>\s*$/.exec(trimmed)
  const candidate = (bracketed ? bracketed[1] : trimmed).trim()

  return EMAIL_PATTERN.test(candidate) ? candidate : null
}

/**
 * Extract the lowercased domain from an email address.
 *
 * @param email - Raw email address
 * @returns Domain, or null if the address is missing or malformed
 */
export function extractEmailDomain(email: string): string | null {
  const address = parseEmailAddress(email)
  if (!address) {
    return null
  }
  return address.slice(address.lastIndexOf('@') + 1)
}

// ═══════════════════════════════════════════════════════════════════════════════
// FREE MAIL DOMAINS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Consumer mailbox providers.
 *
 * A customer whose only email is on one of these tells us nothing about an
 * organisation, so it routes to an individual account. A customer on any other
 * domain is treated as an organisation, since a work email implies one.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  'gmail.com',
  'googlemail.com',
  // Yahoo and country variants
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.jp',
  'yahoo.co.in',
  'yahoo.co.id',
  'yahoo.co.kr',
  'yahoo.co.nz',
  'yahoo.com.au',
  'yahoo.com.br',
  'yahoo.com.mx',
  'yahoo.com.ar',
  'yahoo.com.sg',
  'yahoo.com.hk',
  'yahoo.com.tw',
  'yahoo.com.ph',
  'yahoo.com.vn',
  'yahoo.com.tr',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.it',
  'yahoo.es',
  'yahoo.ca',
  'yahoo.se',
  'yahoo.dk',
  'yahoo.no',
  'yahoo.fi',
  'yahoo.nl',
  'yahoo.be',
  'yahoo.pl',
  'yahoo.gr',
  'yahoo.ie',
  'yahoo.at',
  'yahoo.ch',
  'yahoo.cn',
  'ymail.com',
  'rocketmail.com',
  // Microsoft
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.co.jp',
  'hotmail.com.au',
  'hotmail.com.br',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'hotmail.es',
  'hotmail.be',
  'hotmail.nl',
  'hotmail.se',
  'hotmail.no',
  'hotmail.dk',
  'hotmail.fi',
  'hotmail.ca',
  'hotmail.gr',
  'hotmail.ch',
  'hotmail.at',
  'outlook.com',
  'outlook.co.uk',
  'outlook.co.id',
  'outlook.com.au',
  'outlook.com.br',
  'outlook.fr',
  'outlook.de',
  'outlook.it',
  'outlook.es',
  'outlook.be',
  'outlook.dk',
  'outlook.pt',
  'outlook.ie',
  'outlook.cz',
  'outlook.jp',
  'live.com',
  'live.co.uk',
  'live.com.au',
  'live.fr',
  'live.de',
  'live.it',
  'live.nl',
  'live.se',
  'live.no',
  'live.dk',
  'live.ca',
  'live.cn',
  'live.jp',
  'msn.com',
  'passport.com',
  // AOL
  'aol.com',
  'aol.co.uk',
  'aim.com',
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  // Privacy-focused
  'protonmail.com',
  'protonmail.ch',
  'proton.me',
  'pm.me',
  'tutanota.com',
  'tutanota.de',
  'tuta.io',
  'hushmail.com',
  'mailfence.com',
  'disroot.org',
  'riseup.net',
  // Germany and Austria
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'gmx.at',
  'gmx.ch',
  'gmx.fr',
  'gmx.es',
  'gmx.co.uk',
  'web.de',
  't-online.de',
  'freenet.de',
  'arcor.de',
  'posteo.de',
  'mailbox.org',
  'aon.at',
  'chello.at',
  // Russia and CIS
  'mail.ru',
  'inbox.ru',
  'bk.ru',
  'list.ru',
  'internet.ru',
  'yandex.ru',
  'yandex.com',
  'yandex.by',
  'yandex.kz',
  'yandex.ua',
  'ya.ru',
  'rambler.ru',
  'ukr.net',
  // China
  'qq.com',
  'foxmail.com',
  '163.com',
  '126.com',
  'yeah.net',
  'sina.com',
  'sina.cn',
  'sohu.com',
  '21cn.com',
  'aliyun.com',
  'tom.com',
  // Korea and Japan
  'naver.com',
  'daum.net',
  'hanmail.net',
  'nate.com',
  'kakao.com',
  'docomo.ne.jp',
  'ezweb.ne.jp',
  'nifty.com',
  'biglobe.ne.jp',
  // France
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'laposte.net',
  'neuf.fr',
  'bbox.fr',
  'aliceadsl.fr',
  'club-internet.fr',
  'voila.fr',
  'numericable.fr',
  // Italy
  'libero.it',
  'virgilio.it',
  'tiscali.it',
  'tiscali.co.uk',
  'alice.it',
  'tin.it',
  'fastwebnet.it',
  'email.it',
  'inwind.it',
  'poste.it',
  // Iberia
  'terra.es',
  'telefonica.net',
  'ono.com',
  'sapo.pt',
  'iol.pt',
  'netcabo.pt',
  // Switzerland
  'bluewin.ch',
  'sunrise.ch',
  'hispeed.ch',
  // Benelux
  'telenet.be',
  'skynet.be',
  'proximus.be',
  'scarlet.be',
  'ziggo.nl',
  'kpnmail.nl',
  'home.nl',
  'planet.nl',
  'hetnet.nl',
  'xs4all.nl',
  'casema.nl',
  'chello.nl',
  'upcmail.nl',
  'zonnet.nl',
  // Nordics
  'telia.com',
  'telia.se',
  'bredband.net',
  'comhem.se',
  'spray.se',
  'online.no',
  'broadpark.no',
  'start.no',
  'getmail.no',
  'c2i.net',
  'sol.dk',
  'mail.dk',
  'stofanet.dk',
  'post.tele.dk',
  'jubii.dk',
  'luukku.com',
  'suomi24.fi',
  'elisanet.fi',
  'kolumbus.fi',
  'pp.inet.fi',
  'simnet.is',
  // United Kingdom and Ireland
  'btinternet.com',
  'btopenworld.com',
  'sky.com',
  'virginmedia.com',
  'talktalk.net',
  'ntlworld.com',
  'blueyonder.co.uk',
  'plus.net',
  'o2.co.uk',
  'orange.net',
  'eircom.net',
  // North America
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'cox.net',
  'bellsouth.net',
  'charter.net',
  'earthlink.net',
  'juno.com',
  'netzero.net',
  'roadrunner.com',
  'rr.com',
  'optonline.net',
  'frontier.com',
  'windstream.net',
  'ameritech.net',
  'pacbell.net',
  'prodigy.net',
  'mindspring.com',
  'embarqmail.com',
  'centurylink.net',
  'telus.net',
  'telusplanet.net',
  'shaw.ca',
  'sympatico.ca',
  'rogers.com',
  'videotron.ca',
  'bell.net',
  // Oceania
  'bigpond.com',
  'bigpond.net.au',
  'optusnet.com.au',
  'iinet.net.au',
  'tpg.com.au',
  'internode.on.net',
  'westnet.com.au',
  'dodo.com.au',
  'ozemail.com.au',
  'xtra.co.nz',
  'clear.net.nz',
  'slingshot.co.nz',
  'vodafone.co.nz',
  // Latin America
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'ig.com.br',
  'globo.com',
  'oi.com.br',
  'r7.com',
  'prodigy.net.mx',
  // India, Middle East, Africa
  'rediffmail.com',
  'sify.com',
  'indiatimes.com',
  'walla.co.il',
  'mynet.com',
  'mweb.co.za',
  'vodamail.co.za',
  'webmail.co.za',
  'telkomsa.net',
  // Generic and disposable
  'mail.com',
  'email.com',
  'usa.com',
  'consultant.com',
  'europe.com',
  'zoho.com',
  'fastmail.com',
  'fastmail.fm',
  'gmx.us',
  'inbox.com',
  'lycos.com',
  'excite.com',
  'yopmail.com',
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'trashmail.com',
  'sharklasers.com',
  'getnada.com',
  'dispostable.com',
  // Poland and Czechia
  'wp.pl',
  'o2.pl',
  'interia.pl',
  'onet.pl',
  'poczta.onet.pl',
  'gazeta.pl',
  'op.pl',
  'seznam.cz',
  'centrum.cz',
  'email.cz',
  'volny.cz',
  // Greece, Turkey, Balkans
  'otenet.gr',
  'in.gr',
  'hotmail.com.tr',
  'abv.bg',
  'mail.bg',
])

/**
 * Whether a domain belongs to a consumer mailbox provider.
 *
 * @param domain - Bare domain, with or without a leading `@` or trailing dot
 */
export function isFreeMailDomain(domain: string): boolean {
  if (typeof domain !== 'string') {
    return false
  }
  const normalized = domain.trim().toLowerCase().replace(/^@/, '').replace(/\.+$/, '')
  return FREE_MAIL_DOMAINS.has(normalized)
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT DERIVATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * First value that is a non-blank string, after trimming.
 */
function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) {
        return trimmed
      }
    }
  }
  return null
}

/**
 * Derive the account a customer row belongs to.
 *
 * Rules, applied in order:
 * 1. A company name (explicit, or the row's own name when it is flagged as a
 *    company) makes this a company account keyed by the normalised name.
 * 2. Otherwise an email on a non-free-mail domain makes this a company account
 *    keyed by that domain, because a work email implies an organisation.
 * 3. Otherwise it is an individual, keyed by the email address, or by the
 *    source id when there is no usable email.
 *
 * Keys are prefixed by kind so a company and a person can never collide. Within
 * the company kind, name-derived keys never contain a dot and domain-derived
 * keys always do, so those two cannot collide either.
 */
export function deriveAccount(customer: CustomerInput): Account {
  const companyName = firstNonEmpty(
    customer.company,
    customer.isCompany === true ? customer.name : null,
  )

  if (companyName) {
    const normalized = normalizeCompanyName(companyName)
    if (normalized) {
      return {
        accountKey: `company:${normalized}`,
        kind: 'company',
        displayName: companyName,
      }
    }
  }

  // Only ever key on an address we could actually parse. A malformed email
  // would otherwise become a permanent garbage key.
  const address = typeof customer.email === 'string' ? parseEmailAddress(customer.email) : null
  const domain = address ? address.slice(address.lastIndexOf('@') + 1) : null

  if (domain && !isFreeMailDomain(domain)) {
    return {
      accountKey: `company:${domain}`,
      kind: 'company',
      displayName: domain,
    }
  }

  const contactName = firstNonEmpty(customer.name)

  if (address) {
    return {
      accountKey: `individual:${address}`,
      kind: 'individual',
      displayName: contactName ?? address,
    }
  }

  const id = String(customer.id ?? '').trim()
  return {
    accountKey: `individual:id:${id}`,
    kind: 'individual',
    displayName: contactName ?? `Customer ${id}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SITE DISAMBIGUATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Country names that are commonly written several ways. Mapping them to one
 * canonical form stops a purely cosmetic difference from looking like a
 * different country.
 */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  uk: 'united kingdom',
  gb: 'united kingdom',
  'great britain': 'united kingdom',
  england: 'united kingdom',
  scotland: 'united kingdom',
  wales: 'united kingdom',
  'northern ireland': 'united kingdom',
  'united kingdom of great britain and northern ireland': 'united kingdom',
  us: 'united states',
  usa: 'united states',
  'united states of america': 'united states',
  'the netherlands': 'netherlands',
  holland: 'netherlands',
  deutschland: 'germany',
  norge: 'norway',
  sverige: 'sweden',
  danmark: 'denmark',
  suomi: 'finland',
  espana: 'spain',
  italia: 'italy',
  'republic of ireland': 'ireland',
  'korea republic of': 'south korea',
}

/**
 * Lowercase, fold accents, drop punctuation, collapse whitespace.
 */
function normalizeAddressPart(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function canonicalCountry(value: string | null | undefined): string {
  const normalized = normalizeAddressPart(value)
  return COUNTRY_ALIASES[normalized] ?? normalized
}

/**
 * Postcodes are compared with all separators removed, so "AB10 1XY" and
 * "ab101xy" are the same postcode.
 */
function normalizePostcode(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

type Comparison = 'same' | 'different' | 'unknown'

function compareCountries(a: string | null | undefined, b: string | null | undefined): Comparison {
  const left = canonicalCountry(a)
  const right = canonicalCountry(b)

  if (!left || !right) {
    return 'unknown'
  }
  if (left === right) {
    return 'same'
  }

  // A bare ISO-2 code cannot be reliably compared against a spelled-out name
  // without a full country table, so decline to answer rather than risk a
  // split. Aliases above already fold the codes we do care about.
  const leftIsCode = /^[a-z]{2}$/.test(left)
  const rightIsCode = /^[a-z]{2}$/.test(right)
  if (leftIsCode !== rightIsCode) {
    return 'unknown'
  }

  return 'different'
}

/**
 * Whether two addresses clearly describe separate physical sites.
 *
 * Intentionally hard to satisfy. A wrong split costs real money, because the
 * new key has no research attached and the account is enriched again from
 * scratch. A wrong merge only blurs one record and can be corrected later
 * without paying twice. So when the evidence is partial or ambiguous we return
 * false and let the two rows merge.
 */
export function areDistinctSites(
  a: CustomerAddress | null | undefined,
  b: CustomerAddress | null | undefined,
): boolean {
  if (!a || !b) {
    return false
  }

  if (compareCountries(a.country, b.country) === 'different') {
    return true
  }

  const cityA = normalizeAddressPart(a.city)
  const cityB = normalizeAddressPart(b.city)
  const postcodeA = normalizePostcode(a.postcode)
  const postcodeB = normalizePostcode(b.postcode)

  const cityDiffers = Boolean(cityA) && Boolean(cityB) && cityA !== cityB
  const postcodeDiffers = Boolean(postcodeA) && Boolean(postcodeB) && postcodeA !== postcodeB

  // Both signals are required. A different city alone is often just a spelling
  // or district difference, and a different postcode alone is often a separate
  // mailbox at the same site.
  return cityDiffers && postcodeDiffers
}

/**
 * Stable token identifying a site, derived only from the address itself so the
 * suffix does not depend on which row happened to be processed first.
 */
function siteSuffix(address: CustomerAddress): string {
  const parts = [canonicalCountry(address.country), normalizeAddressPart(address.city)]
    .filter(Boolean)
    .map((part) => part.replace(/ /g, '-'))

  if (parts.length > 0) {
    return parts.join('-')
  }

  return normalizePostcode(address.postcode)
}

/**
 * Split an account key when a customer sits at a clearly different site from
 * the account's reference address.
 *
 * Callers pass the account's canonical (first-seen) address as `reference`.
 * That address keeps the unsuffixed key; only genuinely different sites get a
 * suffix, and the suffix is derived from the address alone so it is stable
 * across runs.
 *
 * @param accountKey - Key produced by {@link deriveAccount}
 * @param address - Address of the row being placed
 * @param reference - Canonical address already associated with the account
 * @returns The original key, or a site-suffixed variant
 */
export function disambiguateByAddress(
  accountKey: string,
  address: CustomerAddress | null | undefined,
  reference: CustomerAddress | null | undefined,
): string {
  if (!address || !reference || !areDistinctSites(address, reference)) {
    return accountKey
  }

  const suffix = siteSuffix(address)
  return suffix ? `${accountKey}#${suffix}` : accountKey
}
