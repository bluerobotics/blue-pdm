import { Eye, EyeOff } from 'lucide-react'

import { useHiddenFolders } from '@/hooks/useHiddenFolders'
import { useTranslation } from '@/lib/i18n'
import type { LocalFile } from '@/stores/pdmStore'

interface FolderVisibilityMenuItemProps {
  folder: LocalFile | undefined
  multiSelect: boolean
  onClose: () => void
}

/**
 * Context menu entry that hides a folder from non-admins.
 *
 * Cosmetic decluttering only: the files stay readable through the API, so the copy
 * must never imply access control.
 */
export function FolderVisibilityMenuItem({
  folder,
  multiSelect,
  onClose,
}: FolderVisibilityMenuItemProps) {
  const { t } = useTranslation()
  const { isAdmin, isMarkedHidden, toggleFolderHidden, isSaving } = useHiddenFolders()

  if (!isAdmin || multiSelect || !folder?.isDirectory) return null

  const hidden = isMarkedHidden(folder.relativePath)

  return (
    <div
      className={`context-menu-item ${isSaving ? 'disabled' : ''}`}
      title={t('hiddenFolders.notAccessControl')}
      onClick={() => {
        if (isSaving) return
        void toggleFolderHidden(folder.relativePath)
        onClose()
      }}
    >
      {hidden ? <Eye size={14} /> : <EyeOff size={14} />}
      {hidden ? t('hiddenFolders.showToEveryone') : t('hiddenFolders.hideFromNonAdmins')}
    </div>
  )
}
