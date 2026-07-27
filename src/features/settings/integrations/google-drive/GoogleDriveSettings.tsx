import { useState, useEffect, useRef } from 'react'
import { HardDrive, Loader2, Check, Eye, EyeOff, Puzzle } from 'lucide-react'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'

export function GoogleDriveSettings() {
  const { organization, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'

  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [inspectionTemplateFolderId, setInspectionTemplateFolderId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  // Track if we're currently saving to avoid overwriting with stale realtime data
  const savingRef = useRef(false)

  useEffect(() => {
    loadSettings()
  }, [organization?.id])

  const loadSettings = async () => {
    if (!organization?.id) return

    setIsLoading(true)
    try {
      const { data, error } = await (supabase.rpc as any)('get_google_drive_settings', { // TODO: type this
        p_org_id: organization.id,
      })

      if (error) {
        log.error('[GoogleDrive]', 'Error loading settings', { error })
        return
      }

      if (data && Array.isArray(data) && data.length > 0) {
        const settings = data[0] as {
          client_id?: string
          client_secret?: string
          enabled?: boolean
          inspection_template_folder_id?: string
        }
        setClientId(settings.client_id || '')
        setClientSecret(settings.client_secret || '')
        setEnabled(settings.enabled || false)
        setInspectionTemplateFolderId(settings.inspection_template_folder_id || '')
      }
    } catch (error) {
      log.error('[GoogleDrive]', 'Error loading settings', { error: error })
    } finally {
      setIsLoading(false)
    }
  }

  // Sync with realtime organization changes (when another admin updates settings)
  useEffect(() => {
    // Skip if we're currently saving (to avoid overwriting our own changes)
    if (savingRef.current) return
    // Skip if still loading initial data
    if (isLoading) return

    // Sync Google Drive fields from realtime organization object
    const org = organization as any // TODO: type this
    if (org) {
      if (org.google_drive_enabled !== undefined) {
        setEnabled(org.google_drive_enabled)
      }
      if (org.google_drive_client_id !== undefined) {
        setClientId(org.google_drive_client_id || '')
      }
      if (org.google_drive_client_secret !== undefined) {
        setClientSecret(org.google_drive_client_secret || '')
      }
      if (org.google_drive_inspection_template_folder_id !== undefined) {
        setInspectionTemplateFolderId(org.google_drive_inspection_template_folder_id || '')
      }
    }
  }, [
    isLoading,
    (organization as any)?.google_drive_enabled, // TODO: type this
    (organization as any)?.google_drive_client_id, // TODO: type this
    (organization as any)?.google_drive_client_secret, // TODO: type this
    (organization as any)?.google_drive_inspection_template_folder_id, // TODO: type this
  ])

  const saveSettings = async () => {
    if (!organization?.id || !isAdmin) return

    setIsSaving(true)
    savingRef.current = true
    try {
      const { error } = await (supabase.rpc as any)('update_google_drive_settings', { // TODO: type this
        p_org_id: organization.id,
        p_client_id: clientId || null,
        p_client_secret: clientSecret || null,
        p_enabled: enabled,
        p_inspection_template_folder_id: inspectionTemplateFolderId.trim() || null,
      })

      if (error) {
        log.error('[GoogleDrive]', 'Error saving settings', { error })
        addToast('error', 'Failed to save: ' + error.message)
        return
      }

      addToast('success', 'Google Drive settings saved')
    } catch (error) {
      log.error('[GoogleDrive]', 'Error saving settings', { error: error })
      addToast('error', 'Failed to save Google Drive settings')
    } finally {
      setIsSaving(false)
      // Small delay before allowing realtime sync again to let the update propagate
      setTimeout(() => {
        savingRef.current = false
      }, 1000)
    }
  }

  return (
    <div className="space-y-6">
      {/* Admin notice for non-admins */}
      {!isAdmin && (
        <div className="flex items-center gap-2 p-3 bg-plm-info/10 border border-plm-info/30 rounded-lg text-sm text-plm-info">
          <Puzzle size={16} className="flex-shrink-0" />
          <span>Only administrators can edit integration settings.</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-plm-sidebar flex items-center justify-center">
          <HardDrive size={24} className="text-plm-accent" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-medium text-plm-fg">Google Drive</h3>
          <p className="text-sm text-plm-fg-muted">
            Allow org members to connect their Google Drive
          </p>
        </div>
        {isLoading && <Loader2 size={16} className="animate-spin text-plm-fg-muted" />}
      </div>

      <div className="space-y-4 p-4 bg-plm-bg rounded-lg border border-plm-border">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <span className="text-base text-plm-fg">Enable Google Drive</span>
          <button
            onClick={() => isAdmin && setEnabled(!enabled)}
            disabled={!isAdmin}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              enabled ? 'bg-plm-accent' : 'bg-plm-border'
            } ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <div
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {enabled && (
          <>
            {/* Client ID */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => isAdmin && setClientId(e.target.value)}
                placeholder="xxxxxxx.apps.googleusercontent.com"
                readOnly={!isAdmin}
                className={`w-full px-3 py-2 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
            </div>

            {/* Client Secret */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Client Secret</label>
              <div className="relative">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={clientSecret}
                  onChange={(e) => isAdmin && setClientSecret(e.target.value)}
                  placeholder="GOCSPX-xxxxxxxxxxxx"
                  readOnly={!isAdmin}
                  className={`w-full px-3 py-2 pr-10 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Inspection template folder */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Inspection template folder ID</label>
              <input
                type="text"
                value={inspectionTemplateFolderId}
                onChange={(e) => isAdmin && setInspectionTemplateFolderId(e.target.value)}
                placeholder="Google Drive folder ID containing inspection template sheets"
                readOnly={!isAdmin}
                className={`w-full px-3 py-2 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
              <p className="text-xs text-plm-fg-muted">
                Google Sheets in this folder appear in the "Generate template" dropdown on the
                inspection tab. Use tokens like {'{{BR_NUMBER}}'}, {'{{PART_PREVIEW}}'} and{' '}
                {'{{INSPECTION_TABLE}}'} in your templates. Paste the folder ID from its Drive URL
                (the part after <span className="font-mono">/folders/</span>).
              </p>
            </div>

            {/* Help text */}
            <div className="p-4 bg-plm-sidebar rounded-lg">
              <p className="text-sm text-plm-fg-muted font-medium mb-2">Setup instructions:</p>
              <ol className="text-sm text-plm-fg-muted space-y-1 list-decimal list-inside">
                <li>
                  Go to{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-plm-accent hover:underline"
                  >
                    Google Cloud Console
                  </a>
                </li>
                <li>Create or select a project</li>
                <li>Enable the Google Drive API and the Google Sheets API</li>
                <li>Create OAuth 2.0 credentials (Desktop app type)</li>
                <li>Copy the Client ID and Client Secret here</li>
              </ol>
            </div>

            {/* Save button - only show for admins */}
            {isAdmin && (
              <button
                onClick={saveSettings}
                disabled={isSaving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-accent text-white rounded-lg hover:bg-plm-accent/90 transition-colors disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Save Google Drive Settings
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
