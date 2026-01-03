# Agent 3: i18n Locale Files Split

## Mission
Split `src/lib/i18n.ts` (2,305 lines) into per-language locale files.

## Current Branch
`refactor/enterprise-organization` → Create `refactor/enterprise-phase2` if not exists

---

## YOUR BOUNDARIES - READ CAREFULLY

### Files YOU OWN (can create/modify):
```
src/lib/
├── i18n.ts                         ← DELETE after migration
├── i18n/                           ← CREATE directory
│   ├── index.ts                    ← CREATE (main exports, t() hook)
│   ├── types.ts                    ← CREATE (TranslationDict, Language)
│   ├── utils.ts                    ← CREATE (flattenTranslations)
│   └── locales/
│       ├── index.ts                ← CREATE (locale registry)
│       ├── en.ts                   ← CREATE (English)
│       ├── fr.ts                   ← CREATE (French)
│       ├── de.ts                   ← CREATE (German)
│       ├── es.ts                   ← CREATE (Spanish)
│       └── pt.ts                   ← CREATE (Portuguese)
```

### Files YOU MUST NOT TOUCH:
```
❌ src/lib/commands/                (Agent 1's domain)
❌ src/lib/supabase/                (already refactored)
❌ src/components/                  (Agents 2 & 4's domain)
❌ src/stores/                      (already refactored)
❌ electron/                        (already refactored)
❌ Any file not in src/lib/i18n.ts or src/lib/i18n/
```

---

## Current State Analysis

`src/lib/i18n.ts` (2,305 lines) contains:

1. **Type definitions** (lines 1-21)
   - TranslationValue, TranslationDict types
   - flattenTranslations() utility

2. **English translations** (lines 24-407) - ~383 lines
   - common, welcome, vault, files, settings, etc.

3. **French translations** (lines 408-717) - ~309 lines

4. **German translations** (lines 718-1027) - ~309 lines

5. **Spanish translations** (lines 1028-1957) - ~929 lines

6. **Portuguese translations** (lines 1958-2267) - ~309 lines

7. **Translation system** (lines 2268-2305)
   - translations object combining all locales
   - t() function for getting translations
   - useCurrentLanguage() hook

---

## Implementation Steps

### Step 1: Create directory structure

```bash
src/lib/i18n/
├── index.ts
├── types.ts
├── utils.ts
└── locales/
    ├── index.ts
    ├── en.ts
    ├── fr.ts
    ├── de.ts
    ├── es.ts
    └── pt.ts
```

### Step 2: Create types.ts

```typescript
// src/lib/i18n/types.ts

// Supported languages
export type Language = 'en' | 'fr' | 'de' | 'es' | 'pt'

// Translation value can be a string or nested object (up to 3 levels)
export type TranslationValue = string | Record<string, string | Record<string, string>>

// Translation dictionary structure
export type TranslationDict = Record<string, TranslationValue>

// Flattened translations (dot notation keys)
export type FlatTranslations = Record<string, string>
```

### Step 3: Create utils.ts

```typescript
// src/lib/i18n/utils.ts
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
```

### Step 4: Create locale files

```typescript
// src/lib/i18n/locales/en.ts
import type { TranslationDict } from '../types'

export const en: TranslationDict = {
  // Common
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    // ... rest of common translations
  },
  
  // Welcome/Auth Screen
  welcome: {
    title: 'BluePLM',
    tagline: 'Open source Product Lifecycle Management for everyone who builds',
    // ... rest of welcome translations
  },
  
  // ... all other sections from original file
}
```

Repeat for `fr.ts`, `de.ts`, `es.ts`, `pt.ts` - each containing the respective language's translations from the original file.

### Step 5: Create locales/index.ts

```typescript
// src/lib/i18n/locales/index.ts
import type { Language, TranslationDict } from '../types'
import { en } from './en'
import { fr } from './fr'
import { de } from './de'
import { es } from './es'
import { pt } from './pt'

export const locales: Record<Language, TranslationDict> = {
  en,
  fr,
  de,
  es,
  pt
}

export { en, fr, de, es, pt }
```

### Step 6: Create main index.ts

```typescript
// src/lib/i18n/index.ts
import { usePDMStore } from '../../stores/pdmStore'
import type { Language, FlatTranslations } from './types'
import { flattenTranslations } from './utils'
import { locales } from './locales'

// Pre-flatten all translations for fast lookup
const flattenedTranslations: Record<Language, FlatTranslations> = {
  en: flattenTranslations(locales.en),
  fr: flattenTranslations(locales.fr),
  de: flattenTranslations(locales.de),
  es: flattenTranslations(locales.es),
  pt: flattenTranslations(locales.pt),
}

/**
 * Get a translated string by key
 * Falls back to English if key not found in current language
 */
export function t(key: string, language?: Language): string {
  const lang = language || usePDMStore.getState().language || 'en'
  
  // Try current language first
  const translation = flattenedTranslations[lang]?.[key]
  if (translation) return translation
  
  // Fallback to English
  const fallback = flattenedTranslations.en?.[key]
  if (fallback) return fallback
  
  // Return key if not found (helps identify missing translations)
  console.warn(`[i18n] Missing translation: ${key}`)
  return key
}

/**
 * Hook to get current language from store
 */
export function useCurrentLanguage(): Language {
  return usePDMStore(state => state.language) || 'en'
}

/**
 * Get all available languages
 */
export function getAvailableLanguages(): Language[] {
  return ['en', 'fr', 'de', 'es', 'pt']
}

// Re-export types for external use
export type { Language, TranslationDict, TranslationValue } from './types'
export { flattenTranslations } from './utils'
export { locales } from './locales'
```

### Step 7: Delete old file and verify imports

After creating all new files, delete `src/lib/i18n.ts`.

All existing imports like:
```typescript
import { t } from '../lib/i18n'
```

Will automatically resolve to:
```typescript
import { t } from '../lib/i18n/index'
```

---

## Locale File Line Counts

| File | Language | Approx Lines |
|------|----------|--------------|
| `en.ts` | English | ~400 |
| `fr.ts` | French | ~320 |
| `de.ts` | German | ~320 |
| `es.ts` | Spanish | ~950 |
| `pt.ts` | Portuguese | ~320 |
| `types.ts` | Types | ~20 |
| `utils.ts` | Utilities | ~25 |
| `index.ts` | Main exports | ~60 |
| `locales/index.ts` | Registry | ~20 |

---

## Verification Checklist

Before finishing, verify:

- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] Old `src/lib/i18n.ts` is deleted
- [ ] `t('common.save')` returns 'Save' in English
- [ ] Language switching still works
- [ ] No imports from forbidden directories
- [ ] All 5 languages have complete translations

---

## Definition of Done

1. ✅ New `src/lib/i18n/` directory created
2. ✅ 5 locale files (en, fr, de, es, pt)
3. ✅ types.ts, utils.ts, index.ts created
4. ✅ Old i18n.ts deleted
5. ✅ Backward compatible (existing imports work)
6. ✅ TypeScript compiles with no errors
