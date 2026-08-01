import {
  FolderOpen,
  File,
  FileBox,
  Layers,
  FilePen,
  FileType,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  FileText,
  Cpu,
} from 'lucide-react'
import { getFileIconType } from '@/lib/utils'

export interface FileCardIconProps {
  file: {
    name: string
    extension: string
    isDirectory: boolean
  }
  iconSize: number
  thumbnail: string | null
  folderIconColor: string
  onThumbnailError: () => void
}

/**
 * Renders the appropriate icon for a file/folder
 */
export function FileCardIcon({
  file,
  iconSize,
  thumbnail,
  folderIconColor,
  onThumbnailError,
}: FileCardIconProps) {
  const iconSizeScaled = iconSize * 0.6
  const iconType = getFileIconType(file.extension)

  // Directory icon
  if (file.isDirectory) {
    return <FolderOpen size={iconSizeScaled} className={folderIconColor || 'text-plm-accent'} />
  }

  // Thumbnail from SolidWorks file. The browser fetches it, so there is no
  // loading state to render: the type icon below shows until the image decodes.
  if (thumbnail) {
    return (
      <img
        src={thumbnail}
        alt={file.name}
        className="w-full h-full object-contain"
        style={{ maxWidth: iconSize, maxHeight: iconSize }}
        loading="lazy"
        decoding="async"
        onError={onThumbnailError}
      />
    )
  }

  // File type icons
  switch (iconType) {
    case 'part':
      return <FileBox size={iconSizeScaled} className="text-plm-accent" />
    case 'assembly':
      return <Layers size={iconSizeScaled} className="text-amber-400" />
    case 'drawing':
      return <FilePen size={iconSizeScaled} className="text-sky-300" />
    case 'step':
      return <FileBox size={iconSizeScaled} className="text-orange-400" />
    case 'pdf':
      return <FileType size={iconSizeScaled} className="text-red-400" />
    case 'image':
      return <FileImage size={iconSizeScaled} className="text-purple-400" />
    case 'spreadsheet':
      return <FileSpreadsheet size={iconSizeScaled} className="text-green-400" />
    case 'archive':
      return <FileArchive size={iconSizeScaled} className="text-yellow-500" />
    case 'schematic':
      return <Cpu size={iconSizeScaled} className="text-red-400" />
    case 'library':
      return <Cpu size={iconSizeScaled} className="text-violet-400" />
    case 'pcb':
      return <Cpu size={iconSizeScaled} className="text-emerald-400" />
    case 'code':
      return <FileCode size={iconSizeScaled} className="text-sky-400" />
    case 'text':
      return <FileText size={iconSizeScaled} className="text-plm-fg-muted" />
    default:
      return <File size={iconSizeScaled} className="text-plm-fg-muted" />
  }
}
