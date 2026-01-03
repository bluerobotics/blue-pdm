import { useEffect } from 'react'
import { usePDMStore } from '@/stores/pdmStore'

/**
 * Apply language to document (for Elvish Easter egg font)
 */
export function useLanguage() {
  const language = usePDMStore(s => s.language)
  
  useEffect(() => {
    document.documentElement.setAttribute('data-language', language)
  }, [language])
}
