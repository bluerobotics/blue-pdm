import { 
  Search, File, Folder, Hash, FileText, 
  ClipboardList, Tag, HardDrive, User 
} from 'lucide-react'
import type { FilterOption } from './types'

export const FILTER_OPTIONS: FilterOption[] = [
  { id: 'all', label: 'All', icon: <Search size={14} />, description: 'Search everything' },
  { id: 'files', label: 'Files', icon: <File size={14} />, prefix: 'file:', description: 'Search file names only' },
  { id: 'folders', label: 'Folders', icon: <Folder size={14} />, prefix: 'folder:', description: 'Search folder names only' },
  { id: 'part-number', label: 'Part Number', icon: <Hash size={14} />, prefix: 'pn:', description: 'Search by part number' },
  { id: 'description', label: 'Description', icon: <FileText size={14} />, prefix: 'desc:', description: 'Search file descriptions' },
  { id: 'eco', label: 'ECO', icon: <ClipboardList size={14} />, prefix: 'eco:', description: 'Find files in an ECO' },
  { id: 'checked-out', label: 'Checked Out By', icon: <User size={14} />, prefix: 'by:', description: 'Find files checked out by user' },
  { id: 'state', label: 'State', icon: <Tag size={14} />, prefix: 'state:', description: 'Filter by workflow state' },
  { id: 'drive', label: 'Google Drive', icon: <HardDrive size={14} />, prefix: 'drive:', description: 'Search Google Drive files', requiresAuth: 'gdrive' },
]
