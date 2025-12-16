import { useState, useEffect } from 'react'
import { 
  Plus, 
  Trash2, 
  Pencil, 
  X, 
  Loader2,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  AlertTriangle
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'
import type { FileMetadataColumn, MetadataColumnType } from '../../types/database'

// Cast supabase client to bypass known v2 type inference issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const TYPE_LABELS: Record<MetadataColumnType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes/No',
  select: 'Dropdown'
}

interface EditingColumn {
  id?: string
  name: string
  label: string
  data_type: MetadataColumnType
  select_options: string[]
  width: number
  visible: boolean
  sortable: boolean
  required: boolean
  default_value: string
}

const DEFAULT_COLUMN: EditingColumn = {
  name: '',
  label: '',
  data_type: 'text',
  select_options: [],
  width: 120,
  visible: true,
  sortable: true,
  required: false,
  default_value: ''
}

export function MetadataColumnsSettings() {
  const { 
    user, 
    organization, 
    addToast, 
    columns: builtinColumns, 
    toggleColumnVisibility, 
    setColumnWidth,
    saveOrgColumnDefaults,
    loadOrgColumnDefaults,
    resetColumnsToDefaults,
    getEffectiveRole
  } = usePDMStore()
  
  const [columns, setColumns] = useState<FileMetadataColumn[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingDefaults, setIsSavingDefaults] = useState(false)
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false)
  
  // Editing state
  const [editingColumn, setEditingColumn] = useState<EditingColumn | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [deletingColumn, setDeletingColumn] = useState<FileMetadataColumn | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  
  // Select options editing
  const [newOption, setNewOption] = useState('')
  
  // Handle saving org defaults
  const handleSaveOrgDefaults = async () => {
    setIsSavingDefaults(true)
    const result = await saveOrgColumnDefaults()
    setIsSavingDefaults(false)
    
    if (result.success) {
      addToast('success', 'Saved as organization defaults')
    } else {
      addToast('error', result.error || 'Failed to save defaults')
    }
  }
  
  // Handle loading org defaults
  const handleLoadOrgDefaults = async () => {
    setIsLoadingDefaults(true)
    const result = await loadOrgColumnDefaults()
    setIsLoadingDefaults(false)
    
    if (result.success) {
      addToast('success', 'Loaded organization defaults')
    } else {
      addToast('error', result.error || 'Failed to load defaults')
    }
  }
  
  // Handle reset to app defaults
  const handleResetToDefaults = () => {
    resetColumnsToDefaults()
    addToast('info', 'Reset to application defaults')
  }

  // Load columns
  useEffect(() => {
    if (organization) {
      loadColumns()
    }
  }, [organization])

  const loadColumns = async () => {
    if (!organization) return
    
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('file_metadata_columns')
        .select('*')
        .eq('org_id', organization.id)
        .order('sort_order')
      
      if (error) {
        console.error('Failed to load metadata columns:', error)
        addToast('error', 'Failed to load metadata columns')
      } else {
        setColumns(data || [])
      }
    } catch (err) {
      console.error('Failed to load metadata columns:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveColumn = async () => {
    if (!editingColumn || !organization || !user) return
    
    // Validate
    if (!editingColumn.name.trim()) {
      addToast('error', 'Column name is required')
      return
    }
    if (!editingColumn.label.trim()) {
      addToast('error', 'Column label is required')
      return
    }
    
    // Validate name format (only lowercase letters, numbers, underscores)
    const nameRegex = /^[a-z][a-z0-9_]*$/
    if (!nameRegex.test(editingColumn.name)) {
      addToast('error', 'Name must start with a letter and contain only lowercase letters, numbers, and underscores')
      return
    }
    
    setIsSaving(true)
    
    try {
      if (editingColumn.id) {
        // Update existing column
        const { error } = await db
          .from('file_metadata_columns')
          .update({
            name: editingColumn.name.toLowerCase(),
            label: editingColumn.label,
            data_type: editingColumn.data_type,
            select_options: editingColumn.select_options,
            width: editingColumn.width,
            visible: editingColumn.visible,
            sortable: editingColumn.sortable,
            required: editingColumn.required,
            default_value: editingColumn.default_value || null,
            updated_at: new Date().toISOString(),
            updated_by: user.id
          })
          .eq('id', editingColumn.id)
        
        if (error) throw error
        addToast('success', 'Column updated')
      } else {
        // Create new column
        const maxSortOrder = columns.length > 0 
          ? Math.max(...columns.map(c => c.sort_order)) 
          : -1
        
        const { error } = await db
          .from('file_metadata_columns')
          .insert({
            org_id: organization.id,
            name: editingColumn.name.toLowerCase(),
            label: editingColumn.label,
            data_type: editingColumn.data_type,
            select_options: editingColumn.select_options,
            width: editingColumn.width,
            visible: editingColumn.visible,
            sortable: editingColumn.sortable,
            required: editingColumn.required,
            default_value: editingColumn.default_value || null,
            sort_order: maxSortOrder + 1,
            created_by: user.id
          })
        
        if (error) throw error
        addToast('success', 'Column created')
      }
      
      await loadColumns()
      setEditingColumn(null)
      setIsCreating(false)
    } catch (err: unknown) {
      console.error('Failed to save column:', err)
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      if (errorMessage.includes('duplicate key')) {
        addToast('error', 'A column with this name already exists')
      } else {
        addToast('error', 'Failed to save column')
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteColumn = async () => {
    if (!deletingColumn) return
    
    setIsDeleting(true)
    try {
      const { error } = await supabase
        .from('file_metadata_columns')
        .delete()
        .eq('id', deletingColumn.id)
      
      if (error) throw error
      
      addToast('success', `Column "${deletingColumn.label}" deleted`)
      await loadColumns()
      setDeletingColumn(null)
    } catch (err) {
      console.error('Failed to delete column:', err)
      addToast('error', 'Failed to delete column')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleToggleVisibility = async (column: FileMetadataColumn) => {
    try {
      const { error } = await db
        .from('file_metadata_columns')
        .update({ visible: !column.visible, updated_at: new Date().toISOString() })
        .eq('id', column.id)
      
      if (error) throw error
      
      setColumns(columns.map(c => 
        c.id === column.id ? { ...c, visible: !c.visible } : c
      ))
    } catch (err) {
      console.error('Failed to toggle visibility:', err)
      addToast('error', 'Failed to update column')
    }
  }

  const handleMoveColumn = async (column: FileMetadataColumn, direction: 'up' | 'down') => {
    const index = columns.findIndex(c => c.id === column.id)
    if (direction === 'up' && index === 0) return
    if (direction === 'down' && index === columns.length - 1) return
    
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    const otherColumn = columns[swapIndex]
    
    try {
      // Swap sort orders
      await Promise.all([
        db
          .from('file_metadata_columns')
          .update({ sort_order: otherColumn.sort_order })
          .eq('id', column.id),
        db
          .from('file_metadata_columns')
          .update({ sort_order: column.sort_order })
          .eq('id', otherColumn.id)
      ])
      
      await loadColumns()
    } catch (err) {
      console.error('Failed to reorder columns:', err)
      addToast('error', 'Failed to reorder columns')
    }
  }

  const addSelectOption = () => {
    if (!newOption.trim() || !editingColumn) return
    
    if (editingColumn.select_options.includes(newOption.trim())) {
      addToast('error', 'This option already exists')
      return
    }
    
    setEditingColumn({
      ...editingColumn,
      select_options: [...editingColumn.select_options, newOption.trim()]
    })
    setNewOption('')
  }

  const removeSelectOption = (option: string) => {
    if (!editingColumn) return
    setEditingColumn({
      ...editingColumn,
      select_options: editingColumn.select_options.filter(o => o !== option)
    })
  }

  const isAdmin = getEffectiveRole() === 'admin'

  return (
    <div className="space-y-6">
      {/* Built-in Columns Section */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
            Built-in Columns
          </h3>
          <p className="text-sm text-plm-fg-dim mt-1">
            Standard columns. {isAdmin ? 'Set default width and visibility for your organization.' : 'Toggle visibility to show/hide.'}
          </p>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[1fr_80px_60px] gap-2 px-3 py-1.5 text-xs text-plm-fg-muted uppercase tracking-wide border-b border-plm-border">
          <span>Column</span>
          <span className="text-center">Width</span>
          <span className="text-center">Visible</span>
        </div>

        {/* Column rows */}
        <div className="space-y-0.5">
          {builtinColumns.map((column) => (
            <div 
              key={column.id}
              className={`grid grid-cols-[1fr_80px_60px] gap-2 px-3 py-2 rounded hover:bg-plm-highlight/50 transition-colors items-center ${!column.visible ? 'opacity-50' : ''}`}
            >
              <span className="text-sm text-plm-fg">{column.label}</span>
              
              {/* Width input (admin only) */}
              {isAdmin ? (
                <input
                  type="number"
                  value={column.width}
                  onChange={(e) => setColumnWidth(column.id, Math.max(40, parseInt(e.target.value) || 40))}
                  className="w-full bg-plm-bg border border-plm-border rounded px-2 py-1 text-xs text-center focus:border-plm-accent focus:outline-none"
                  min={40}
                  max={500}
                />
              ) : (
                <span className="text-xs text-plm-fg-muted text-center">{column.width}px</span>
              )}
              
              {/* Visibility toggle */}
              <div className="flex justify-center">
                <button
                  onClick={() => toggleColumnVisibility(column.id)}
                  className="p-1 hover:bg-plm-highlight rounded transition-colors"
                  title={column.visible ? 'Hide column' : 'Show column'}
                >
                  {column.visible ? (
                    <Eye size={14} className="text-plm-accent" />
                  ) : (
                    <EyeOff size={14} className="text-plm-fg-muted" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-plm-border" />

      {/* Custom Columns Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
              Custom Columns
            </h3>
            <p className="text-sm text-plm-fg-dim mt-1">
              {isAdmin 
                ? 'Define custom properties that appear in the file browser.'
                : 'Custom properties defined by your organization admin.'
              }
            </p>
          </div>
          {isAdmin && !isCreating && !editingColumn && organization && (
            <button
              onClick={() => {
                setEditingColumn({ ...DEFAULT_COLUMN })
                setIsCreating(true)
              }}
              className="btn btn-primary btn-sm flex items-center gap-1"
            >
              <Plus size={14} />
              Add Column
            </button>
          )}
        </div>

        {/* Create/Edit Form (admin only) */}
        {isAdmin && editingColumn && (
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-accent space-y-4">
          <h3 className="font-medium text-plm-fg">
            {isCreating ? 'New Column' : 'Edit Column'}
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Name */}
            <div className="space-y-1">
              <label className="text-sm text-plm-fg-muted">Internal Name</label>
              <input
                type="text"
                value={editingColumn.name}
                onChange={(e) => setEditingColumn({
                  ...editingColumn,
                  name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')
                })}
                placeholder="e.g., material, weight"
                className="w-full bg-plm-bg-light border border-plm-border rounded-lg px-3 py-2 text-base focus:border-plm-accent focus:outline-none font-mono"
                disabled={!isCreating}
              />
              <p className="text-xs text-plm-fg-dim">
                Used in data storage. Lowercase letters, numbers, underscores only.
              </p>
            </div>
            
            {/* Label */}
            <div className="space-y-1">
              <label className="text-sm text-plm-fg-muted">Display Label</label>
              <input
                type="text"
                value={editingColumn.label}
                onChange={(e) => setEditingColumn({
                  ...editingColumn,
                  label: e.target.value
                })}
                placeholder="e.g., Material, Weight (kg)"
                className="w-full bg-plm-bg-light border border-plm-border rounded-lg px-3 py-2 text-base focus:border-plm-accent focus:outline-none"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            {/* Data Type */}
            <div className="space-y-1">
              <label className="text-sm text-plm-fg-muted">Data Type</label>
              <select
                value={editingColumn.data_type}
                onChange={(e) => setEditingColumn({
                  ...editingColumn,
                  data_type: e.target.value as MetadataColumnType,
                  select_options: e.target.value === 'select' ? editingColumn.select_options : []
                })}
                className="w-full bg-plm-bg-light border border-plm-border rounded-lg px-3 py-2 text-base focus:border-plm-accent focus:outline-none"
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            
            {/* Width */}
            <div className="space-y-1">
              <label className="text-sm text-plm-fg-muted">Column Width (px)</label>
              <input
                type="number"
                value={editingColumn.width}
                onChange={(e) => setEditingColumn({
                  ...editingColumn,
                  width: Math.max(50, parseInt(e.target.value) || 120)
                })}
                min={50}
                max={500}
                className="w-full bg-plm-bg-light border border-plm-border rounded-lg px-3 py-2 text-base focus:border-plm-accent focus:outline-none"
              />
            </div>
            
            {/* Default Value */}
            <div className="space-y-1">
              <label className="text-sm text-plm-fg-muted">Default Value</label>
              <input
                type="text"
                value={editingColumn.default_value}
                onChange={(e) => setEditingColumn({
                  ...editingColumn,
                  default_value: e.target.value
                })}
                placeholder="Optional"
                className="w-full bg-plm-bg-light border border-plm-border rounded-lg px-3 py-2 text-base focus:border-plm-accent focus:outline-none"
              />
            </div>
          </div>
          
          {/* Select Options (only for select type) */}
          {editingColumn.data_type === 'select' && (
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Dropdown Options</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addSelectOption()
                    }
                  }}
                  placeholder="Add an option..."
                  className="flex-1 bg-plm-bg-light border border-plm-border rounded-lg px-3 py-2 text-base focus:border-plm-accent focus:outline-none"
                />
                <button
                  onClick={addSelectOption}
                  disabled={!newOption.trim()}
                  className="btn btn-primary btn-sm"
                >
                  <Plus size={14} />
                </button>
              </div>
              {editingColumn.select_options.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {editingColumn.select_options.map((option) => (
                    <span
                      key={option}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-plm-bg-light border border-plm-border rounded text-sm"
                    >
                      {option}
                      <button
                        onClick={() => removeSelectOption(option)}
                        className="p-0.5 hover:text-plm-error"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Toggles */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editingColumn.visible}
                onChange={(e) => setEditingColumn({
                  ...editingColumn,
                  visible: e.target.checked
                })}
                className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
              />
              <span className="text-base text-plm-fg">Visible by default</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editingColumn.sortable}
                onChange={(e) => setEditingColumn({
                  ...editingColumn,
                  sortable: e.target.checked
                })}
                className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
              />
              <span className="text-base text-plm-fg">Sortable</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editingColumn.required}
                onChange={(e) => setEditingColumn({
                  ...editingColumn,
                  required: e.target.checked
                })}
                className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
              />
              <span className="text-base text-plm-fg">Required</span>
            </label>
          </div>
          
          {/* Actions */}
          <div className="flex gap-2 justify-end pt-2 border-t border-plm-border">
            <button
              onClick={() => {
                setEditingColumn(null)
                setIsCreating(false)
              }}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveColumn}
              disabled={isSaving || !editingColumn.name.trim() || !editingColumn.label.trim()}
              className="btn btn-primary btn-sm"
            >
              {isSaving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </>
              ) : isCreating ? (
                'Create Column'
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </div>
      )}

        {/* Custom Columns List */}
        {!organization ? (
          <div className="text-center py-6 text-plm-fg-muted text-sm border border-dashed border-plm-border rounded-lg">
            Connect to an organization to view custom columns
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="animate-spin text-plm-fg-muted" size={20} />
          </div>
        ) : columns.length === 0 && !isCreating ? (
          <div className="text-center py-6 text-plm-fg-muted text-sm border border-dashed border-plm-border rounded-lg">
            <p>No custom columns defined</p>
            {isAdmin && (
              <p className="text-xs mt-1 text-plm-fg-dim">Click "Add Column" to create custom properties like Material, Weight, etc.</p>
            )}
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="grid grid-cols-[1fr_80px_80px_60px_auto] gap-2 px-3 py-1.5 text-xs text-plm-fg-muted uppercase tracking-wide border-b border-plm-border">
              <span>Column</span>
              <span className="text-center">Type</span>
              <span className="text-center">Width</span>
              <span className="text-center">Visible</span>
              {isAdmin && <span className="text-center w-20">Actions</span>}
            </div>

            {/* Column rows */}
            <div className="space-y-0.5">
              {columns.map((column, index) => (
                <div 
                  key={column.id}
                  className={`grid grid-cols-[1fr_80px_80px_60px_auto] gap-2 px-3 py-2 rounded hover:bg-plm-highlight/50 transition-colors items-center group ${!column.visible ? 'opacity-50' : ''}`}
                >
                  {/* Name with reorder buttons (admin) */}
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleMoveColumn(column, 'up')}
                          disabled={index === 0}
                          className="p-0 text-plm-fg-muted hover:text-plm-fg disabled:opacity-30"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          onClick={() => handleMoveColumn(column, 'down')}
                          disabled={index === columns.length - 1}
                          className="p-0 text-plm-fg-muted hover:text-plm-fg disabled:opacity-30"
                        >
                          <ChevronDown size={12} />
                        </button>
                      </div>
                    )}
                    <span className="text-sm text-plm-fg">{column.label}</span>
                    {column.required && (
                      <span className="text-[10px] px-1 py-0.5 bg-plm-warning/20 text-plm-warning rounded">req</span>
                    )}
                  </div>
                  
                  {/* Type */}
                  <span className="text-xs text-plm-fg-muted text-center">{TYPE_LABELS[column.data_type]}</span>
                  
                  {/* Width */}
                  <span className="text-xs text-plm-fg-muted text-center">{column.width}px</span>
                  
                  {/* Visibility toggle */}
                  <div className="flex justify-center">
                    <button
                      onClick={() => handleToggleVisibility(column)}
                      className="p-1 hover:bg-plm-highlight rounded transition-colors"
                      title={column.visible ? 'Hide column' : 'Show column'}
                    >
                      {column.visible ? (
                        <Eye size={14} className="text-plm-accent" />
                      ) : (
                        <EyeOff size={14} className="text-plm-fg-muted" />
                      )}
                    </button>
                  </div>
                  
                  {/* Actions (admin only) */}
                  {isAdmin && (
                    <div className="flex items-center justify-center gap-1 w-20">
                      <button
                        onClick={() => {
                          setEditingColumn({
                            id: column.id,
                            name: column.name,
                            label: column.label,
                            data_type: column.data_type,
                            select_options: column.select_options || [],
                            width: column.width,
                            visible: column.visible,
                            sortable: column.sortable,
                            required: column.required,
                            default_value: column.default_value || ''
                          })
                          setIsCreating(false)
                        }}
                        className="p-1 hover:bg-plm-highlight rounded transition-colors"
                        title="Edit column"
                      >
                        <Pencil size={12} className="text-plm-fg-muted" />
                      </button>
                      <button
                        onClick={() => setDeletingColumn(column)}
                        className="p-1 hover:bg-plm-error/20 rounded transition-colors"
                        title="Delete column"
                      >
                        <Trash2 size={12} className="text-plm-error" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Actions & Info */}
      <div className="p-4 bg-plm-bg rounded border border-plm-border space-y-3">
        <div className="flex flex-wrap gap-2">
          {isAdmin && organization && (
            <button
              onClick={handleSaveOrgDefaults}
              disabled={isSavingDefaults}
              className="btn btn-primary btn-sm"
            >
              {isSavingDefaults ? 'Saving...' : 'Save as Org Defaults'}
            </button>
          )}
          {organization && (
            <button
              onClick={handleLoadOrgDefaults}
              disabled={isLoadingDefaults}
              className="btn btn-ghost btn-sm"
            >
              {isLoadingDefaults ? 'Loading...' : 'Load Org Defaults'}
            </button>
          )}
          <button
            onClick={handleResetToDefaults}
            className="btn btn-ghost btn-sm text-plm-fg-muted"
          >
            Reset to App Defaults
          </button>
        </div>
        <p className="text-xs text-plm-fg-dim">
          Column settings are saved locally per user. {isAdmin && 'Use "Save as Org Defaults" to set the starting configuration for new team members.'}
        </p>
      </div>

      {/* Delete Confirmation Dialog */}
      {deletingColumn && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setDeletingColumn(null)}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-plm-error/20 rounded-full">
                <AlertTriangle size={20} className="text-plm-error" />
              </div>
              <h3 className="text-lg font-medium text-plm-fg">Delete Column</h3>
            </div>
            <p className="text-base text-plm-fg-muted mb-4">
              Are you sure you want to delete the column <strong>"{deletingColumn.label}"</strong>?
            </p>
            <p className="text-sm text-plm-fg-dim mb-4">
              This will remove the column from the file browser. Existing file metadata using this column 
              will remain in storage but won't be displayed.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeletingColumn(null)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleDeleteColumn}
                disabled={isDeleting}
                className="btn bg-plm-error text-white hover:bg-plm-error/90 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete Column'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

