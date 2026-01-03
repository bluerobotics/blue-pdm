// User Job Title Modal - Manage a user's job title assignment
import { useState } from 'react'
import * as LucideIcons from 'lucide-react'
import { Briefcase, Search, Plus, X, Check, Pencil, Trash2, Loader2 } from 'lucide-react'
import { ColorPickerDropdown } from '../../shared/ColorPicker'
import { IconGridPicker } from '../../shared/IconPicker'
import type { UserJobTitleModalProps, JobTitle } from './types'

export function UserJobTitleModal({
  user,
  jobTitles,
  onClose,
  onSelectTitle,
  onCreateTitle,
  onUpdateTitle,
  onDeleteTitle,
  isAdmin
}: UserJobTitleModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(user.job_title?.id || null)
  
  // Edit state
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editIcon, setEditIcon] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [deletingTitleId, setDeletingTitleId] = useState<string | null>(null)
  
  const filteredTitles = jobTitles.filter(t =>
    !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSelectTitle(selectedTitleId)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }
  
  const startEditing = (title: JobTitle) => {
    setEditingTitleId(title.id)
    setEditName(title.name)
    setEditColor(title.color)
    setEditIcon(title.icon)
  }
  
  const cancelEditing = () => {
    setEditingTitleId(null)
    setEditName('')
    setEditColor('')
    setEditIcon('')
  }
  
  const handleUpdateTitle = async () => {
    if (!editingTitleId || !editName.trim() || !onUpdateTitle) return
    setIsUpdating(true)
    try {
      await onUpdateTitle(editingTitleId, editName.trim(), editColor, editIcon)
      cancelEditing()
    } finally {
      setIsUpdating(false)
    }
  }
  
  const handleDeleteTitle = async (titleId: string) => {
    if (!onDeleteTitle) return
    setDeletingTitleId(titleId)
    try {
      await onDeleteTitle(titleId)
      // If the deleted title was selected, clear selection
      if (selectedTitleId === titleId) {
        setSelectedTitleId(null)
      }
    } finally {
      setDeletingTitleId(null)
    }
  }
  
  const hasChanges = selectedTitleId !== (user.job_title?.id || null)
  
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-plm-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-plm-accent/10">
              <Briefcase size={20} className="text-plm-accent" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-plm-fg">Job Title</h3>
              <p className="text-xs text-plm-fg-muted truncate max-w-[200px]">
                {user.full_name || user.email}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Search */}
        <div className="p-4 border-b border-plm-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search job titles..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* No title option */}
          <button
            onClick={() => setSelectedTitleId(null)}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              selectedTitleId === null
                ? 'border-plm-accent bg-plm-accent/10'
                : 'border-plm-border hover:border-plm-fg-muted hover:bg-plm-highlight'
            }`}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-plm-fg-muted/10 text-plm-fg-muted">
              <X size={16} />
            </div>
            <span className="flex-1 text-left text-sm text-plm-fg-muted">No title</span>
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              selectedTitleId === null
                ? 'border-plm-accent bg-plm-accent'
                : 'border-plm-fg-muted'
            }`}>
              {selectedTitleId === null && <Check size={12} className="text-white" />}
            </div>
          </button>
          
          {filteredTitles.length === 0 && searchQuery ? (
            <div className="text-center py-6 text-sm text-plm-fg-muted">
              No titles match "{searchQuery}"
            </div>
          ) : (
            filteredTitles.map(title => {
              const TitleIcon = (LucideIcons as any)[title.icon] || Briefcase
              const isSelected = selectedTitleId === title.id
              const isEditing = editingTitleId === title.id
              const isDeleting = deletingTitleId === title.id
              
              if (isEditing && isAdmin) {
                const EditIcon = (LucideIcons as any)[editIcon] || Briefcase
                return (
                  <div key={title.id} className="p-3 rounded-lg border border-plm-accent bg-plm-accent/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-plm-fg">Edit Job Title</span>
                      <button
                        onClick={cancelEditing}
                        className="p-1 text-plm-fg-muted hover:text-plm-fg"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder="Title name"
                      className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg text-sm placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <ColorPickerDropdown
                        color={editColor}
                        onChange={(c) => c && setEditColor(c)}
                        triggerSize="lg"
                        showReset={false}
                        title="Title Color"
                      />
                      <div
                        className="p-2 rounded-lg"
                        style={{ backgroundColor: `${editColor}20`, color: editColor }}
                      >
                        <EditIcon size={16} />
                      </div>
                    </div>
                    {/* Icon picker grid */}
                    <IconGridPicker
                      value={editIcon}
                      onChange={setEditIcon}
                      maxHeight="128px"
                      columns={8}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDeleteTitle(title.id)}
                        disabled={isDeleting}
                        className="btn btn-ghost btn-sm text-plm-error hover:bg-plm-error/10"
                      >
                        {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                      <button
                        onClick={handleUpdateTitle}
                        disabled={isUpdating || !editName.trim()}
                        className="flex-1 btn btn-primary btn-sm flex items-center justify-center gap-2"
                      >
                        {isUpdating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        Save
                      </button>
                    </div>
                  </div>
                )
              }
              
              return (
                <button
                  key={title.id}
                  onClick={() => setSelectedTitleId(title.id)}
                  className={`w-full group flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-plm-accent bg-plm-accent/10'
                      : 'border-plm-border hover:border-plm-fg-muted hover:bg-plm-highlight'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${title.color}20`, color: title.color }}
                  >
                    <TitleIcon size={16} />
                  </div>
                  <span className="flex-1 text-left text-sm text-plm-fg font-medium">{title.name}</span>
                  {isAdmin && onUpdateTitle && (
                    <div
                      onClick={e => { e.stopPropagation(); startEditing(title) }}
                      className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="Edit title"
                    >
                      <Pencil size={12} />
                    </div>
                  )}
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    isSelected
                      ? 'border-plm-accent bg-plm-accent'
                      : 'border-plm-fg-muted'
                  }`}>
                    {isSelected && <Check size={12} className="text-white" />}
                  </div>
                </button>
              )
            })
          )}
          
          {/* Create new option */}
          {!searchQuery && (
            <button
              onClick={onCreateTitle}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-plm-border text-plm-accent hover:border-plm-accent hover:bg-plm-accent/5 transition-colors"
            >
              <Plus size={14} />
              Create new job title
            </button>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex gap-2 justify-end p-4 border-t border-plm-border">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="btn btn-primary flex items-center gap-2"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
