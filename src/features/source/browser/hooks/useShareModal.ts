import { useState } from 'react'
import type { LocalFile } from '@/stores/pdmStore'

export interface UseShareModalReturn {
  // Modal visibility
  showShareModal: boolean
  setShowShareModal: (show: boolean) => void

  // File being shared
  shareFile: LocalFile | null
  setShareFile: (file: LocalFile | null) => void

  // Form state. Expiry is the only property of an issued link BluePLM can hold,
  // because the recipient is handed a Supabase Storage signed URL directly.
  shareExpiresInDays: number | null
  setShareExpiresInDays: (days: number | null) => void

  // Generated link state
  generatedShareLink: string | null
  setGeneratedShareLink: (link: string | null) => void
  isCreatingShareLink: boolean
  setIsCreatingShareLink: (creating: boolean) => void
  copiedLink: boolean
  setCopiedLink: (copied: boolean) => void
}

/**
 * Hook to manage share link modal state
 */
export function useShareModal(): UseShareModalReturn {
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareFile, setShareFile] = useState<LocalFile | null>(null)
  const [shareExpiresInDays, setShareExpiresInDays] = useState<number | null>(7)
  const [generatedShareLink, setGeneratedShareLink] = useState<string | null>(null)
  const [isCreatingShareLink, setIsCreatingShareLink] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  return {
    showShareModal,
    setShowShareModal,
    shareFile,
    setShareFile,
    shareExpiresInDays,
    setShareExpiresInDays,
    generatedShareLink,
    setGeneratedShareLink,
    isCreatingShareLink,
    setIsCreatingShareLink,
    copiedLink,
    setCopiedLink,
  }
}
