import { useState, useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import {
  RotateCcw,
  Save,
  Download,
  Loader2,
  Users,
  ExternalLink,
  Upload,
  AlertTriangle,
  X,
} from 'lucide-react'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import { useDeniedModules } from '@/hooks/useDeniedModules'
import { supabase } from '@/lib/supabase'
import { ModulesEditor } from './ModulesEditor'

// Team type for module defaults display
interface TeamWithModules {
  id: string
  name: string
  color: string
  icon: string
  module_defaults: Record<string, unknown> | null
  member_count: number
}

export function ModulesSettings() {
  const {
    moduleConfig,
    setModuleConfig,
    resetModulesToDefaults,
    loadOrgModuleDefaults,
    saveOrgModuleDefaults,
    forceOrgModuleDefaults,
    getEffectiveRole,
    organization,
    setActiveView,
  } = usePDMStore()

  const deniedModules = useDeniedModules()

  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null)

  // Force push state
  const [showForceConfirm, setShowForceConfirm] = useState(false)
  const [isForcing, setIsForcing] = useState(false)
  const [forceResult, setForceResult] = useState<'success' | 'error' | null>(null)

  // Teams with module defaults
  const [teamsWithModules, setTeamsWithModules] = useState<TeamWithModules[]>([])
  const [_teamsLoading, setTeamsLoading] = useState(false)

  const isAdmin = getEffectiveRole() === 'admin'

  // Load teams with module defaults
  useEffect(() => {
    if (organization?.id) {
      loadTeamsWithModules()
    }
  }, [organization?.id])

  const loadTeamsWithModules = async () => {
    if (!organization?.id) return

    setTeamsLoading(true)
    try {
      const { data, error } = await supabase
        .from('teams')
        .select(
          `
          id,
          name,
          color,
          icon,
          module_defaults,
          team_members(count)
        `,
        )
        .eq('org_id', organization.id)
        .not('module_defaults', 'is', null)
        .order('name')

      if (error) throw error
      // Supabase v2 nested select type inference incomplete for team counts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teamsWithCounts = (data || []).map((team: any) => ({
        ...team,
        member_count: team.team_members?.[0]?.count || 0,
      }))

      setTeamsWithModules(teamsWithCounts)
    } catch (error) {
      log.error('[ModulesSettings]', 'Failed to load teams with modules', { error: error })
    } finally {
      setTeamsLoading(false)
    }
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

  const handleForceOrgDefaults = async () => {
    setIsForcing(true)
    setForceResult(null)
    try {
      const result = await forceOrgModuleDefaults()
      setForceResult(result.success ? 'success' : 'error')
      if (result.success) {
        setShowForceConfirm(false)
        setTimeout(() => setForceResult(null), 3000)
      }
    } catch (error) {
      log.error('[ModulesSettings]', 'Failed to force org defaults', { error: error })
      setForceResult('error')
    } finally {
      setIsForcing(false)
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
            <>
              <button
                onClick={() => setShowForceConfirm(true)}
                disabled={isForcing}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  forceResult === 'success'
                    ? 'bg-plm-success/20 text-plm-success border border-plm-success/30'
                    : forceResult === 'error'
                      ? 'bg-plm-error/20 text-plm-error border border-plm-error/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30'
                }`}
                title="Push this configuration to all organization members, overriding their settings"
              >
                {isForcing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {forceResult === 'success'
                  ? 'Pushed!'
                  : forceResult === 'error'
                    ? 'Failed'
                    : 'Push to All Users'}
              </button>
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
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saveResult === 'success'
                  ? 'Saved!'
                  : saveResult === 'error'
                    ? 'Failed'
                    : 'Save Defaults'}
              </button>
            </>
          )}
          <button
            onClick={handleLoadOrgDefaults}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors disabled:opacity-50"
            title="Load organization defaults"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
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

      {/* Main Module Editor */}
      <ModulesEditor
        config={moduleConfig}
        onConfigChange={setModuleConfig}
        deniedModuleIds={deniedModules}
      />

      {/* Teams with Module Defaults */}
      {teamsWithModules.length > 0 && (
        <section className="pb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium flex items-center gap-2">
              <Users size={14} />
              Teams with Custom Module Defaults
            </h2>
            <button
              onClick={() => setActiveView('settings')}
              className="text-xs text-plm-accent hover:text-plm-accent/80 flex items-center gap-1"
            >
              Manage in Teams Settings
              <ExternalLink size={10} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {teamsWithModules.map((team) => {
              // Dynamic Lucide icon lookup requires any cast (icon name is runtime string)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const IconComponent = (LucideIcons as any)[team.icon] || Users // TODO: type this
              const defaults = team.module_defaults as {
                enabled_modules?: Record<string, boolean>
              } | null
              const enabledCount = defaults?.enabled_modules
                ? Object.values(defaults.enabled_modules).filter(Boolean).length
                : 0

              return (
                <div
                  key={team.id}
                  className="flex items-center gap-3 p-3 bg-plm-bg rounded-lg border border-plm-border hover:border-plm-accent/30 transition-colors"
                >
                  <div
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: `${team.color}20`, color: team.color }}
                  >
                    <IconComponent size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-plm-fg truncate">{team.name}</div>
                    <div className="text-xs text-plm-fg-muted">
                      {enabledCount} modules • {team.member_count} member
                      {team.member_count !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div
                    className="w-2 h-2 rounded-full bg-green-500"
                    title="Has custom module defaults"
                  />
                </div>
              )
            })}
          </div>

          <p className="text-xs text-plm-fg-dim mt-3">
            Team members inherit these module defaults instead of organization defaults.
          </p>
        </section>
      )}

      {/* Force Push Confirmation Dialog */}
      {showForceConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-plm-bg border border-plm-border rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-plm-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <AlertTriangle size={20} className="text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold text-plm-fg">Push to All Users</h3>
              </div>
              <button
                onClick={() => setShowForceConfirm(false)}
                className="p-1.5 rounded-lg text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              <p className="text-sm text-plm-fg">
                This will <strong>override</strong> the sidebar configuration for{' '}
                <strong>all users</strong> in your organization.
              </p>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-sm text-amber-300">
                  <strong>Warning:</strong> Users who have customized their sidebar will have their
                  changes overwritten. This action cannot be undone.
                </p>
              </div>

              <p className="text-sm text-plm-fg-muted">
                Users who are currently online will receive the update immediately. Others will see
                the changes when they next open BluePLM.
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-4 border-t border-plm-border bg-plm-bg-secondary">
              <button
                onClick={() => setShowForceConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleForceOrgDefaults}
                disabled={isForcing}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-amber-500 text-black font-medium hover:bg-amber-400 transition-colors disabled:opacity-50"
              >
                {isForcing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {isForcing ? 'Pushing...' : 'Push to All Users'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
