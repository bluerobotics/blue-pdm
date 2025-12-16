// @ts-nocheck - Supabase type inference issues with new columns
import { useState, useEffect } from 'react'
import { 
  Loader2, 
  FileText,
  Save
} from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'

interface RFQSettingsData {
  default_payment_terms: string
  default_incoterms: string
  default_valid_days: number
  show_company_logo: boolean
  show_revision_column: boolean
  show_material_column: boolean
  show_finish_column: boolean
  show_notes_column: boolean
  terms_and_conditions: string
  footer_text: string
}

const DEFAULT_RFQ_SETTINGS: RFQSettingsData = {
  default_payment_terms: 'Net 30',
  default_incoterms: 'FOB',
  default_valid_days: 30,
  show_company_logo: true,
  show_revision_column: true,
  show_material_column: true,
  show_finish_column: true,
  show_notes_column: true,
  terms_and_conditions: '',
  footer_text: ''
}

export function RFQSettings() {
  const { organization, user, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<RFQSettingsData>(DEFAULT_RFQ_SETTINGS)

  // Load current settings
  useEffect(() => {
    if (!organization?.id) return

    const loadSettings = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('rfq_settings')
          .eq('id', organization.id)
          .single()

        if (error) throw error
        
        setSettings(data?.rfq_settings || DEFAULT_RFQ_SETTINGS)
      } catch (err) {
        console.error('Failed to load RFQ settings:', err)
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [organization?.id])

  // Save settings
  const handleSave = async () => {
    if (!organization?.id) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ rfq_settings: settings })
        .eq('id', organization.id)

      if (error) throw error
      addToast('success', 'RFQ settings saved')
    } catch (err) {
      console.error('Failed to save RFQ settings:', err)
      addToast('error', 'Failed to save RFQ settings')
    } finally {
      setSaving(false)
    }
  }

  // Update a setting
  const updateSetting = (key: keyof RFQSettingsData, value: string | number | boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  if (!organization) {
    return (
      <div className="text-center py-12 text-plm-fg-muted">
        No organization connected
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12 text-plm-fg-muted">
        Only administrators can manage RFQ settings
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
      {/* RFQ Template Settings */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={20} className="text-plm-accent" />
          <h3 className="text-base font-medium text-plm-fg">RFQ Template Defaults</h3>
        </div>

        <div className="space-y-4">
          {/* Default values */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm text-plm-fg-muted block mb-1">Payment Terms</label>
              <input
                type="text"
                value={settings.default_payment_terms}
                onChange={(e) => updateSetting('default_payment_terms', e.target.value)}
                placeholder="Net 30"
                className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
              />
            </div>
            <div>
              <label className="text-sm text-plm-fg-muted block mb-1">Incoterms</label>
              <input
                type="text"
                value={settings.default_incoterms}
                onChange={(e) => updateSetting('default_incoterms', e.target.value)}
                placeholder="FOB"
                className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
              />
            </div>
            <div>
              <label className="text-sm text-plm-fg-muted block mb-1">Quote Valid (days)</label>
              <input
                type="number"
                value={settings.default_valid_days}
                onChange={(e) => updateSetting('default_valid_days', parseInt(e.target.value) || 30)}
                min="1"
                className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg focus:outline-none focus:border-plm-accent"
              />
            </div>
          </div>

          {/* Column visibility */}
          <div>
            <label className="text-sm text-plm-fg-muted block mb-2">RFQ Document Columns</label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.show_company_logo}
                  onChange={(e) => updateSetting('show_company_logo', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-plm-fg">Show company logo</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.show_revision_column}
                  onChange={(e) => updateSetting('show_revision_column', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-plm-fg">Show revision column</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.show_material_column}
                  onChange={(e) => updateSetting('show_material_column', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-plm-fg">Show material column</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.show_finish_column}
                  onChange={(e) => updateSetting('show_finish_column', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-plm-fg">Show finish column</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.show_notes_column}
                  onChange={(e) => updateSetting('show_notes_column', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-plm-fg">Show notes column</span>
              </label>
            </div>
          </div>

          {/* Terms and conditions */}
          <div>
            <label className="text-sm text-plm-fg-muted block mb-1">Terms and Conditions</label>
            <textarea
              value={settings.terms_and_conditions}
              onChange={(e) => updateSetting('terms_and_conditions', e.target.value)}
              rows={4}
              placeholder="Enter standard terms and conditions for RFQ documents..."
              className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent resize-none"
            />
          </div>

          {/* Footer text */}
          <div>
            <label className="text-sm text-plm-fg-muted block mb-1">Footer Text</label>
            <input
              type="text"
              value={settings.footer_text}
              onChange={(e) => updateSetting('footer_text', e.target.value)}
              placeholder="Custom footer text for RFQ documents"
              className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
            />
          </div>
        </div>
      </div>

      {/* Save button */}
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
    </div>
  )
}

