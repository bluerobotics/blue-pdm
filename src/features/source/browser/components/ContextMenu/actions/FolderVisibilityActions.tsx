/**
 * Admin-only folder visibility action for the file browser context menu.
 */
import { FolderVisibilityMenuItem } from '@/components/shared/HiddenFolder'

import type { ActionComponentProps } from './types'

export function FolderVisibilityActions({ multiSelect, firstFile, onClose }: ActionComponentProps) {
  return <FolderVisibilityMenuItem folder={firstFile} multiSelect={multiSelect} onClose={onClose} />
}
