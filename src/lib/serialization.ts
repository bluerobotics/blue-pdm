// Serialization service for generating sequential item/part numbers
// Provides org-level sync for unique serial number assignment

import { supabase } from './supabase'
import { log } from './logger'

export interface SerializationSettings {
  enabled: boolean
  prefix: string
  suffix: string
  padding_digits: number
  letter_count: number
  current_counter: number
  use_letters_before_numbers: boolean
  letter_prefix: string
  keepout_zones: KeepoutZone[]
  auto_apply_extensions: string[]
  // Tab number settings
  tab_enabled: boolean
  tab_separator: string
  tab_padding_digits: number
  tab_required: boolean // If false, tab is optional (base numbers can exist without tab)
  // Tab character settings
  tab_allow_letters: boolean // Allow A-Z in tab numbers
  tab_allow_numbers: boolean // Allow 0-9 in tab numbers
  tab_allow_special: boolean // Allow special characters in tab numbers
  tab_special_chars: string // Which special characters are allowed (e.g., "-_")
  // Auto-format settings
  auto_pad_numbers: boolean // Auto-add leading zeros when editing
}

export interface KeepoutZone {
  start: number
  end_num: number
  description: string
}

const DEFAULT_SETTINGS: SerializationSettings = {
  enabled: true,
  prefix: 'PN-',
  suffix: '',
  padding_digits: 5,
  letter_count: 0,
  current_counter: 0,
  use_letters_before_numbers: false,
  letter_prefix: '',
  keepout_zones: [],
  auto_apply_extensions: [],
  // Tab number settings
  tab_enabled: false,
  tab_separator: '-',
  tab_padding_digits: 3,
  tab_required: false, // Default: tabs are optional
  // Tab character settings (defaults are backwards compatible - numbers only)
  tab_allow_letters: false,
  tab_allow_numbers: true,
  tab_allow_special: false,
  tab_special_chars: '-_',
  // Auto-format settings
  auto_pad_numbers: true, // Default to auto-padding
}

/**
 * Get the next serial number for an organization
 * This calls the database function which handles atomic increment and keepout zones
 *
 * @param orgId - Organization UUID
 * @returns The next serial number string, or null if disabled/error
 */
export async function getNextSerialNumber(orgId: string): Promise<string | null> {
  try {
    // Supabase v2 RPC type inference incomplete for custom functions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_next_serial_number', { // TODO: type this
      p_org_id: orgId,
    })

    if (error) {
      log.error('[Serialization]', 'Failed to get next serial number', { error })
      throw error
    }

    return data
  } catch (error) {
    log.error('[Serialization]', 'Error getting next serial number', { error: error })
    return null
  }
}

/**
 * Preview the next serial number without incrementing the counter
 * Useful for showing what the next number will be before committing
 *
 * @param orgId - Organization UUID
 * @returns The preview serial number string, or null if disabled/error
 */
export async function previewNextSerialNumber(orgId: string): Promise<string | null> {
  try {
    // Supabase v2 RPC type inference incomplete for custom functions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('preview_next_serial_number', { // TODO: type this
      p_org_id: orgId,
    })

    if (error) {
      log.error('[Serialization]', 'Failed to preview serial number', { error })
      throw error
    }

    return data
  } catch (error) {
    log.error('[Serialization]', 'Error previewing serial number', { error: error })
    return null
  }
}

/**
 * Get the current serialization settings for an organization
 *
 * @param orgId - Organization UUID
 * @returns The serialization settings or default values
 */
export async function getSerializationSettings(orgId: string): Promise<SerializationSettings> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('serialization_settings')
      .eq('id', orgId)
      .single()

    if (error) {
      log.error('[Serialization]', 'Failed to get settings', { error })
      return DEFAULT_SETTINGS
    }

    // Supabase v2 JSONB column type inference incomplete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = (data as any)?.serialization_settings // TODO: type this
    return {
      ...DEFAULT_SETTINGS,
      ...(settings || {}),
    }
  } catch (error) {
    log.error('[Serialization]', 'Error getting settings', { error: error })
    return DEFAULT_SETTINGS
  }
}

/**
 * Update serialization settings for an organization
 *
 * @param orgId - Organization UUID
 * @param settings - Partial settings to update
 * @returns Success boolean
 */
export async function updateSerializationSettings(
  orgId: string,
  settings: Partial<SerializationSettings>,
): Promise<boolean> {
  try {
    // First get current settings
    const current = await getSerializationSettings(orgId)

    // Merge with new settings
    const updated = {
      ...current,
      ...settings,
    }

    // Supabase v2 type inference incomplete for JSONB column updates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('organizations') as any) // TODO: type this
      .update({ serialization_settings: updated })
      .eq('id', orgId)

    if (error) {
      log.error('[Serialization]', 'Failed to update settings', { error })
      return false
    }

    return true
  } catch (error) {
    log.error('[Serialization]', 'Error updating settings', { error: error })
    return false
  }
}

/**
 * Generate a serial number locally (without database call)
 * Useful for preview/display purposes only - does NOT increment the counter
 *
 * @param settings - Serialization settings
 * @param counterOverride - Optional counter value to use (defaults to current + 1)
 * @returns The formatted serial number string
 */
export function formatSerialNumber(
  settings: SerializationSettings,
  counterOverride?: number,
): string {
  if (!settings.enabled) {
    return ''
  }

  let counter = counterOverride ?? settings.current_counter + 1

  // Skip keepout zones
  for (const zone of settings.keepout_zones) {
    if (counter >= zone.start && counter <= zone.end_num) {
      counter = zone.end_num + 1
    }
  }

  let serial = settings.prefix

  if (settings.letter_prefix) {
    serial += settings.letter_prefix
  }

  serial += String(counter).padStart(settings.padding_digits, '0')
  serial += settings.suffix

  return serial
}

/**
 * Validate a serial number against the current settings pattern
 *
 * @param serialNumber - The serial number to validate
 * @param settings - Serialization settings
 * @returns Object with isValid boolean and optional error message
 */
export function validateSerialNumber(
  serialNumber: string,
  settings: SerializationSettings,
): { isValid: boolean; error?: string } {
  if (!serialNumber) {
    return { isValid: false, error: 'Serial number is required' }
  }

  // Build expected pattern regex
  const prefixEscaped = escapeRegex(settings.prefix)
  const suffixEscaped = escapeRegex(settings.suffix)
  const letterPrefixEscaped = escapeRegex(settings.letter_prefix)

  const pattern = new RegExp(
    `^${prefixEscaped}${letterPrefixEscaped}\\d{${settings.padding_digits}}${suffixEscaped}$`,
  )

  if (!pattern.test(serialNumber)) {
    return {
      isValid: false,
      error: `Serial number does not match expected format: ${settings.prefix}${settings.letter_prefix}${'0'.repeat(settings.padding_digits)}${settings.suffix}`,
    }
  }

  // Extract the numeric part and check if it's in a keepout zone
  const numericPart = serialNumber
    .replace(settings.prefix, '')
    .replace(settings.letter_prefix, '')
    .replace(settings.suffix, '')

  const number = parseInt(numericPart, 10)

  for (const zone of settings.keepout_zones) {
    if (number >= zone.start && number <= zone.end_num) {
      return {
        isValid: false,
        error: `Number ${number} is in keepout zone: ${zone.description}`,
      }
    }
  }

  return { isValid: true }
}

/**
 * Check whether a part number matches the org's serialization FORMAT only.
 *
 * Unlike validateSerialNumber, this ignores keepout zones (an already-assigned
 * part number that happens to fall in a keepout range should still be recognized
 * as matching the format). Used by the Item Browser to filter to org part numbers.
 *
 * @param serialNumber - The part number to test (base number, no tab)
 * @param settings - Serialization settings
 * @returns true if the string matches the prefix + letters + digits + suffix pattern
 */
export function matchesSerialFormat(
  serialNumber: string,
  settings: SerializationSettings,
): boolean {
  if (!serialNumber) return false

  const prefixEscaped = escapeRegex(settings.prefix)
  const suffixEscaped = escapeRegex(settings.suffix)
  const letterPrefixEscaped = escapeRegex(settings.letter_prefix)

  const pattern = new RegExp(
    `^${prefixEscaped}${letterPrefixEscaped}\\d{${settings.padding_digits}}${suffixEscaped}$`,
  )

  return pattern.test(serialNumber)
}

/**
 * Check if a serial number already exists in the database
 *
 * @param orgId - Organization UUID
 * @param serialNumber - The serial number to check
 * @returns True if the serial number already exists
 */
export async function serialNumberExists(orgId: string, serialNumber: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('files')
      .select('id')
      .eq('org_id', orgId)
      .eq('part_number', serialNumber)
      .limit(1)

    if (error) {
      log.error('[Serialization]', 'Failed to check serial number existence', { error })
      return false // Assume doesn't exist on error
    }

    return (data?.length ?? 0) > 0
  } catch (error) {
    log.error('[Serialization]', 'Error checking serial number', { error: error })
    return false
  }
}

/**
 * Check if a file extension should receive auto-serialization
 *
 * @param extension - The file extension (with or without leading dot)
 * @param settings - Serialization settings
 * @returns True if the extension is in the auto-apply list
 */
export function shouldAutoSerialize(extension: string, settings: SerializationSettings): boolean {
  if (!settings.enabled) return false
  if (!settings.auto_apply_extensions || settings.auto_apply_extensions.length === 0) return false

  const normalizedExt = extension.toLowerCase().startsWith('.')
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`

  return settings.auto_apply_extensions.includes(normalizedExt)
}

/**
 * Get the next serial number for a file if it should be auto-serialized
 * Returns null if the extension is not in the auto-apply list
 *
 * @param orgId - Organization UUID
 * @param extension - The file extension
 * @returns The next serial number or null
 */
export async function getAutoSerialNumber(
  orgId: string,
  extension: string,
): Promise<string | null> {
  const settings = await getSerializationSettings(orgId)

  if (!shouldAutoSerialize(extension, settings)) {
    return null
  }

  return getNextSerialNumber(orgId)
}

// Helper to escape special regex characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Format just the base number portion (without tab)
 */
export function formatBaseNumber(
  settings: SerializationSettings,
  counterOverride?: number,
): string {
  if (!settings.enabled) return ''

  let counter = counterOverride ?? settings.current_counter + 1

  // Skip keepout zones
  for (const zone of settings.keepout_zones) {
    if (counter >= zone.start && counter <= zone.end_num) {
      counter = zone.end_num + 1
    }
  }

  let serial = settings.prefix

  if (settings.letter_prefix) {
    serial += settings.letter_prefix
  }

  serial += String(counter).padStart(settings.padding_digits, '0')
  // Note: suffix is NOT included in base - it would go after tab if needed

  return serial
}

/**
 * Format a tab number with proper padding
 */
export function formatTabNumber(settings: SerializationSettings, tabNumber: number): string {
  if (!settings.tab_enabled) return ''
  return String(tabNumber).padStart(settings.tab_padding_digits, '0')
}

/**
 * Auto-pad a tab value with leading zeros if it's purely numeric
 * Used when user finishes editing a tab field
 */
export function autoPadTab(value: string, settings: SerializationSettings): string {
  if (!value || !settings.auto_pad_numbers) return value
  // Only pad if the value is purely numeric
  if (/^\d+$/.test(value)) {
    return value.padStart(settings.tab_padding_digits, '0')
  }
  // Non-numeric (like "XXX") - return as-is
  return value
}

/**
 * Normalize a tab number by stripping leading separator characters
 *
 * Some SolidWorks templates store tab numbers with a leading dash (e.g., "-500")
 * which causes double separators when combined with base numbers.
 * This function strips those leading separators to prevent "BR-107151--500".
 *
 * @param tabNumber - The tab number value (may include leading separator)
 * @param separator - The separator to strip (defaults to "-")
 * @returns The tab number without leading separator, or empty string if null/undefined
 *
 * @example
 * normalizeTabNumber("-500", "-")  // returns "500"
 * normalizeTabNumber("500", "-")   // returns "500"
 * normalizeTabNumber("-XXX", "-")  // returns "XXX"
 * normalizeTabNumber(null)         // returns ""
 */
export function normalizeTabNumber(
  tabNumber: string | null | undefined,
  separator: string = '-',
): string {
  if (!tabNumber) return ''

  let normalized = tabNumber.trim()

  // Strip leading separator(s) - handle cases like "--500" too
  while (normalized.startsWith(separator)) {
    normalized = normalized.slice(separator.length)
  }

  return normalized
}

/**
 * Combine base number and tab number into full part number
 */
export function combineBaseAndTab(
  baseNumber: string,
  tabNumber: string,
  settings: SerializationSettings,
): string {
  if (!baseNumber) return ''
  if (!settings.tab_enabled || !tabNumber) {
    return baseNumber + settings.suffix
  }
  return baseNumber + settings.tab_separator + tabNumber + settings.suffix
}

/**
 * Parse a full part number into base and tab components
 * Returns { base, tab } or null if can't parse
 *
 * Handles cases where the separator character also appears in the base format
 * by matching the expected base pattern (prefix + letter_prefix + digits)
 */
export function parsePartNumber(
  partNumber: string,
  settings: SerializationSettings,
): { base: string; tab: string } | null {
  if (!partNumber) return null

  // Remove suffix first if present
  let working = partNumber
  if (settings.suffix && working.endsWith(settings.suffix)) {
    working = working.slice(0, -settings.suffix.length)
  }

  // If tab is not enabled, return the whole thing as base
  if (!settings.tab_enabled || !settings.tab_separator) {
    return { base: working, tab: '' }
  }

  // Strategy: Find where the base ends and tab begins
  // Base format is: prefix + letter_prefix + numeric_part
  // Tab is: separator + numeric_part (with specific padding)

  // Build the expected base pattern
  const basePattern = settings.prefix + (settings.letter_prefix || '')

  // Check if the part number starts with the expected base pattern
  if (working.startsWith(basePattern)) {
    // Find where the first numeric sequence after the prefix ends
    const afterPrefix = working.slice(basePattern.length)
    const numericMatch = afterPrefix.match(/^\d+/)

    if (numericMatch) {
      const numericPart = numericMatch[0]
      const potentialBase = basePattern + numericPart
      const remainder = working.slice(potentialBase.length)

      // Check if remainder starts with separator followed by alphanumeric tab
      // Tab can be digits (001) or letters (XXX for "all tabs")
      if (remainder.startsWith(settings.tab_separator)) {
        const potentialTab = remainder.slice(settings.tab_separator.length)
        if (/^[A-Za-z0-9]+$/.test(potentialTab)) {
          return { base: potentialBase, tab: potentialTab }
        }
      }

      // No valid tab found, return base as identified
      return { base: potentialBase, tab: '' }
    }
  }

  // Fallback: Can't match expected base pattern
  // Try the old logic with lastIndexOf for backwards compatibility
  const sepIndex = working.lastIndexOf(settings.tab_separator)
  if (sepIndex > 0) {
    const base = working.slice(0, sepIndex)
    const tab = working.slice(sepIndex + settings.tab_separator.length)
    // Accept alphanumeric tabs (digits like 001 or letters like XXX)
    if (/^[A-Za-z0-9]+$/.test(tab)) {
      return { base, tab }
    }
  }

  // No tab found
  return { base: working, tab: '' }
}

/**
 * Extract the numeric counter value from a base number
 * Returns the number or null if can't parse
 */
export function extractCounterFromBase(
  baseNumber: string,
  settings: SerializationSettings,
): number | null {
  if (!baseNumber) return null

  let working = baseNumber

  // Remove prefix
  if (settings.prefix && working.startsWith(settings.prefix)) {
    working = working.slice(settings.prefix.length)
  }

  // Remove letter prefix
  if (settings.letter_prefix && working.startsWith(settings.letter_prefix)) {
    working = working.slice(settings.letter_prefix.length)
  }

  // What remains should be the numeric part
  const match = working.match(/^(\d+)/)
  if (match) {
    return parseInt(match[1], 10)
  }

  return null
}

/**
 * Find the highest used serial number in a list of part numbers
 * Useful for detecting where to start the counter
 */
export function findHighestSerialNumber(
  partNumbers: string[],
  settings: SerializationSettings,
): { highestCounter: number; highestPartNumber: string } | null {
  let highestCounter = -1
  let highestPartNumber = ''

  for (const pn of partNumbers) {
    if (!pn) continue

    const parsed = parsePartNumber(pn, settings)
    if (!parsed) continue

    const counter = extractCounterFromBase(parsed.base, settings)
    if (counter !== null && counter > highestCounter) {
      highestCounter = counter
      highestPartNumber = pn
    }
  }

  if (highestCounter < 0) return null
  return { highestCounter, highestPartNumber }
}

/**
 * Scan organization files and find the highest used serial number
 */
export async function detectHighestSerialNumber(
  orgId: string,
): Promise<{ highestCounter: number; highestPartNumber: string; totalScanned: number } | null> {
  try {
    const settings = await getSerializationSettings(orgId)

    // Fetch all part numbers from the organization
    const { data, error } = await supabase
      .from('files')
      .select('part_number')
      .eq('org_id', orgId)
      .not('part_number', 'is', null)

    if (error) {
      log.error('[Serialization]', 'Failed to scan files', { error })
      return null
    }

    // Supabase v2 nested select type inference incomplete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partNumbers = ((data || []) as { part_number: string | null }[])
      .map((f) => f.part_number)
      .filter(Boolean) as string[]
    const result = findHighestSerialNumber(partNumbers, settings)

    if (!result) {
      return { highestCounter: 0, highestPartNumber: '', totalScanned: partNumbers.length }
    }

    return {
      ...result,
      totalScanned: partNumbers.length,
    }
  } catch (error) {
    log.error('[Serialization]', 'Error detecting highest serial', { error: error })
    return null
  }
}
