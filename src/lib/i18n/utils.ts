import type { TranslationDict, FlatTranslations } from './types'

/**
 * Flatten nested translation keys
 * e.g., { settings: { title: "Settings" } } -> { "settings.title": "Settings" }
 */
export function flattenTranslations(
  obj: TranslationDict,
  prefix = ''
): FlatTranslations {
  const result: FlatTranslations = {}

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      result[fullKey] = value
    } else {
      Object.assign(result, flattenTranslations(value as TranslationDict, fullKey))
    }
  }

  return result
}
