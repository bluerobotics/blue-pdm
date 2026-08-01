// i18n module - internationalization support for BluePLM
// Re-export types
export type { Language, TranslationValue, TranslationDict, FlatTranslations } from './types'

// Re-export utilities
export { flattenTranslations } from './utils'

// Import locales and utilities
import { en, fr, de, es, pt, zhCN, zhTW } from './locales'
import { flattenTranslations } from './utils'
import type { Language } from './types'
import { usePDMStore } from '@/stores/pdmStore'

// All translations indexed by language code
const translations: Record<Language, Record<string, string>> = {
  en: flattenTranslations(en),
  fr: flattenTranslations(fr),
  de: flattenTranslations(de),
  es: flattenTranslations(es),
  pt: flattenTranslations(pt), // Portuguese
  'zh-CN': flattenTranslations(zhCN), // Simplified Chinese (Mandarin)
  'zh-TW': flattenTranslations(zhTW), // Traditional Chinese
  // Use English as fallback for languages not yet translated
  it: flattenTranslations(en),
  nl: flattenTranslations(en),
  sv: flattenTranslations(en),
  pl: flattenTranslations(en),
  ru: flattenTranslations(en),
  ja: flattenTranslations(en),
  ko: flattenTranslations(en),
  // 🧝 Easter Egg: Sindarin (Elvish) - Uses English text with Tengwar font
  // The Tengwar font maps Latin letters to Elvish script characters,
  // making the entire UI beautifully unreadable!
  sindarin: flattenTranslations(en),
}

/** Values substituted into a string's `{{placeholders}}`. */
export type TranslationParams = Record<string, string | number>

function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/**
 * Translation hook - returns a function to translate keys
 * Usage: const { t } = useTranslation()
 *        t('preferences.language') // Returns "Language" or "Langue" etc.
 *        t('workflows.transition.moved', { state: 'Released' })
 */
export function useTranslation() {
  const language = usePDMStore((state) => state.language)

  const t = (key: string, fallbackOrParams?: string | TranslationParams): string =>
    getTranslation(language, key, fallbackOrParams)

  return { t, language }
}

/**
 * Standalone translation function — reads the active language from the store.
 * Safe to call anywhere (components, callbacks, utility functions).
 */
export function t(key: string, fallbackOrParams?: string | TranslationParams): string {
  const language = usePDMStore.getState().language
  return getTranslation(language, key, fallbackOrParams)
}

/**
 * Get translation outside of React components
 * Usage: const text = getTranslation('en', 'preferences.language')
 *
 * The third argument is either a fallback string for a missing key, or the
 * values to substitute into the string's `{{placeholders}}`.
 */
export function getTranslation(
  language: Language,
  key: string,
  fallbackOrParams?: string | TranslationParams,
): string {
  const dict = translations[language] || translations['en']
  const enDict = translations['en']
  const isFallback = typeof fallbackOrParams === 'string'
  const text = dict[key] || enDict[key] || (isFallback ? fallbackOrParams : key)
  return isFallback ? text : interpolate(text, fallbackOrParams)
}
