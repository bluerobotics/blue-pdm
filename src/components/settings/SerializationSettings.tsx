// @ts-nocheck - Supabase type inference issues with new columns
import { useState, useEffect, useMemo } from 'react'
import { 
  Loader2, 
  Hash,
  Save,
  Plus,
  X,
  AlertTriangle,
  Eye,
  RefreshCw,
  Info,
  FileBox,
  Layers
} from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'

interface KeepoutZone {
  start: number
  end_num: number
  description: string
}

interface SerializationSettingsData {
  enabled: boolean
  prefix: string
  suffix: string
  padding_digits: number
  letter_count: number
  current_counter: number
  use_letters_before_numbers: boolean
  letter_prefix: string
  keepout_zones: KeepoutZone[]
  auto_apply_extensions: string[]
}

// Common CAD file extensions for quick selection
const COMMON_EXTENSIONS = [
  { ext: '.sldprt', label: 'SolidWorks Part', icon: 'part' },
  { ext: '.sldasm', label: 'SolidWorks Assembly', icon: 'assembly' },
  { ext: '.slddrw', label: 'SolidWorks Drawing', icon: 'drawing' },
  { ext: '.step', label: 'STEP', icon: 'step' },
  { ext: '.stp', label: 'STP', icon: 'step' },
  { ext: '.iges', label: 'IGES', icon: 'step' },
  { ext: '.igs', label: 'IGS', icon: 'step' },
  { ext: '.prt', label: 'Creo/NX Part', icon: 'part' },
  { ext: '.asm', label: 'Creo Assembly', icon: 'assembly' },
  { ext: '.ipt', label: 'Inventor Part', icon: 'part' },
  { ext: '.iam', label: 'Inventor Assembly', icon: 'assembly' },
  { ext: '.catpart', label: 'CATIA Part', icon: 'part' },
  { ext: '.catproduct', label: 'CATIA Assembly', icon: 'assembly' },
]

const DEFAULT_SERIALIZATION_SETTINGS: SerializationSettingsData = {
  enabled: true,
  prefix: 'PN-',
  suffix: '',
  padding_digits: 5,
  letter_count: 0,
  current_counter: 0,
  use_letters_before_numbers: false,
  letter_prefix: '',
  keepout_zones: [],
  auto_apply_extensions: []
}

export function SerializationSettings() {
  const { organization, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<SerializationSettingsData>(DEFAULT_SERIALIZATION_SETTINGS)
  const [previewNumber, setPreviewNumber] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  
  // New keepout zone form
  const [newKeepout, setNewKeepout] = useState({ start: '', end: '', description: '' })
  const [showKeepoutForm, setShowKeepoutForm] = useState(false)
  
  // Custom extension input
  const [customExtension, setCustomExtension] = useState('')

  // Generate a live preview of what the serial number will look like
  const livePreview = useMemo(() => {
    if (!settings.enabled) return 'Disabled'
    
    let nextNumber = settings.current_counter + 1
    
    // Skip keepout zones
    for (const zone of settings.keepout_zones) {
      if (nextNumber >= zone.start && nextNumber <= zone.end_num) {
        nextNumber = zone.end_num + 1
      }
    }
    
    let serial = settings.prefix
    
    if (settings.letter_prefix) {
      serial += settings.letter_prefix
    }
    
    serial += String(nextNumber).padStart(settings.padding_digits, '0')
    serial += settings.suffix
    
    return serial
  }, [settings])

  // Load current settings
  useEffect(() => {
    if (!organization?.id) return

    const loadSettings = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('serialization_settings')
          .eq('id', organization.id)
          .single()

        if (error) throw error
        
        const savedSettings = data?.serialization_settings || DEFAULT_SERIALIZATION_SETTINGS
        // Ensure all fields exist with defaults
        setSettings({
          ...DEFAULT_SERIALIZATION_SETTINGS,
          ...savedSettings,
          keepout_zones: savedSettings.keepout_zones || [],
          auto_apply_extensions: savedSettings.auto_apply_extensions || []
        })
      } catch (err) {
        console.error('Failed to load serialization settings:', err)
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [organization?.id])

  // Fetch preview from server
  const fetchPreview = async () => {
    if (!organization?.id) return
    
    setLoadingPreview(true)
    try {
      const { data, error } = await supabase.rpc('preview_next_serial_number', {
        p_org_id: organization.id
      })
      
      if (error) throw error
      setPreviewNumber(data)
    } catch (err) {
      console.error('Failed to fetch preview:', err)
      addToast('error', 'Failed to fetch serial number preview')
    } finally {
      setLoadingPreview(false)
    }
  }

  // Save settings
  const handleSave = async () => {
    if (!organization?.id) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ serialization_settings: settings })
        .eq('id', organization.id)

      if (error) throw error
      addToast('success', 'Serialization settings saved')
      
      // Refresh preview after save
      fetchPreview()
    } catch (err) {
      console.error('Failed to save serialization settings:', err)
      addToast('error', 'Failed to save serialization settings')
    } finally {
      setSaving(false)
    }
  }

  // Update a setting
  const updateSetting = <K extends keyof SerializationSettingsData>(
    key: K, 
    value: SerializationSettingsData[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  // Add keepout zone
  const addKeepoutZone = () => {
    const start = parseInt(newKeepout.start)
    const end = parseInt(newKeepout.end)
    
    if (isNaN(start) || isNaN(end) || start < 0 || end < start) {
      addToast('error', 'Invalid range: end must be greater than or equal to start')
      return
    }
    
    // Check for overlapping zones
    const overlaps = settings.keepout_zones.some(zone => 
      (start >= zone.start && start <= zone.end_num) ||
      (end >= zone.start && end <= zone.end_num) ||
      (start <= zone.start && end >= zone.end_num)
    )
    
    if (overlaps) {
      addToast('error', 'This range overlaps with an existing keepout zone')
      return
    }
    
    const newZone: KeepoutZone = {
      start,
      end_num: end,
      description: newKeepout.description || `Reserved range ${start}-${end}`
    }
    
    updateSetting('keepout_zones', [...settings.keepout_zones, newZone].sort((a, b) => a.start - b.start))
    setNewKeepout({ start: '', end: '', description: '' })
    setShowKeepoutForm(false)
  }

  // Remove keepout zone
  const removeKeepoutZone = (index: number) => {
    const updated = settings.keepout_zones.filter((_, i) => i !== index)
    updateSetting('keepout_zones', updated)
  }

  // Toggle extension for auto-apply
  const toggleExtension = (ext: string) => {
    const normalizedExt = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    const current = settings.auto_apply_extensions || []
    
    if (current.includes(normalizedExt)) {
      updateSetting('auto_apply_extensions', current.filter(e => e !== normalizedExt))
    } else {
      updateSetting('auto_apply_extensions', [...current, normalizedExt])
    }
  }

  // Add custom extension
  const addCustomExtension = () => {
    if (!customExtension.trim()) return
    
    const normalizedExt = customExtension.toLowerCase().startsWith('.') 
      ? customExtension.toLowerCase().trim() 
      : `.${customExtension.toLowerCase().trim()}`
    
    const current = settings.auto_apply_extensions || []
    if (!current.includes(normalizedExt)) {
      updateSetting('auto_apply_extensions', [...current, normalizedExt])
    }
    setCustomExtension('')
  }

  if (!organization) {
    return (
      <div className="text-center py-12 text-plm-fg-muted">
        No organization connected
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-plm-accent" size={24} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-plm-fg flex items-center gap-2">
          <Hash className="text-plm-accent" size={20} />
          Serial Number Settings
        </h2>
        <p className="text-sm text-plm-fg-muted mt-1">
          Configure how sequential item/part numbers are generated for your organization.
        </p>
      </div>
      
      {/* Read-only notice for non-admins */}
      {!isAdmin && (
        <div className="p-3 bg-plm-highlight rounded-lg border border-plm-border text-sm text-plm-fg-muted">
          Only administrators can modify serialization settings. You are viewing in read-only mode.
        </div>
      )}
      
      {/* Live Preview Card */}
      <div className="p-4 bg-gradient-to-br from-plm-accent/10 to-plm-accent/5 rounded-lg border border-plm-accent/30">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-plm-fg-muted uppercase tracking-wider mb-1">Next Serial Number Preview</div>
            <div className="text-2xl font-mono font-bold text-plm-accent">
              {livePreview}
            </div>
          </div>
          <button
            onClick={fetchPreview}
            disabled={loadingPreview}
            className="p-2 rounded-lg hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg transition-colors"
            title="Fetch from server"
          >
            {loadingPreview ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <RefreshCw size={18} />
            )}
          </button>
        </div>
        {previewNumber && (
          <div className="text-xs text-plm-fg-muted mt-2">
            Server preview: <span className="font-mono">{previewNumber}</span>
          </div>
        )}
      </div>

      {/* Enable/Disable Toggle */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <label className={`flex items-center justify-between ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
          <div>
            <span className="text-sm font-medium text-plm-fg">Enable Auto-Serialization</span>
            <p className="text-xs text-plm-fg-muted mt-0.5">
              Automatically generate sequential part numbers for new files
            </p>
          </div>
          <button
            onClick={() => isAdmin && updateSetting('enabled', !settings.enabled)}
            disabled={!isAdmin}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              settings.enabled ? 'bg-plm-accent' : 'bg-plm-border'
            } ${!isAdmin ? 'opacity-60' : ''}`}
          >
            <span 
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                settings.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </div>

      {/* File Types for Auto-Serialization */}
      <div className={`p-4 bg-plm-bg rounded-lg border border-plm-border ${!settings.enabled ? 'opacity-50' : ''}`}>
        <div className="mb-4">
          <h3 className="text-base font-medium text-plm-fg">Auto-Apply File Types</h3>
          <p className="text-xs text-plm-fg-muted mt-0.5">
            Select which file types should automatically receive a serial number when created
          </p>
        </div>
        
        {/* Common CAD extensions grid */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {COMMON_EXTENSIONS.map(({ ext, label, icon }) => {
            const isSelected = (settings.auto_apply_extensions || []).includes(ext)
            return (
              <button
                key={ext}
                onClick={() => isAdmin && settings.enabled && toggleExtension(ext)}
                disabled={!isAdmin || !settings.enabled}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-colors ${
                  isSelected 
                    ? 'bg-plm-accent/20 border-plm-accent text-plm-fg' 
                    : 'bg-plm-highlight border-plm-border text-plm-fg-muted hover:border-plm-accent/50'
                } ${(!isAdmin || !settings.enabled) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {icon === 'part' && <FileBox size={16} className={isSelected ? 'text-plm-accent' : 'text-plm-fg-muted'} />}
                {icon === 'assembly' && <Layers size={16} className={isSelected ? 'text-amber-400' : 'text-plm-fg-muted'} />}
                {(icon === 'drawing' || icon === 'step') && <FileBox size={16} className={isSelected ? 'text-plm-accent' : 'text-plm-fg-muted'} />}
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs">{ext}</div>
                  <div className="text-xs text-plm-fg-muted truncate">{label}</div>
                </div>
                {isSelected && (
                  <div className="w-2 h-2 rounded-full bg-plm-accent flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>

        {/* Custom extension input */}
        <div className="flex items-center gap-2 pt-3 border-t border-plm-border">
          <span className="text-sm text-plm-fg-muted">Custom:</span>
          <input
            type="text"
            value={customExtension}
            onChange={(e) => setCustomExtension(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCustomExtension()}
            placeholder=".xyz"
            disabled={!isAdmin || !settings.enabled}
            className="w-24 px-2 py-1 bg-plm-input border border-plm-border rounded text-sm text-plm-fg font-mono placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <button
            onClick={addCustomExtension}
            disabled={!isAdmin || !settings.enabled || !customExtension.trim()}
            className="px-2 py-1 text-sm bg-plm-highlight hover:bg-plm-highlight/80 text-plm-fg rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
          
          {/* Show selected extensions not in common list */}
          <div className="flex-1 flex flex-wrap gap-1 ml-2">
            {(settings.auto_apply_extensions || [])
              .filter(ext => !COMMON_EXTENSIONS.some(c => c.ext === ext))
              .map(ext => (
                <span 
                  key={ext}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-plm-accent/20 text-plm-accent rounded text-xs font-mono"
                >
                  {ext}
                  {isAdmin && settings.enabled && (
                    <button 
                      onClick={() => toggleExtension(ext)}
                      className="hover:text-plm-error"
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              ))
            }
          </div>
        </div>

        {/* Summary */}
        {(settings.auto_apply_extensions || []).length > 0 && (
          <div className="mt-3 text-xs text-plm-fg-muted">
            Auto-serialization enabled for: <span className="font-mono text-plm-fg">{(settings.auto_apply_extensions || []).join(', ')}</span>
          </div>
        )}
        {(settings.auto_apply_extensions || []).length === 0 && settings.enabled && (
          <div className="mt-3 text-xs text-plm-warning flex items-center gap-1">
            <AlertTriangle size={12} />
            No file types selected. Auto-serialization won't apply to any files.
          </div>
        )}
      </div>

      {/* Format Settings */}
      <div className={`p-4 bg-plm-bg rounded-lg border border-plm-border ${!settings.enabled ? 'opacity-50' : ''}`}>
        <h3 className="text-base font-medium text-plm-fg mb-4">Number Format</h3>
        
        <div className="grid grid-cols-2 gap-4">
          {/* Prefix */}
          <div>
            <label className="text-sm text-plm-fg-muted block mb-1">Prefix</label>
            <input
              type="text"
              value={settings.prefix}
              onChange={(e) => updateSetting('prefix', e.target.value)}
              placeholder="PN-"
              disabled={!isAdmin || !settings.enabled}
              className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent disabled:opacity-60 disabled:cursor-not-allowed font-mono"
            />
            <p className="text-xs text-plm-fg-muted mt-1">Text before the number</p>
          </div>

          {/* Suffix */}
          <div>
            <label className="text-sm text-plm-fg-muted block mb-1">Suffix</label>
            <input
              type="text"
              value={settings.suffix}
              onChange={(e) => updateSetting('suffix', e.target.value)}
              placeholder="-A"
              disabled={!isAdmin || !settings.enabled}
              className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent disabled:opacity-60 disabled:cursor-not-allowed font-mono"
            />
            <p className="text-xs text-plm-fg-muted mt-1">Text after the number</p>
          </div>

          {/* Letter Prefix */}
          <div>
            <label className="text-sm text-plm-fg-muted block mb-1">Letter Prefix</label>
            <input
              type="text"
              value={settings.letter_prefix}
              onChange={(e) => updateSetting('letter_prefix', e.target.value.toUpperCase())}
              placeholder="AB"
              maxLength={4}
              disabled={!isAdmin || !settings.enabled}
              className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent disabled:opacity-60 disabled:cursor-not-allowed font-mono uppercase"
            />
            <p className="text-xs text-plm-fg-muted mt-1">Letters between prefix and number (e.g., AB in PN-AB00001)</p>
          </div>

          {/* Number of Digits */}
          <div>
            <label className="text-sm text-plm-fg-muted block mb-1">Number Padding</label>
            <select
              value={settings.padding_digits}
              onChange={(e) => updateSetting('padding_digits', parseInt(e.target.value))}
              disabled={!isAdmin || !settings.enabled}
              className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg focus:outline-none focus:border-plm-accent disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <option value={3}>3 digits (001)</option>
              <option value={4}>4 digits (0001)</option>
              <option value={5}>5 digits (00001)</option>
              <option value={6}>6 digits (000001)</option>
              <option value={7}>7 digits (0000001)</option>
              <option value={8}>8 digits (00000001)</option>
            </select>
            <p className="text-xs text-plm-fg-muted mt-1">Zero-padding for the numeric part</p>
          </div>
        </div>

        {/* Current Counter */}
        <div className="mt-4 pt-4 border-t border-plm-border">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm text-plm-fg-muted">Current Counter Value</label>
            <div className="group relative">
              <Info size={14} className="text-plm-fg-muted/50" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-plm-bg-elevated border border-plm-border rounded text-xs text-plm-fg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                The next number generated will be this value + 1
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={settings.current_counter}
              onChange={(e) => updateSetting('current_counter', Math.max(0, parseInt(e.target.value) || 0))}
              min="0"
              disabled={!isAdmin || !settings.enabled}
              className="w-32 px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg focus:outline-none focus:border-plm-accent disabled:opacity-60 disabled:cursor-not-allowed font-mono"
            />
            <span className="text-sm text-plm-fg-muted">
              Next number will be: <span className="font-mono font-medium text-plm-fg">{settings.current_counter + 1}</span>
            </span>
          </div>
          {isAdmin && (
            <p className="text-xs text-plm-warning mt-2 flex items-center gap-1">
              <AlertTriangle size={12} />
              Changing this value can cause duplicate or skipped numbers. Use with caution.
            </p>
          )}
        </div>
      </div>

      {/* Keepout Zones */}
      <div className={`p-4 bg-plm-bg rounded-lg border border-plm-border ${!settings.enabled ? 'opacity-50' : ''}`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-medium text-plm-fg">Keepout Zones</h3>
            <p className="text-xs text-plm-fg-muted mt-0.5">
              Reserved number ranges that will be skipped during auto-generation
            </p>
          </div>
          {isAdmin && settings.enabled && (
            <button
              onClick={() => setShowKeepoutForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-plm-highlight hover:bg-plm-highlight/80 text-plm-fg rounded-lg transition-colors"
            >
              <Plus size={14} />
              Add Zone
            </button>
          )}
        </div>

        {/* Add keepout zone form */}
        {showKeepoutForm && (
          <div className="p-3 bg-plm-highlight rounded-lg mb-4">
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-plm-fg-muted block mb-1">Start</label>
                <input
                  type="number"
                  value={newKeepout.start}
                  onChange={(e) => setNewKeepout(prev => ({ ...prev, start: e.target.value }))}
                  placeholder="1000"
                  min="0"
                  className="w-full px-2 py-1.5 bg-plm-input border border-plm-border rounded text-sm text-plm-fg focus:outline-none focus:border-plm-accent font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-plm-fg-muted block mb-1">End</label>
                <input
                  type="number"
                  value={newKeepout.end}
                  onChange={(e) => setNewKeepout(prev => ({ ...prev, end: e.target.value }))}
                  placeholder="1999"
                  min="0"
                  className="w-full px-2 py-1.5 bg-plm-input border border-plm-border rounded text-sm text-plm-fg focus:outline-none focus:border-plm-accent font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-plm-fg-muted block mb-1">Description</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newKeepout.description}
                    onChange={(e) => setNewKeepout(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Legacy part numbers"
                    className="flex-1 px-2 py-1.5 bg-plm-input border border-plm-border rounded text-sm text-plm-fg focus:outline-none focus:border-plm-accent"
                  />
                  <button
                    onClick={addKeepoutZone}
                    className="px-3 py-1.5 bg-plm-accent hover:bg-plm-accent-hover text-white rounded text-sm transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setShowKeepoutForm(false)
                      setNewKeepout({ start: '', end: '', description: '' })
                    }}
                    className="px-2 py-1.5 text-plm-fg-muted hover:text-plm-fg transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Keepout zones list */}
        {settings.keepout_zones.length === 0 ? (
          <div className="text-center py-6 text-sm text-plm-fg-muted">
            No keepout zones defined. All numbers will be available for assignment.
          </div>
        ) : (
          <div className="space-y-2">
            {settings.keepout_zones.map((zone, index) => (
              <div 
                key={index}
                className="flex items-center justify-between p-3 bg-plm-highlight rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="font-mono text-sm">
                    <span className="text-plm-warning">{zone.start.toLocaleString()}</span>
                    <span className="text-plm-fg-muted mx-2">→</span>
                    <span className="text-plm-warning">{zone.end_num.toLocaleString()}</span>
                  </div>
                  <span className="text-sm text-plm-fg-muted">
                    {zone.description}
                  </span>
                  <span className="text-xs text-plm-fg-muted/60">
                    ({(zone.end_num - zone.start + 1).toLocaleString()} numbers)
                  </span>
                </div>
                {isAdmin && settings.enabled && (
                  <button
                    onClick={() => removeKeepoutZone(index)}
                    className="p-1.5 text-plm-fg-muted hover:text-plm-error transition-colors"
                    title="Remove zone"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Example Patterns */}
      <div className="p-4 bg-plm-highlight/50 rounded-lg border border-plm-border/50">
        <h4 className="text-sm font-medium text-plm-fg mb-3">Example Patterns</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <code className="px-2 py-1 bg-plm-bg rounded font-mono text-plm-accent">PN-00001</code>
            <span className="text-plm-fg-muted">Prefix: "PN-", 5 digits</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="px-2 py-1 bg-plm-bg rounded font-mono text-plm-accent">BR-AB00001</code>
            <span className="text-plm-fg-muted">Prefix: "BR-", Letters: "AB"</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="px-2 py-1 bg-plm-bg rounded font-mono text-plm-accent">100001</code>
            <span className="text-plm-fg-muted">No prefix, 6 digits</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="px-2 py-1 bg-plm-bg rounded font-mono text-plm-accent">PN-00001-REV</code>
            <span className="text-plm-fg-muted">With suffix: "-REV"</span>
          </div>
        </div>
      </div>

      {/* Save button - only shown for admins */}
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary flex items-center gap-2"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            Save Settings
          </button>
        </div>
      )}
    </div>
  )
}

