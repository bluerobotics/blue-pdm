import { useState, useEffect, useMemo } from 'react'
import { 
  Loader2, 
  Package,
  FileOutput,
  Eye,
  RotateCcw,
  User,
  Building2
} from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'
import { ExportSettings as ExportSettingsType, DEFAULT_EXPORT_SETTINGS } from '@/types/pdm'

// LocalStorage key for user preferences
const USER_EXPORT_SETTINGS_KEY = 'blueplm_export_settings'

// Available tokens for filename patterns
const FILENAME_TOKENS = [
  { token: '{filename}', label: 'File name', description: 'Original file name without extension', example: 'Part1' },
  { token: '{config}', label: 'Configuration', description: 'SolidWorks configuration name', example: 'Default' },
  { token: '{partNumber}', label: 'Part Number', description: 'Part/Item number from properties', example: 'BR-101011-394' },
  { token: '{number}', label: 'Number (alt)', description: 'Same as {partNumber}', example: 'BR-101011-394' },
  { token: '{revision}', label: 'Revision', description: 'Revision from properties', example: 'A' },
  { token: '{rev}', label: 'Rev (alt)', description: 'Same as {revision}', example: 'A' },
  { token: '{description}', label: 'Description', description: 'Description from properties', example: 'Thruster Housing' },
  { token: '{desc}', label: 'Desc (alt)', description: 'Same as {description}', example: 'Thruster Housing' },
  { token: '{date}', label: 'Date', description: 'Current date (YYYY-MM-DD)', example: '2026-01-01' },
  { token: '{time}', label: 'Time', description: 'Current time (HH-MM-SS)', example: '14-30-00' },
  { token: '{datetime}', label: 'Date & Time', description: 'Current date and time', example: '2026-01-01_14-30-00' },
]

// Preset patterns for quick selection
const PRESET_PATTERNS = [
  { pattern: '{filename}_{config}', label: 'File + Config', description: 'Part1_Default.step' },
  { pattern: '{partNumber}', label: 'Part Number Only', description: 'BR-101011-394.step' },
  { pattern: '{partNumber}_Rev{rev}', label: 'Part + Revision', description: 'BR-101011-394_RevA.step' },
  { pattern: '{partNumber}_{config}', label: 'Part + Config', description: 'BR-101011-394_Default.step' },
  { pattern: '{partNumber}_{config}_Rev{rev}', label: 'Part + Config + Rev', description: 'BR-101011-394_Default_RevA.step' },
  { pattern: '{filename}_{date}', label: 'File + Date', description: 'Part1_2026-01-01.step' },
  { pattern: '{partNumber}_{datetime}', label: 'Part + DateTime', description: 'BR-101011-394_2026-01-01_14-30-00.step' },
]

// Get user's export settings from localStorage
function getUserExportSettings(): ExportSettingsType | null {
  try {
    const stored = localStorage.getItem(USER_EXPORT_SETTINGS_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch {
    // Ignore parse errors
  }
  return null
}

// Save user's export settings to localStorage
function saveUserExportSettings(settings: ExportSettingsType) {
  localStorage.setItem(USER_EXPORT_SETTINGS_KEY, JSON.stringify(settings))
}

// Clear user's export settings (revert to org default)
function clearUserExportSettings() {
  localStorage.removeItem(USER_EXPORT_SETTINGS_KEY)
}

// Get effective export settings (user override > org default > app default)
export function getEffectiveExportSettings(organization: { settings?: any } | null): ExportSettingsType {
  // First check user preference
  const userSettings = getUserExportSettings()
  if (userSettings) {
    return userSettings
  }
  
  // Then check org default
  const orgSettings = organization?.settings?.export_settings
  if (orgSettings) {
    return { ...DEFAULT_EXPORT_SETTINGS, ...orgSettings }
  }
  
  // Fall back to app default
  return DEFAULT_EXPORT_SETTINGS
}

export function ExportSettings() {
  const { organization, addToast, getEffectiveRole, updateOrganization } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<ExportSettingsType>(DEFAULT_EXPORT_SETTINGS)
  const [hasUserOverride, setHasUserOverride] = useState(false)
  
  // Load settings - user override takes priority over org default
  useEffect(() => {
    if (!organization) return
    
    const userSettings = getUserExportSettings()
    if (userSettings) {
      setSettings(userSettings)
      setHasUserOverride(true)
    } else {
      const orgSettings = (organization.settings as any)?.export_settings
      if (orgSettings) {
        setSettings({ ...DEFAULT_EXPORT_SETTINGS, ...orgSettings })
      } else {
        setSettings(DEFAULT_EXPORT_SETTINGS)
      }
      setHasUserOverride(false)
    }
    setLoading(false)
  }, [organization])

  // Get org default for comparison
  const orgDefault = useMemo(() => {
    const orgSettings = (organization?.settings as any)?.export_settings
    return orgSettings ? { ...DEFAULT_EXPORT_SETTINGS, ...orgSettings } : DEFAULT_EXPORT_SETTINGS
  }, [organization?.settings])

  // Generate a live preview of what the filename will look like
  const livePreview = useMemo(() => {
    let result = settings.filename_pattern
    
    // Sample values for preview
    const sampleValues: Record<string, string> = {
      '{filename}': 'Part1',
      '{config}': 'Config-A',
      '{partNumber}': 'BR-101011-394',
      '{number}': 'BR-101011-394',
      '{revision}': 'A',
      '{rev}': 'A',
      '{description}': 'Thruster',
      '{desc}': 'Thruster',
      '{date}': '2026-01-01',
      '{time}': '14-30-00',
      '{datetime}': '2026-01-01_14-30-00',
    }
    
    // Replace tokens (case-insensitive)
    for (const [token, value] of Object.entries(sampleValues)) {
      const regex = new RegExp(token.replace(/[{}]/g, '\\$&'), 'gi')
      result = result.replace(regex, value)
    }
    
    return result + '.step'
  }, [settings.filename_pattern])

  // Save as user preference (localStorage)
  const handleSaveUserPreference = () => {
    saveUserExportSettings(settings)
    setHasUserOverride(true)
    addToast('success', 'Saved as your personal preference')
  }

  // Reset to org default
  const handleResetToOrgDefault = () => {
    clearUserExportSettings()
    setSettings(orgDefault)
    setHasUserOverride(false)
    addToast('info', 'Reset to organization default')
  }

  // Save as org default (admin only)
  const handleSaveOrgDefault = async () => {
    if (!organization?.id || !isAdmin) return
    
    setSaving(true)
    try {
      // Get current settings and merge
      const currentSettings = organization.settings || {}
      const newSettings = {
        ...currentSettings,
        export_settings: settings
      }
      
      const { error } = await (supabase
        .from('organizations') as any)
        .update({ settings: newSettings })
        .eq('id', organization.id)
        .select()
      
      if (error) {
        console.error('Supabase error:', error)
        throw error
      }
      
      // Update local state
      updateOrganization({ settings: newSettings } as any)
      addToast('success', 'Organization default saved')
    } catch (err) {
      console.error('Failed to save org export settings:', err)
      addToast('error', `Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  // Insert token at cursor or end of pattern
  const insertToken = (token: string) => {
    setSettings(prev => ({
      ...prev,
      filename_pattern: prev.filename_pattern + token
    }))
  }

  if (!organization) {
    return (
      <div className="p-6 text-center text-plm-fg-muted">
        No organization selected
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center gap-2">
        <Loader2 className="animate-spin" size={20} />
        <span>Loading export settings...</span>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <Package className="text-emerald-400" size={24} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-plm-fg">Export Settings</h2>
            <p className="text-sm text-plm-fg-muted">
              Configure how exported files are named
            </p>
          </div>
        </div>
        
        {/* Save buttons */}
        <div className="flex items-center gap-2">
          {hasUserOverride && (
            <button
              onClick={handleResetToOrgDefault}
              className="flex items-center gap-2 px-3 py-2 bg-plm-bg border border-plm-border hover:bg-plm-bg-light rounded-lg text-plm-fg-muted hover:text-plm-fg text-sm transition-colors"
              title="Reset to organization default"
            >
              <RotateCcw size={14} />
              Reset to Default
            </button>
          )}
          
          <button
            onClick={handleSaveUserPreference}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white text-sm font-medium transition-colors"
          >
            <User size={16} />
            Save for Me
          </button>
          
          {isAdmin && (
            <button
              onClick={handleSaveOrgDefault}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-white text-sm font-medium transition-colors"
              title="Set as organization-wide default"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Building2 size={16} />}
              Save as Org Default
            </button>
          )}
        </div>
      </div>

      {/* Current mode indicator */}
      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm ${
        hasUserOverride 
          ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' 
          : 'bg-plm-bg-light/30 border border-plm-border/30 text-plm-fg-muted'
      }`}>
        {hasUserOverride ? (
          <>
            <User size={16} />
            <span>Using your personal preference</span>
          </>
        ) : (
          <>
            <Building2 size={16} />
            <span>Using organization default</span>
          </>
        )}
      </div>

      {/* Filename Pattern */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-plm-fg mb-2">
            Filename Pattern
          </label>
          <input
            type="text"
            value={settings.filename_pattern}
            onChange={(e) => setSettings(prev => ({ ...prev, filename_pattern: e.target.value }))}
            placeholder="{filename}_{config}"
            className="w-full px-4 py-2.5 bg-plm-bg border border-plm-border rounded-lg text-plm-fg 
              focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20
              font-mono text-sm"
          />
          <p className="mt-1.5 text-xs text-plm-fg-muted">
            Use tokens like {'{partNumber}'}, {'{config}'}, {'{rev}'} to build dynamic filenames
          </p>
        </div>

        {/* Live Preview */}
        <div className="bg-plm-bg-light/30 border border-plm-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-xs text-plm-fg-muted mb-2">
            <Eye size={14} />
            <span>Preview</span>
          </div>
          <div className="font-mono text-sm text-cyan-400">
            {livePreview}
          </div>
        </div>

        {/* Preset Patterns */}
        <div>
          <label className="block text-xs text-plm-fg-muted mb-2">
            Quick Presets
          </label>
          <div className="flex flex-wrap gap-2">
            {PRESET_PATTERNS.map(preset => (
              <button
                key={preset.pattern}
                onClick={() => setSettings(prev => ({ ...prev, filename_pattern: preset.pattern }))}
                className={`px-3 py-1.5 rounded text-xs transition-colors
                  ${settings.filename_pattern === preset.pattern
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                    : 'bg-plm-bg border border-plm-border/50 text-plm-fg-muted hover:bg-plm-bg-light/50 hover:text-plm-fg'
                  }`}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Available Tokens */}
        <div>
          <label className="block text-xs text-plm-fg-muted mb-2">
            Available Tokens (click to insert)
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {FILENAME_TOKENS.map(({ token, label, description, example }) => (
              <button
                key={token}
                onClick={() => insertToken(token)}
                className="flex flex-col items-start p-2 rounded bg-plm-bg border border-plm-border/50 
                  hover:bg-plm-bg-light/50 hover:border-plm-border text-left transition-colors group"
                title={`${description} (e.g., ${example})`}
              >
                <span className="text-xs font-mono text-cyan-400 group-hover:text-cyan-300">{token}</span>
                <span className="text-[10px] text-plm-fg-muted truncate w-full">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Additional Options */}
      <div className="space-y-4 border-t border-plm-border/50 pt-6">
        <h3 className="text-sm font-medium text-plm-fg">Additional Options</h3>
        
        {/* Include config name checkbox */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.include_config_in_filename}
            onChange={(e) => setSettings(prev => ({ ...prev, include_config_in_filename: e.target.checked }))}
            className="w-4 h-4 rounded border-plm-border bg-plm-bg text-cyan-500 
              focus:ring-cyan-500/20 focus:ring-offset-0"
          />
          <div>
            <div className="text-sm text-plm-fg">Include configuration name for single-config exports</div>
            <div className="text-xs text-plm-fg-muted">
              When exporting a single configuration, add config name to filename
            </div>
          </div>
        </label>

        {/* Default export format */}
        <div>
          <label className="block text-sm text-plm-fg mb-2">
            Default Export Format
          </label>
          <div className="flex gap-2">
            {(['step', 'iges', 'stl'] as const).map(format => (
              <button
                key={format}
                onClick={() => setSettings(prev => ({ ...prev, default_export_format: format }))}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                  ${settings.default_export_format === format
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                    : 'bg-plm-bg border border-plm-border/50 text-plm-fg-muted hover:bg-plm-bg-light/50'
                  }`}
              >
                <FileOutput size={14} />
                {format.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-plm-fg-muted">
            Default format when exporting from file browser context menu
          </p>
        </div>
      </div>

      {/* Token Reference */}
      <div className="border-t border-plm-border/50 pt-6">
        <h3 className="text-sm font-medium text-plm-fg mb-4">Token Reference</h3>
        <div className="bg-plm-bg-light/20 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-plm-border/30">
                <th className="text-left px-4 py-2 text-plm-fg-muted font-medium">Token</th>
                <th className="text-left px-4 py-2 text-plm-fg-muted font-medium">Description</th>
                <th className="text-left px-4 py-2 text-plm-fg-muted font-medium">Example</th>
              </tr>
            </thead>
            <tbody>
              {FILENAME_TOKENS.map(({ token, description, example }) => (
                <tr key={token} className="border-b border-plm-border/20 last:border-0">
                  <td className="px-4 py-2 font-mono text-cyan-400 text-xs">{token}</td>
                  <td className="px-4 py-2 text-plm-fg-muted text-xs">{description}</td>
                  <td className="px-4 py-2 text-plm-fg text-xs">{example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default ExportSettings
