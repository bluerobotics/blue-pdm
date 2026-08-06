import { useCallback, useMemo, useState } from 'react'

import {
  isFolderMarkedHidden,
  readHiddenFolderPaths,
  toggleHiddenFolderPath,
} from '@/lib/hiddenFolders'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import type { OrgSettings } from '@/types/pdm'
import type { Json } from '@/types/supabase'

const NO_HIDDEN_PATHS: string[] = []

export interface UseHiddenFoldersResult {
  /** Every folder an admin has marked hidden, regardless of who is looking. */
  hiddenFolderPaths: string[]
  /** Paths to strip from the interface for the current user — empty for admins. */
  enforcedHiddenPaths: string[]
  isAdmin: boolean
  /** Whether this exact folder carries the hidden mark (used for the admin badge). */
  isMarkedHidden: (folderPath: string) => boolean
  toggleFolderHidden: (folderPath: string) => Promise<void>
  isSaving: boolean
}

/**
 * Admin-only folder visibility, backed by `organizations.settings.admin_only_folders`.
 *
 * Hiding is cosmetic decluttering: the underlying rows stay readable for every
 * organisation member, so nothing here may be presented as an access restriction.
 */
export function useHiddenFolders(): UseHiddenFoldersResult {
  const organization = usePDMStore((s) => s.organization)
  const setOrganization = usePDMStore((s) => s.setOrganization)
  const addToast = usePDMStore((s) => s.addToast)
  const isAdmin = usePDMStore((s) => s.getEffectiveRole() === 'admin')

  const [isSaving, setIsSaving] = useState(false)

  const hiddenFolderPaths = useMemo(
    () => readHiddenFolderPaths(organization?.settings),
    [organization?.settings],
  )

  const enforcedHiddenPaths = isAdmin ? NO_HIDDEN_PATHS : hiddenFolderPaths

  const isMarkedHidden = useCallback(
    (folderPath: string) => isFolderMarkedHidden(folderPath, hiddenFolderPaths),
    [hiddenFolderPaths],
  )

  const toggleFolderHidden = useCallback(
    async (folderPath: string) => {
      if (!organization) return

      const willHide = !isFolderMarkedHidden(folderPath, hiddenFolderPaths)
      setIsSaving(true)
      try {
        // Re-read settings first so a concurrent admin edit to another key is not clobbered.
        const { data: currentOrg } = await supabase
          .from('organizations')
          .select('settings')
          .eq('id', organization.id)
          .single()

        const remoteSettings =
          (currentOrg?.settings as unknown as OrgSettings | null) ?? organization.settings
        const newSettings: OrgSettings = {
          ...remoteSettings,
          admin_only_folders: toggleHiddenFolderPath(
            readHiddenFolderPaths(remoteSettings),
            folderPath,
          ),
        }

        const { data: updateResult, error } = await supabase
          .from('organizations')
          .update({ settings: newSettings as unknown as Json })
          .eq('id', organization.id)
          .select('settings')
          .single()

        if (error) throw error
        if (!updateResult) {
          throw new Error(t('hiddenFolders.updateNotPermitted'))
        }

        setOrganization({ ...organization, settings: newSettings })
        addToast('success', willHide ? t('hiddenFolders.hidden') : t('hiddenFolders.unhidden'))
      } catch (error) {
        log.error('[HiddenFolders]', 'Failed to update admin-only folders', { error })
        addToast('error', error instanceof Error ? error.message : t('hiddenFolders.updateFailed'))
      } finally {
        setIsSaving(false)
      }
    },
    [organization, hiddenFolderPaths, setOrganization, addToast],
  )

  return {
    hiddenFolderPaths,
    enforcedHiddenPaths,
    isAdmin,
    isMarkedHidden,
    toggleFolderHidden,
    isSaving,
  }
}
