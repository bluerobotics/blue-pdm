// User Row Component - displays a single user with inline dropdown menus
import { useState } from 'react'
import * as LucideIcons from 'lucide-react'
import {
  Users,
  Shield,
  ChevronDown,
  Search,
  Check,
  Lock,
  UserX,
  MoreVertical,
  User,
  FileKey,
  UserCog,
  Database,
  UserMinus,
  Clock,
  Loader2,
  X,
  Briefcase
} from 'lucide-react'
import { getInitials, getEffectiveAvatarUrl } from '../../../types/pdm'
import { formatLastOnline } from './utils'
import type { UserRowProps } from './types'

export function UserRow({
  user,
  isAdmin,
  isRealAdmin,
  isCurrentUser,
  onViewProfile,
  onRemove,
  onRemoveFromTeam,
  onVaultAccess,
  onPermissions,
  onViewNetPermissions,
  onSimulatePermissions,
  isSimulating,
  vaultAccessCount,
  compact,
  onEditJobTitle: _onEditJobTitle, // Available for modal-based editing
  jobTitles,
  onToggleJobTitle,
  workflowRoles,
  userWorkflowRoleIds,
  onEditWorkflowRoles: _onEditWorkflowRoles, // Available for modal-based editing
  teams,
  onEditTeams: _onEditTeams, // Available for modal-based editing
  onToggleTeam,
  onToggleWorkflowRole
}: UserRowProps) {
  const [actionDropdownOpen, setActionDropdownOpen] = useState(false)
  const [titleDropdownOpen, setTitleDropdownOpen] = useState(false)
  const [teamsDropdownOpen, setTeamsDropdownOpen] = useState(false)
  const [rolesDropdownOpen, setRolesDropdownOpen] = useState(false)
  const [togglingTitle, setTogglingTitle] = useState(false)
  const [togglingTeam, setTogglingTeam] = useState<string | null>(null)
  const [togglingRole, setTogglingRole] = useState<string | null>(null)
  const [titleSearch, setTitleSearch] = useState('')
  const [teamSearch, setTeamSearch] = useState('')
  const [roleSearch, setRoleSearch] = useState('')
  
  // Admins can manage settings for everyone including themselves
  const canManage = isAdmin
  
  return (
    <div className={`flex items-center gap-3 ${compact ? 'py-2 px-1' : 'p-3'} hover:bg-plm-highlight transition-colors group`}>
      <button
        onClick={onViewProfile}
        className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
      >
        {getEffectiveAvatarUrl(user) ? (
          <img 
            src={getEffectiveAvatarUrl(user) || ''} 
            alt=""
            className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-full object-cover`}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className={`${compact ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'} rounded-full bg-plm-fg-muted/20 flex items-center justify-center font-medium`}>
            {getInitials(user.full_name || user.email)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className={`${compact ? 'text-sm' : 'text-base'} text-plm-fg truncate flex items-center gap-2`}>
            {user.full_name || user.email}
            {isCurrentUser && (
              <span className="text-xs text-plm-fg-dim">(you)</span>
            )}
          </div>
          <div className={`${compact ? 'text-xs' : 'text-sm'} text-plm-fg-muted truncate`}>
            {user.email}
          </div>
          {/* Last online - on its own line */}
          {!compact && formatLastOnline(user.last_online) && (
            <div className="flex items-center gap-1 text-plm-fg-dim text-xs mt-0.5">
              <Clock size={10} />
              {formatLastOnline(user.last_online)}
            </div>
          )}
          {/* Vault access badge */}
          {user.role !== 'admin' && vaultAccessCount > 0 && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-plm-fg-muted/10 rounded text-plm-fg-dim text-[11px] mt-0.5 w-fit">
              <Lock size={10} />
              {vaultAccessCount} vault{vaultAccessCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      </button>
      
      {/* Job title dropdown */}
      {jobTitles && jobTitles.length > 0 && (
        <div className="relative">
          <button
            onClick={() => {
              if (canManage && onToggleJobTitle) {
                setTitleDropdownOpen(!titleDropdownOpen)
                setTeamsDropdownOpen(false)
                setRolesDropdownOpen(false)
              }
            }}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
              user.job_title 
                ? '' 
                : 'bg-plm-fg-muted/10 text-plm-fg-muted border border-dashed border-plm-border'
            } ${canManage && onToggleJobTitle ? 'hover:ring-1 hover:ring-current cursor-pointer' : ''}`}
            style={user.job_title ? { backgroundColor: `${user.job_title.color}15`, color: user.job_title.color } : {}}
            disabled={!canManage || !onToggleJobTitle}
          >
            {user.job_title ? (
              (() => {
                const TitleIcon = (LucideIcons as any)[user.job_title.icon] || Briefcase
                return <TitleIcon size={12} />
              })()
            ) : (
              <Briefcase size={12} />
            )}
            {user.job_title?.name || 'No title'}
            {canManage && onToggleJobTitle && <ChevronDown size={12} />}
          </button>
          
          {titleDropdownOpen && (
            <>
              <div className="fixed inset-0 z-[100]" onClick={() => { setTitleDropdownOpen(false); setTitleSearch('') }} />
              <div className="fixed z-[101] bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[220px] max-h-[350px] flex flex-col"
                style={{
                  top: 'auto',
                  left: 'auto',
                }}
                ref={(el) => {
                  if (el) {
                    const btn = el.previousElementSibling?.previousElementSibling as HTMLElement
                    if (btn) {
                      const rect = btn.getBoundingClientRect()
                      el.style.top = `${rect.bottom + 4}px`
                      el.style.left = `${Math.min(rect.left, window.innerWidth - el.offsetWidth - 8)}px`
                    }
                  }
                }}
              >
                <div className="px-2 py-1.5 border-b border-plm-border">
                  <div className="relative">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
                    <input
                      type="text"
                      placeholder="Search titles..."
                      value={titleSearch}
                      onChange={(e) => setTitleSearch(e.target.value)}
                      className="w-full pl-7 pr-2 py-1 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  {/* No title option */}
                  {(!titleSearch || 'no title'.includes(titleSearch.toLowerCase())) && (
                    <button
                      onClick={async () => {
                        if (!onToggleJobTitle || togglingTitle) return
                        setTogglingTitle(true)
                        await onToggleJobTitle(user, null)
                        setTogglingTitle(false)
                        setTitleDropdownOpen(false)
                        setTitleSearch('')
                      }}
                      disabled={togglingTitle}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-plm-highlight ${
                        !user.job_title ? 'text-plm-fg' : 'text-plm-fg-muted'
                      }`}
                    >
                      <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 bg-plm-fg-muted/20">
                        <X size={12} className="text-plm-fg-muted" />
                      </div>
                      <span className="flex-1 truncate">No title</span>
                      {!user.job_title && <Check size={14} className="text-plm-success flex-shrink-0" />}
                    </button>
                  )}
                  {jobTitles.filter(t => !titleSearch || t.name.toLowerCase().includes(titleSearch.toLowerCase())).map(title => {
                    const TitleIcon = (LucideIcons as any)[title.icon] || Briefcase
                    const isSelected = user.job_title?.id === title.id
                    return (
                      <button
                        key={title.id}
                        onClick={async () => {
                          if (!onToggleJobTitle || togglingTitle) return
                          setTogglingTitle(true)
                          await onToggleJobTitle(user, title.id)
                          setTogglingTitle(false)
                          setTitleDropdownOpen(false)
                          setTitleSearch('')
                        }}
                        disabled={togglingTitle}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-plm-highlight"
                      >
                        <div
                          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${title.color}20`, color: title.color }}
                        >
                          {togglingTitle && isSelected ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <TitleIcon size={12} />
                          )}
                        </div>
                        <span className="flex-1 text-plm-fg truncate">{title.name}</span>
                        {isSelected && <Check size={14} className="text-plm-success flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
      
      {/* Teams and Roles badges - side by side */}
      {!compact && (
        <div className="flex items-center gap-1.5">
          {/* Teams dropdown */}
          {teams && teams.length > 0 && (
            <div className="relative">
              <button
                onClick={() => {
                  if (canManage && onToggleTeam) {
                    setTeamsDropdownOpen(!teamsDropdownOpen)
                    setRolesDropdownOpen(false)
                    setTitleDropdownOpen(false)
                  }
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap transition-colors ${
                  (user.teams || []).length > 0
                    ? 'bg-plm-accent/10 text-plm-accent'
                    : 'bg-yellow-500/10 text-yellow-500 border border-dashed border-yellow-500/30'
                } ${canManage && onToggleTeam ? 'hover:ring-1 hover:ring-current cursor-pointer' : ''}`}
                title={(user.teams || []).map(t => t.name).join(', ') || 'No teams assigned'}
                disabled={!canManage || !onToggleTeam}
              >
                {(user.teams || []).length > 0 ? (
                  <>
                    <Users size={12} />
                    <span>{(user.teams || []).length} team{(user.teams || []).length !== 1 ? 's' : ''}</span>
                  </>
                ) : (
                  <>
                    <UserX size={12} />
                    <span>Unassigned</span>
                  </>
                )}
                {canManage && onToggleTeam && <ChevronDown size={12} />}
              </button>
              
              {teamsDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-[100]" onClick={() => { setTeamsDropdownOpen(false); setTeamSearch('') }} />
                  <div 
                    className="fixed z-[101] bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[220px] max-h-[350px] flex flex-col"
                    ref={(el) => {
                      if (el) {
                        const btn = el.previousElementSibling?.previousElementSibling as HTMLElement
                        if (btn) {
                          const rect = btn.getBoundingClientRect()
                          el.style.top = `${rect.bottom + 4}px`
                          el.style.left = `${Math.min(rect.left, window.innerWidth - el.offsetWidth - 8)}px`
                        }
                      }
                    }}
                  >
                    <div className="px-2 py-1.5 border-b border-plm-border">
                      <div className="relative">
                        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
                        <input
                          type="text"
                          placeholder="Search teams..."
                          value={teamSearch}
                          onChange={(e) => setTeamSearch(e.target.value)}
                          className="w-full pl-7 pr-2 py-1 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {teams.filter(t => !teamSearch || t.name.toLowerCase().includes(teamSearch.toLowerCase())).map(team => {
                        const TeamIcon = (LucideIcons as any)[team.icon] || Users
                        const isInTeam = (user.teams || []).some(t => t.id === team.id)
                        const isToggling = togglingTeam === team.id
                        return (
                          <button
                            key={team.id}
                            onClick={async () => {
                              if (!onToggleTeam || isToggling) return
                              setTogglingTeam(team.id)
                              await onToggleTeam(user, team.id, !isInTeam)
                              setTogglingTeam(null)
                            }}
                            disabled={isToggling}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-plm-highlight"
                          >
                            <div
                              className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: `${team.color}20`, color: team.color }}
                            >
                              {isToggling ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <TeamIcon size={12} />
                              )}
                            </div>
                            <span className="flex-1 text-plm-fg truncate">{team.name}</span>
                            {isInTeam && <Check size={14} className="text-plm-success flex-shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          
          {/* Workflow roles dropdown */}
          {workflowRoles && workflowRoles.length > 0 && (
            <div className="relative">
              <button
                onClick={() => {
                  if (canManage && onToggleWorkflowRole) {
                    setRolesDropdownOpen(!rolesDropdownOpen)
                    setTeamsDropdownOpen(false)
                    setTitleDropdownOpen(false)
                  }
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap transition-colors ${
                  (userWorkflowRoleIds || []).length > 0
                    ? 'bg-purple-500/10 text-purple-400'
                    : 'bg-plm-fg-muted/10 text-plm-fg-muted border border-dashed border-plm-border'
                } ${canManage && onToggleWorkflowRole ? 'hover:ring-1 hover:ring-current cursor-pointer' : ''}`}
                title={(userWorkflowRoleIds || []).map(id => workflowRoles.find(r => r.id === id)?.name).filter(Boolean).join(', ') || 'No roles assigned'}
                disabled={!canManage || !onToggleWorkflowRole}
              >
                <Shield size={12} />
                <span>
                  {(userWorkflowRoleIds || []).length > 0
                    ? `${(userWorkflowRoleIds || []).length} role${(userWorkflowRoleIds || []).length !== 1 ? 's' : ''}`
                    : 'No roles'}
                </span>
                {canManage && onToggleWorkflowRole && <ChevronDown size={12} />}
              </button>
              
              {rolesDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-[100]" onClick={() => { setRolesDropdownOpen(false); setRoleSearch('') }} />
                  <div 
                    className="fixed z-[101] bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[220px] max-h-[350px] flex flex-col"
                    ref={(el) => {
                      if (el) {
                        const btn = el.previousElementSibling?.previousElementSibling as HTMLElement
                        if (btn) {
                          const rect = btn.getBoundingClientRect()
                          el.style.top = `${rect.bottom + 4}px`
                          el.style.left = `${Math.min(rect.left, window.innerWidth - el.offsetWidth - 8)}px`
                        }
                      }
                    }}
                  >
                    <div className="px-2 py-1.5 border-b border-plm-border">
                      <div className="relative">
                        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
                        <input
                          type="text"
                          placeholder="Search roles..."
                          value={roleSearch}
                          onChange={(e) => setRoleSearch(e.target.value)}
                          className="w-full pl-7 pr-2 py-1 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {workflowRoles.filter(r => !roleSearch || r.name.toLowerCase().includes(roleSearch.toLowerCase())).map(role => {
                        const RoleIcon = (LucideIcons as any)[role.icon] || Shield
                        const hasRole = (userWorkflowRoleIds || []).includes(role.id)
                        const isToggling = togglingRole === role.id
                        return (
                          <button
                            key={role.id}
                            onClick={async () => {
                              if (!onToggleWorkflowRole || isToggling) return
                              setTogglingRole(role.id)
                              await onToggleWorkflowRole(user, role.id, !hasRole)
                              setTogglingRole(null)
                            }}
                            disabled={isToggling}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-plm-highlight"
                          >
                            <div
                              className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: `${role.color}20`, color: role.color }}
                            >
                              {isToggling ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <RoleIcon size={12} />
                              )}
                            </div>
                            <span className="flex-1 text-plm-fg truncate">{role.name}</span>
                            {hasRole && <Check size={14} className="text-plm-success flex-shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
      
      {/* Workflow roles dropdown - compact mode (team member rows) */}
      {compact && workflowRoles && workflowRoles.length > 0 && (
        <div className="relative">
          <button
            onClick={() => {
              if (canManage && onToggleWorkflowRole) {
                setRolesDropdownOpen(!rolesDropdownOpen)
              }
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap transition-colors ${
              (userWorkflowRoleIds || []).length > 0
                ? 'bg-purple-500/10 text-purple-400'
                : 'bg-plm-fg-muted/10 text-plm-fg-muted border border-dashed border-plm-border'
            } ${canManage && onToggleWorkflowRole ? 'hover:ring-1 hover:ring-current cursor-pointer' : ''}`}
            title={(userWorkflowRoleIds || []).map(id => workflowRoles.find(r => r.id === id)?.name).filter(Boolean).join(', ') || 'No roles'}
            disabled={!canManage || !onToggleWorkflowRole}
          >
            <Shield size={12} />
            <span>
              {(userWorkflowRoleIds || []).length > 0
                ? `${(userWorkflowRoleIds || []).length} role${(userWorkflowRoleIds || []).length !== 1 ? 's' : ''}`
                : 'No roles'}
            </span>
            {canManage && onToggleWorkflowRole && <ChevronDown size={12} />}
          </button>
          
          {rolesDropdownOpen && (
            <>
              <div className="fixed inset-0 z-[100]" onClick={() => { setRolesDropdownOpen(false); setRoleSearch('') }} />
              <div 
                className="fixed z-[101] bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[220px] max-h-[350px] flex flex-col"
                ref={(el) => {
                  if (el) {
                    const btn = el.previousElementSibling?.previousElementSibling as HTMLElement
                    if (btn) {
                      const rect = btn.getBoundingClientRect()
                      el.style.top = `${rect.bottom + 4}px`
                      el.style.left = `${Math.min(rect.left, window.innerWidth - el.offsetWidth - 8)}px`
                    }
                  }
                }}
              >
                <div className="px-2 py-1.5 border-b border-plm-border">
                  <div className="relative">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
                    <input
                      type="text"
                      placeholder="Search roles..."
                      value={roleSearch}
                      onChange={(e) => setRoleSearch(e.target.value)}
                      className="w-full pl-7 pr-2 py-1 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  {workflowRoles.filter(r => !roleSearch || r.name.toLowerCase().includes(roleSearch.toLowerCase())).map(role => {
                    const RoleIcon = (LucideIcons as any)[role.icon] || Shield
                    const hasRole = (userWorkflowRoleIds || []).includes(role.id)
                    const isToggling = togglingRole === role.id
                    return (
                      <button
                        key={role.id}
                        onClick={async () => {
                          if (!onToggleWorkflowRole || isToggling) return
                          setTogglingRole(role.id)
                          await onToggleWorkflowRole(user, role.id, !hasRole)
                          setTogglingRole(null)
                        }}
                        disabled={isToggling}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-plm-highlight"
                      >
                        <div
                          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${role.color}20`, color: role.color }}
                        >
                          {isToggling ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RoleIcon size={12} />
                          )}
                        </div>
                        <span className="flex-1 text-plm-fg truncate">{role.name}</span>
                        {hasRole && <Check size={14} className="text-plm-success flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
      
      {/* Actions dropdown */}
      {(canManage || isRealAdmin) && (
        <div className="relative">
          <button
            onClick={() => setActionDropdownOpen(!actionDropdownOpen)}
            className="p-1.5 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded transition-colors"
            title="More actions"
          >
            <MoreVertical size={16} />
          </button>
          
          {actionDropdownOpen && (
            <>
              {/* Backdrop to close dropdown */}
              <div 
                className="fixed inset-0 z-[100]" 
                onClick={() => setActionDropdownOpen(false)}
              />
              
              <div 
                className="fixed z-[101] bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[200px]"
                ref={(el) => {
                  if (el) {
                    const btn = el.previousElementSibling?.previousElementSibling as HTMLElement
                    if (btn) {
                      const rect = btn.getBoundingClientRect()
                      const menuHeight = el.offsetHeight
                      const spaceBelow = window.innerHeight - rect.bottom
                      const spaceAbove = rect.top
                      
                      // Position above if not enough space below
                      if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
                        el.style.bottom = `${window.innerHeight - rect.top + 4}px`
                        el.style.top = 'auto'
                      } else {
                        el.style.top = `${rect.bottom + 4}px`
                        el.style.bottom = 'auto'
                      }
                      
                      // Align right edge with button
                      el.style.right = `${window.innerWidth - rect.right}px`
                    }
                  }
                }}
              >
                {/* View Profile */}
                <button
                  onClick={() => {
                    onViewProfile()
                    setActionDropdownOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-plm-fg hover:bg-plm-highlight transition-colors"
                >
                  <User size={14} />
                  View Profile
                </button>
                
                {/* View Net Permissions */}
                {onViewNetPermissions && (
                  <button
                    onClick={() => {
                      onViewNetPermissions()
                      setActionDropdownOpen(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-plm-fg hover:bg-plm-highlight transition-colors"
                  >
                    <FileKey size={14} />
                    View Net Permissions
                  </button>
                )}
                
                {/* Simulate Permissions (impersonate) */}
                {isRealAdmin && !isCurrentUser && onSimulatePermissions && (
                  <button
                    onClick={() => {
                      onSimulatePermissions()
                      setActionDropdownOpen(false)
                    }}
                    disabled={isSimulating}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                      isSimulating
                        ? 'text-cyan-400 bg-cyan-400/10'
                        : 'text-plm-fg hover:bg-plm-highlight'
                    }`}
                  >
                    <UserCog size={14} />
                    {isSimulating ? 'Currently Simulating' : 'Simulate Permissions'}
                  </button>
                )}
                
                {/* Divider */}
                {canManage && <div className="my-1 border-t border-plm-border" />}
                
                {/* Individual permissions */}
                {onPermissions && canManage && (
                  <button
                    onClick={() => {
                      onPermissions()
                      setActionDropdownOpen(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-plm-fg hover:bg-plm-highlight transition-colors"
                  >
                    <Shield size={14} />
                    Individual Permissions
                  </button>
                )}
                
                {/* Individual vault access */}
                {canManage && !compact && (
                  <button
                    onClick={() => {
                      onVaultAccess()
                      setActionDropdownOpen(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-plm-fg hover:bg-plm-highlight transition-colors"
                  >
                    <Database size={14} />
                    Manage Vault Access
                  </button>
                )}
                
                {/* Remove from team */}
                {canManage && onRemoveFromTeam && (
                  <>
                    <div className="my-1 border-t border-plm-border" />
                    <button
                      onClick={() => {
                        onRemoveFromTeam()
                        setActionDropdownOpen(false)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-plm-warning hover:bg-plm-warning/10 transition-colors"
                    >
                      <X size={14} />
                      Remove from Team
                    </button>
                  </>
                )}
                
                {/* Remove from organization */}
                {canManage && !isCurrentUser && (
                  <>
                    {!onRemoveFromTeam && <div className="my-1 border-t border-plm-border" />}
                    <button
                      onClick={() => {
                        onRemove()
                        setActionDropdownOpen(false)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-plm-error hover:bg-plm-error/10 transition-colors"
                    >
                      <UserMinus size={14} />
                      Remove from Organization
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
