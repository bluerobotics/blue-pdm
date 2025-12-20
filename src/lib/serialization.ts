// Serialization service for generating sequential item/part numbers
// Provides org-level sync for unique serial number assignment

import { supabase } from './supabase'

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
  auto_apply_extensions: []
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_next_serial_number', {
      p_org_id: orgId
    })
    
    if (error) {
      console.error('[Serialization] Failed to get next serial number:', error)
      throw error
    }
    
    return data
  } catch (err) {
    console.error('[Serialization] Error getting next serial number:', err)
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('preview_next_serial_number', {
      p_org_id: orgId
    })
    
    if (error) {
      console.error('[Serialization] Failed to preview serial number:', error)
      throw error
    }
    
    return data
  } catch (err) {
    console.error('[Serialization] Error previewing serial number:', err)
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
      console.error('[Serialization] Failed to get settings:', error)
      return DEFAULT_SETTINGS
    }
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = (data as any)?.serialization_settings
    return {
      ...DEFAULT_SETTINGS,
      ...(settings || {})
    }
  } catch (err) {
    console.error('[Serialization] Error getting settings:', err)
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
  settings: Partial<SerializationSettings>
): Promise<boolean> {
  try {
    // First get current settings
    const current = await getSerializationSettings(orgId)
    
    // Merge with new settings
    const updated = {
      ...current,
      ...settings
    }
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('organizations') as any)
      .update({ serialization_settings: updated })
      .eq('id', orgId)
    
    if (error) {
      console.error('[Serialization] Failed to update settings:', error)
      return false
    }
    
    return true
  } catch (err) {
    console.error('[Serialization] Error updating settings:', err)
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
  counterOverride?: number
): string {
  if (!settings.enabled) {
    return ''
  }
  
  let counter = counterOverride ?? (settings.current_counter + 1)
  
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
  settings: SerializationSettings
): { isValid: boolean; error?: string } {
  if (!serialNumber) {
    return { isValid: false, error: 'Serial number is required' }
  }
  
  // Build expected pattern regex
  const prefixEscaped = escapeRegex(settings.prefix)
  const suffixEscaped = escapeRegex(settings.suffix)
  const letterPrefixEscaped = escapeRegex(settings.letter_prefix)
  
  const pattern = new RegExp(
    `^${prefixEscaped}${letterPrefixEscaped}\\d{${settings.padding_digits}}${suffixEscaped}$`
  )
  
  if (!pattern.test(serialNumber)) {
    return { 
      isValid: false, 
      error: `Serial number does not match expected format: ${settings.prefix}${settings.letter_prefix}${'0'.repeat(settings.padding_digits)}${settings.suffix}` 
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
        error: `Number ${number} is in keepout zone: ${zone.description}` 
      }
    }
  }
  
  return { isValid: true }
}

/**
 * Check if a serial number already exists in the database
 * 
 * @param orgId - Organization UUID
 * @param serialNumber - The serial number to check
 * @returns True if the serial number already exists
 */
export async function serialNumberExists(
  orgId: string,
  serialNumber: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('files')
      .select('id')
      .eq('org_id', orgId)
      .eq('part_number', serialNumber)
      .limit(1)
    
    if (error) {
      console.error('[Serialization] Failed to check serial number existence:', error)
      return false // Assume doesn't exist on error
    }
    
    return (data?.length ?? 0) > 0
  } catch (err) {
    console.error('[Serialization] Error checking serial number:', err)
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
export function shouldAutoSerialize(
  extension: string,
  settings: SerializationSettings
): boolean {
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
  extension: string
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

