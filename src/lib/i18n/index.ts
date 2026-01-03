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
  'en': flattenTranslations(en),
  'fr': flattenTranslations(fr),
  'de': flattenTranslations(de),
  'es': flattenTranslations(es),
  'pt': flattenTranslations(pt),       // Portuguese
  'zh-CN': flattenTranslations(zhCN),  // Simplified Chinese (Mandarin)
  'zh-TW': flattenTranslations(zhTW),  // Traditional Chinese
  // Use English as fallback for languages not yet translated
  'it': flattenTranslations(en),
  'nl': flattenTranslations(en),
  'sv': flattenTranslations(en),
  'pl': flattenTranslations(en),
  'ru': flattenTranslations(en),
  'ja': flattenTranslations(en),
  'ko': flattenTranslations(en),
  // 🧝 Easter Egg: Sindarin (Elvish) - Uses English text with Tengwar font
  // The Tengwar font maps Latin letters to Elvish script characters,
  // making the entire UI beautifully unreadable!
  'sindarin': flattenTranslations(en),
}

/**
 * Translation hook - returns a function to translate keys
 * Usage: const { t } = useTranslation()
 *        t('preferences.language') // Returns "Language" or "Langue" etc.
 */
export function useTranslation() {
  const language = usePDMStore(state => state.language)
  
  const t = (key: string, fallback?: string): string => {
    const dict = translations[language] || translations['en']
    const enDict = translations['en']
    
    // Try current language first, then fallback to English, then to provided fallback or key
    return dict[key] || enDict[key] || fallback || key
  }
  
  return { t, language }
}

/**
 * Get translation outside of React components
 * Usage: const text = getTranslation('en', 'preferences.language')
 */
export function getTranslation(language: Language, key: string, fallback?: string): string {
  const dict = translations[language] || translations['en']
  const enDict = translations['en']
  return dict[key] || enDict[key] || fallback || key
}
