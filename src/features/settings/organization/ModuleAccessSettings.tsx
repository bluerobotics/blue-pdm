import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Globe, Loader2, Lock, Save, Users, X } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { MODULE_GROUPS, MODULES, type ModuleGroupId, type ModuleId } from '@/types/modules'

interface OrgTeam {
  id: string
  name: string
  color: string
}

interface OrgMember {
  id: string
  full_name: string | null
  email: string
}

/** Allowlist for one module. Both lists empty means the module is unrestricted. */
interface ModuleAllowlist {
  teamIds: string[]
  userIds: string[]
}

interface AccessRow {
  module_id: string
  team_id: string | null
  user_id: string | null
}

const EMPTY_ALLOWLIST: ModuleAllowlist = { teamIds: [], userIds: [] }

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

/**
 * Admin page for restricting sidebar modules to specific teams and users.
 *
 * Restriction is opt-in: a module with an empty allowlist stays visible to the
 * whole organization. Adding the first team or user is what turns the module
 * private, which is why the UI leads with "Everyone" rather than an unchecked
 * list of teams.
 */
export function ModuleAccessSettings() {
  const organization = usePDMStore((s) => s.organization)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const addToast = usePDMStore((s) => s.addToast)
  const loadModuleAccess = usePDMStore((s) => s.loadModuleAccess)

  const isAdmin = getEffectiveRole() === 'admin'

  const [teams, setTeams] = useState<OrgTeam[]>([])
  const [members, setMembers] = useState<OrgMember[]>([])
  const [saved, setSaved] = useState<Record<string, ModuleAllowlist>>({})
  const [drafts, setDrafts] = useState<Record<string, ModuleAllowlist>>({})
  const [loading, setLoading] = useState(false)
  const [savingModuleId, setSavingModuleId] = useState<string | null>(null)
  const [expandedModuleId, setExpandedModuleId] = useState<ModuleId | null>(null)

  const load = useCallback(async () => {
    if (!organization?.id || !isAdmin) return

    setLoading(true)
    try {
      const [teamsResult, membersResult, accessResult] = await Promise.all([
        supabase
          .from('teams')
          .select('id, name, color')
          .eq('org_id', organization.id)
          .order('name'),
        supabase
          .from('users')
          .select('id, full_name, email')
          .eq('org_id', organization.id)
          .order('full_name'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.rpc as any)('get_module_access_config'), // TODO: type this
      ])

      if (teamsResult.error) throw teamsResult.error
      if (membersResult.error) throw membersResult.error
      if (accessResult.error) throw accessResult.error

      setTeams((teamsResult.data || []) as OrgTeam[])
      setMembers((membersResult.data || []) as OrgMember[])

      const byModule: Record<string, ModuleAllowlist> = {}
      for (const row of (accessResult.data || []) as AccessRow[]) {
        const entry = byModule[row.module_id] || { teamIds: [], userIds: [] }
        if (row.team_id) entry.teamIds.push(row.team_id)
        if (row.user_id) entry.userIds.push(row.user_id)
        byModule[row.module_id] = entry
      }
      setSaved(byModule)
      setDrafts(byModule)
    } catch (error) {
      log.error('[ModuleAccessSettings]', 'Failed to load module access', { error })
      addToast('error', 'Failed to load module access')
    } finally {
      setLoading(false)
    }
  }, [organization?.id, isAdmin, addToast])

  useEffect(() => {
    load()
  }, [load])

  // Only modules that actually reach the sidebar are worth restricting
  const modulesByGroup = useMemo(() => {
    const grouped = new Map<ModuleGroupId, typeof MODULES>()
    for (const module of MODULES) {
      if (module.required) continue
      grouped.set(module.group, [...(grouped.get(module.group) || []), module])
    }
    return grouped
  }, [])

  const getDraft = (moduleId: ModuleId): ModuleAllowlist => drafts[moduleId] || EMPTY_ALLOWLIST
  const getSaved = (moduleId: ModuleId): ModuleAllowlist => saved[moduleId] || EMPTY_ALLOWLIST

  const isDirty = (moduleId: ModuleId): boolean => {
    const draft = getDraft(moduleId)
    const current = getSaved(moduleId)
    return !sameIds(draft.teamIds, current.teamIds) || !sameIds(draft.userIds, current.userIds)
  }

  const toggleSubject = (moduleId: ModuleId, key: 'teamIds' | 'userIds', id: string) => {
    setDrafts((previous) => {
      const draft = previous[moduleId] || EMPTY_ALLOWLIST
      const ids = draft[key].includes(id)
        ? draft[key].filter((existing) => existing !== id)
        : [...draft[key], id]
      return { ...previous, [moduleId]: { ...draft, [key]: ids } }
    })
  }

  const clearRestriction = (moduleId: ModuleId) => {
    setDrafts((previous) => ({ ...previous, [moduleId]: { teamIds: [], userIds: [] } }))
  }

  const handleSave = async (moduleId: ModuleId) => {
    const draft = getDraft(moduleId)
    setSavingModuleId(moduleId)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('set_module_access', {
        // TODO: type this
        p_module_id: moduleId,
        p_team_ids: draft.teamIds,
        p_user_ids: draft.userIds,
      })
      if (error) throw error
      if (data && data.success === false) throw new Error(data.error || 'Failed to save')

      setSaved((previous) => ({ ...previous, [moduleId]: draft }))
      // The admin editing this may themselves be affected once they leave the
      // Administrators team, and impersonation reads the same store value.
      await loadModuleAccess()
      addToast('success', 'Module access updated')
    } catch (error) {
      log.error('[ModuleAccessSettings]', 'Failed to save module access', { error })
      addToast('error', error instanceof Error ? error.message : 'Failed to save module access')
    } finally {
      setSavingModuleId(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-plm-fg">Module Access</h1>
        <p className="text-sm text-plm-warning">
          Only organization admins can configure module access.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-plm-fg">Module Access</h1>
        <p className="text-sm text-plm-fg-muted mt-1">
          Restrict a module to specific teams or people. Modules with no restriction stay visible to
          everyone in the organization. Admins always keep access.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-plm-fg-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {MODULE_GROUPS.map((group) => {
            const groupModules = modulesByGroup.get(group.id)
            if (!groupModules || groupModules.length === 0) return null

            return (
              <section key={group.id}>
                <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-2">
                  {group.name}
                </h2>

                <div className="rounded-lg border border-plm-border bg-plm-bg divide-y divide-plm-border">
                  {groupModules.map((module) => {
                    const draft = getDraft(module.id)
                    const current = getSaved(module.id)
                    const isRestricted = current.teamIds.length > 0 || current.userIds.length > 0
                    const isExpanded = expandedModuleId === module.id
                    const dirty = isDirty(module.id)

                    return (
                      <div key={module.id}>
                        <button
                          type="button"
                          onClick={() => setExpandedModuleId(isExpanded ? null : module.id)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-plm-highlight/40 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown size={14} className="text-plm-fg-muted flex-shrink-0" />
                          ) : (
                            <ChevronRight size={14} className="text-plm-fg-muted flex-shrink-0" />
                          )}

                          <span className="flex-1 min-w-0 text-sm text-plm-fg truncate">
                            {module.name}
                          </span>

                          {isRestricted ? (
                            <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-plm-warning/15 text-plm-warning">
                              <Lock size={10} />
                              {current.teamIds.length > 0 &&
                                `${current.teamIds.length} team${current.teamIds.length === 1 ? '' : 's'}`}
                              {current.teamIds.length > 0 && current.userIds.length > 0 && ' + '}
                              {current.userIds.length > 0 &&
                                `${current.userIds.length} ${current.userIds.length === 1 ? 'person' : 'people'}`}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-plm-bg-lighter text-plm-fg-dim">
                              <Globe size={10} />
                              Everyone
                            </span>
                          )}
                        </button>

                        {isExpanded && (
                          <div className="px-3 pb-3 pt-1 space-y-4 bg-plm-bg-secondary/40">
                            <div>
                              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-plm-fg-muted mb-1.5">
                                <Users size={11} />
                                Teams
                              </div>
                              {teams.length === 0 ? (
                                <p className="text-xs text-plm-fg-dim">No teams yet.</p>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {teams.map((team) => {
                                    const selected = draft.teamIds.includes(team.id)
                                    return (
                                      <button
                                        key={team.id}
                                        type="button"
                                        onClick={() => toggleSubject(module.id, 'teamIds', team.id)}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border transition-colors ${
                                          selected
                                            ? 'border-plm-accent bg-plm-accent/15 text-plm-fg'
                                            : 'border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight/50'
                                        }`}
                                      >
                                        <span
                                          className="w-2 h-2 rounded-full"
                                          style={{ backgroundColor: team.color }}
                                        />
                                        {team.name}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>

                            <div>
                              <div className="text-[11px] uppercase tracking-wide text-plm-fg-muted mb-1.5">
                                Individual people
                              </div>
                              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                                {members.map((member) => {
                                  const selected = draft.userIds.includes(member.id)
                                  return (
                                    <button
                                      key={member.id}
                                      type="button"
                                      onClick={() => toggleSubject(module.id, 'userIds', member.id)}
                                      className={`px-2 py-1 rounded-full text-xs border transition-colors ${
                                        selected
                                          ? 'border-plm-accent bg-plm-accent/15 text-plm-fg'
                                          : 'border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight/50'
                                      }`}
                                    >
                                      {member.full_name || member.email}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleSave(module.id)}
                                disabled={!dirty || savingModuleId === module.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-plm-accent text-white hover:bg-plm-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                {savingModuleId === module.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Save size={14} />
                                )}
                                Save
                              </button>

                              {(draft.teamIds.length > 0 || draft.userIds.length > 0) && (
                                <button
                                  type="button"
                                  onClick={() => clearRestriction(module.id)}
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors"
                                  title="Remove the restriction so everyone can see this module"
                                >
                                  <X size={14} />
                                  Allow everyone
                                </button>
                              )}

                              <p className="text-xs text-plm-fg-dim">
                                {draft.teamIds.length === 0 && draft.userIds.length === 0
                                  ? 'Visible to the whole organization.'
                                  : 'Everyone else sees this module greyed out in their sidebar settings.'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
