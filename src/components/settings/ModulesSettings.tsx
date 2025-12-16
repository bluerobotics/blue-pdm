import { useState, useMemo } from 'react'
import {
  ToggleLeft,
  ToggleRight,
  GripVertical,
  Lock,
  RotateCcw,
  Save,
  Download,
  Loader2,
  FolderTree,
  ArrowDownUp,
  Search,
  GitBranch,
  History,
  Trash2,
  Terminal,
  ClipboardList,
  Telescope,
  AlertCircle,
  ClipboardCheck,
  Package,
  Network,
  Calendar,
  Building2,
  Globe,
  Minus,
  Plus,
  X
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import {
  MODULE_GROUPS,
  MODULES,
  canToggleModule,
  isModuleVisible,
  buildCombinedOrderList,
  type ModuleId,
  type OrderListItem
} from '../../types/modules'

// Custom Google Drive icon to match ActivityBar
function GoogleDriveIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M8.24 2L1 14.19L4.24 19.83L11.47 7.64L8.24 2Z" fill="currentColor"/>
      <path d="M15.76 2H8.24L15.47 14.19H22.99L15.76 2Z" fill="currentColor" fillOpacity="0.7"/>
      <path d="M1 14.19L4.24 19.83H19.76L22.99 14.19H1Z" fill="currentColor" fillOpacity="0.4"/>
    </svg>
  )
}

// Icon mapping for modules
const moduleIcons: Record<string, React.ReactNode> = {
  FolderTree: <FolderTree size={16} />,
  ArrowDownUp: <ArrowDownUp size={16} />,
  Search: <Search size={16} />,
  GitBranch: <GitBranch size={16} />,
  History: <History size={16} />,
  Trash2: <Trash2 size={16} />,
  Terminal: <Terminal size={16} />,
  ClipboardList: <ClipboardList size={16} />,
  Telescope: <Telescope size={16} />,
  AlertCircle: <AlertCircle size={16} />,
  ClipboardCheck: <ClipboardCheck size={16} />,
  Package: <Package size={16} />,
  Network: <Network size={16} />,
  Calendar: <Calendar size={16} />,
  Building2: <Building2 size={16} />,
  Globe: <Globe size={16} />,
  GoogleDrive: <GoogleDriveIcon size={16} />,
}

// Combined order list item (module or divider)
function OrderListItemComponent({
  item,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
  isDropTarget
}: {
  item: OrderListItem
  index: number
  onDragStart: (index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: (index: number) => void
  isDragging: boolean
  isDropTarget: boolean
}) {
  const { moduleConfig, setModuleEnabled, removeDivider } = usePDMStore()
  
  if (item.type === 'divider') {
    return (
      <div
        draggable
        onDragStart={() => onDragStart(index)}
        onDragOver={(e) => onDragOver(e, index)}
        onDrop={() => onDrop(index)}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all cursor-move ${
          isDragging 
            ? 'opacity-50 border-plm-accent bg-plm-accent/10' 
            : isDropTarget
            ? 'border-plm-accent border-dashed bg-plm-accent/5'
            : 'border-plm-border bg-plm-bg-secondary'
        }`}
      >
        <GripVertical size={14} className="text-plm-fg-muted flex-shrink-0" />
        <div className="flex items-center gap-2 flex-1">
          <Minus size={16} className="text-plm-fg-muted" />
          <span className="text-xs text-plm-fg-muted font-medium uppercase tracking-wide">
            Divider
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            removeDivider(item.id)
          }}
          className="p-1 text-plm-fg-muted hover:text-plm-error rounded transition-colors"
          title="Remove divider"
        >
          <X size={14} />
        </button>
      </div>
    )
  }
  
  // Module item
  const moduleId = item.id as ModuleId
  const module = MODULES.find(m => m.id === moduleId)
  if (!module) return null
  
  const isVisible = isModuleVisible(moduleId, moduleConfig)
  const canToggle = canToggleModule(moduleId, moduleConfig)
  const isGroupEnabled = moduleConfig.enabledGroups[module.group]
  const group = MODULE_GROUPS.find(g => g.id === module.group)
  const isDisabledByGroup = group?.isMasterToggle && !isGroupEnabled
  
  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all cursor-move ${
        isDragging 
          ? 'opacity-50 border-plm-accent bg-plm-accent/10' 
          : isDropTarget
          ? 'border-plm-accent border-dashed bg-plm-accent/5'
          : isVisible
          ? 'border-plm-border bg-plm-bg hover:bg-plm-highlight/50'
          : 'border-plm-border/50 bg-plm-bg-secondary'
      }`}
    >
      <GripVertical size={14} className="text-plm-fg-muted flex-shrink-0" />
      
      <div className={`p-1 rounded ${isVisible ? 'text-plm-accent' : 'text-plm-fg-muted'}`}>
        {moduleIcons[module.icon] || <Package size={16} />}
      </div>
      
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${isVisible ? 'text-plm-fg' : 'text-plm-fg-muted'}`}>
          {module.name}
        </span>
        {module.required && (
          <span title="Required when group enabled">
            <Lock size={10} className="inline ml-1.5 text-plm-fg-dim" />
          </span>
        )}
      </div>
      
      {/* Status badges */}
      <div className="flex items-center gap-2">
        {isDisabledByGroup && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-plm-bg-lighter text-plm-fg-dim">
            GROUP OFF
          </span>
        )}
      </div>
      
      {/* Toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (canToggle && !isDisabledByGroup) {
            setModuleEnabled(moduleId, !moduleConfig.enabledModules[moduleId])
          }
        }}
        disabled={!canToggle || isDisabledByGroup}
        className={`transition-colors ${(!canToggle || isDisabledByGroup) ? 'opacity-40 cursor-not-allowed' : ''}`}
        title={!canToggle ? 'This module cannot be disabled' : isDisabledByGroup ? 'Enable the group first' : undefined}
      >
        {moduleConfig.enabledModules[moduleId] ? (
          <ToggleRight size={20} className="text-plm-accent" />
        ) : (
          <ToggleLeft size={20} className="text-plm-fg-muted" />
        )}
      </button>
    </div>
  )
}

export function ModulesSettings() {
  const { 
    user,
    moduleConfig, 
    setCombinedOrder,
    addDivider,
    resetModulesToDefaults,
    loadOrgModuleDefaults,
    saveOrgModuleDefaults,
    getEffectiveRole
  } = usePDMStore()
  
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null)
  
  const isAdmin = getEffectiveRole() === 'admin'
  
  // Build combined list for display
  const combinedList = useMemo(() => {
    return buildCombinedOrderList(moduleConfig.moduleOrder, moduleConfig.dividers)
  }, [moduleConfig.moduleOrder, moduleConfig.dividers])
  
  const handleDragStart = (index: number) => {
    setDragIndex(index)
  }
  
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDropTargetIndex(index)
  }
  
  const handleDrop = (toIndex: number) => {
    if (dragIndex !== null && dragIndex !== toIndex) {
      const newList = [...combinedList]
      const [removed] = newList.splice(dragIndex, 1)
      newList.splice(toIndex, 0, removed)
      setCombinedOrder(newList)
    }
    setDragIndex(null)
    setDropTargetIndex(null)
  }
  
  const handleDragEnd = () => {
    setDragIndex(null)
    setDropTargetIndex(null)
  }
  
  const handleAddDivider = () => {
    // Add divider at the end
    addDivider(moduleConfig.moduleOrder.length - 1)
  }
  
  const handleSaveOrgDefaults = async () => {
    setIsSaving(true)
    setSaveResult(null)
    try {
      const result = await saveOrgModuleDefaults()
      setSaveResult(result.success ? 'success' : 'error')
      setTimeout(() => setSaveResult(null), 3000)
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleLoadOrgDefaults = async () => {
    setIsLoading(true)
    try {
      await loadOrgModuleDefaults()
    } finally {
      setIsLoading(false)
    }
  }
  
  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-plm-fg">Modules</h1>
          <p className="text-sm text-plm-fg-muted mt-1">
            Enable, disable, and reorder sidebar modules
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={handleSaveOrgDefaults}
              disabled={isSaving}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                saveResult === 'success'
                  ? 'bg-plm-success/20 text-plm-success border border-plm-success/30'
                  : saveResult === 'error'
                  ? 'bg-plm-error/20 text-plm-error border border-plm-error/30'
                  : 'bg-plm-accent text-white hover:bg-plm-accent/80'
              }`}
              title="Save as organization defaults for new members"
            >
              {isSaving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {saveResult === 'success' ? 'Saved!' : saveResult === 'error' ? 'Failed' : 'Save Defaults'}
            </button>
          )}
          <button
            onClick={handleLoadOrgDefaults}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors disabled:opacity-50"
            title="Load organization defaults"
          >
            {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            Load Defaults
          </button>
          <button
            onClick={resetModulesToDefaults}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors"
            title="Reset to factory defaults"
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
      </div>
      
      {/* Combined Order List */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
            Sidebar Order
          </h2>
          <button
            onClick={handleAddDivider}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors"
            title="Add a section divider"
          >
            <Plus size={12} />
            Add Divider
          </button>
        </div>
        
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
          <p className="text-sm text-plm-fg-muted mb-4">
            Drag to reorder. Toggle to enable/disable. Disabling a module hides its dependents.
          </p>
          <div className="space-y-2" onDragEnd={handleDragEnd}>
            {combinedList.map((item, index) => (
              <OrderListItemComponent
                key={item.type === 'module' ? item.id : `divider-${item.id}`}
                item={item}
                index={index}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                isDragging={dragIndex === index}
                isDropTarget={dropTargetIndex === index && dragIndex !== index}
              />
            ))}
          </div>
        </div>
      </section>
      
      {/* Legend */}
      <section className="pt-2">
        <div className="flex flex-wrap gap-4 text-xs text-plm-fg-dim">
          <div className="flex items-center gap-1.5">
            <Lock size={10} />
            <span>Required module</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Minus size={10} />
            <span>Section divider</span>
          </div>
        </div>
      </section>
    </div>
  )
}
