// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useEffect, useMemo } from 'react'
import * as LucideIcons from 'lucide-react'
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Shield,
  ChevronRight,
  ChevronDown,
  UserPlus,
  X,
  Check,
  Search,
  MoreVertical,
  Copy,
  Settings2,
  Sparkles,
  Crown,
  LayoutGrid,
  Save,
  RotateCcw
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'
import { getInitials } from '../../types/pdm'
import type { Team, TeamMember, TeamPermission, PermissionPreset } from '../../types/permissions'
import { PermissionsEditor } from './PermissionsEditor'
import { MODULES, MODULE_GROUPS } from '../../types/modules'
import type { OrgModuleDefaults, ModuleId, ModuleGroupId } from '../../types/modules'

// Popular icons for team selection - organized by category
const TEAM_ICONS = [
  // People & Teams
  'Users', 'UsersRound', 'UserCog', 'UserCheck', 'UserPlus', 'User', 'UserCircle',
  'Contact', 'ContactRound', 'PersonStanding', 'Accessibility', 'Baby', 'Handshake',
  
  // Security & Admin
  'Shield', 'ShieldCheck', 'ShieldAlert', 'ShieldQuestion', 'ShieldOff', 'ShieldPlus',
  'Lock', 'LockKeyhole', 'Unlock', 'Key', 'KeyRound', 'Fingerprint', 'ScanFace',
  
  // Status & Achievements
  'Star', 'Crown', 'Award', 'Trophy', 'Medal', 'BadgeCheck', 'Badge', 'Gem',
  'Sparkles', 'Flame', 'Leaf', 'Sun', 'Moon', 'Cloud', 'CloudSun', 'Snowflake',
  
  // Buildings & Places
  'Building', 'Building2', 'Factory', 'Warehouse', 'Store', 'Hotel', 'School',
  'Church', 'Castle', 'Landmark', 'Home', 'House', 'Tent', 'TreePine', 'Trees',
  
  // Work & Business
  'Briefcase', 'BriefcaseBusiness', 'BriefcaseMedical', 'Suitcase', 'Wallet',
  'PiggyBank', 'Banknote', 'CreditCard', 'Receipt', 'HandCoins', 'CircleDollarSign',
  'TrendingUp', 'BarChart', 'BarChart2', 'BarChart3', 'PieChart', 'LineChart',
  
  // Engineering & Tools
  'Wrench', 'Hammer', 'Screwdriver', 'PenTool', 'Paintbrush', 'Palette', 'Ruler',
  'Settings', 'Settings2', 'Cog', 'SlidersHorizontal', 'SlidersVertical', 'Gauge',
  
  // Technology & Code
  'Code', 'Code2', 'Braces', 'Terminal', 'Cpu', 'CircuitBoard', 'Binary',
  'Database', 'Server', 'HardDrive', 'Monitor', 'Laptop', 'Smartphone', 'Tablet',
  'Wifi', 'Bluetooth', 'Radio', 'Antenna', 'Satellite', 'Signal', 'Router',
  
  // Science & Research
  'Microscope', 'Beaker', 'TestTube', 'TestTubes', 'FlaskConical', 'FlaskRound',
  'Atom', 'Dna', 'Pill', 'Syringe', 'Stethoscope', 'HeartPulse', 'Activity',
  'Brain', 'Bone', 'Scan', 'Radiation', 'Magnet', 'Orbit', 'Telescope',
  
  // Documents & Files
  'File', 'FileText', 'FileCheck', 'FileCode', 'FileSpreadsheet', 'FileImage',
  'Folder', 'FolderOpen', 'FolderCog', 'FolderHeart', 'FolderLock', 'FolderSearch',
  'ClipboardList', 'Clipboard', 'ClipboardCheck', 'BookOpen', 'Book', 'Library',
  'Notebook', 'NotebookPen', 'ScrollText', 'FileStack', 'Files', 'Archive',
  
  // Math & Analysis
  'Calculator', 'Hash', 'Percent', 'Sigma', 'Pi', 'Infinity', 'Variable',
  'Target', 'Crosshair', 'Focus', 'Scan', 'ZoomIn', 'Search', 'SearchCode',
  
  // Logistics & Shipping
  'Box', 'Package', 'PackageOpen', 'PackageCheck', 'PackageSearch', 'Boxes',
  'Truck', 'Car', 'Plane', 'Ship', 'Train', 'Bike', 'Bus', 'Forklift',
  'ShoppingCart', 'ShoppingBag', 'ShoppingBasket', 'Store', 'Barcode', 'QrCode',
  'Container', 'Anchor', 'Navigation', 'MapPin', 'Route', 'Milestone',
  
  // Communication
  'Mail', 'MailOpen', 'Send', 'Inbox', 'MessageSquare', 'MessageCircle',
  'MessagesSquare', 'Phone', 'PhoneCall', 'Video', 'Camera', 'Mic', 'Headphones',
  'Bell', 'BellRing', 'Megaphone', 'Radio', 'Podcast', 'Rss', 'Share2',
  
  // Creative & Design
  'Pencil', 'PencilRuler', 'Eraser', 'Highlighter', 'Brush', 'Pipette', 'Crop',
  'Scissors', 'Slice', 'Shapes', 'Square', 'Circle', 'Triangle', 'Hexagon',
  'Pentagon', 'Octagon', 'Diamond', 'Heart', 'Spade', 'Club', 'Layers',
  
  // Nature & Environment
  'Globe', 'Globe2', 'Earth', 'Map', 'Compass', 'Mountain', 'MountainSnow',
  'Waves', 'Droplet', 'Droplets', 'Wind', 'Tornado', 'ThermometerSun', 'Umbrella',
  'Flower', 'Flower2', 'Clover', 'Sprout', 'Shrub', 'Vegan', 'Apple', 'Cherry',
  
  // Energy & Power
  'Zap', 'ZapOff', 'Battery', 'BatteryCharging', 'Plug', 'PlugZap', 'Power',
  'Lightbulb', 'LightbulbOff', 'Flashlight', 'Rocket', 'Fuel', 'Flame', 'Bolt',
  
  // Media & Entertainment
  'Music', 'Music2', 'Music3', 'Music4', 'Disc', 'Disc2', 'Disc3',
  'Play', 'Pause', 'FastForward', 'Rewind', 'Volume2', 'Film', 'Clapperboard',
  'Tv', 'Tv2', 'Gamepad', 'Gamepad2', 'Joystick', 'Dices', 'Puzzle',
  
  // Food & Dining
  'Utensils', 'UtensilsCrossed', 'ChefHat', 'CookingPot', 'Soup', 'Pizza', 'Sandwich',
  'Salad', 'Coffee', 'Wine', 'Beer', 'Milk', 'IceCream', 'Cake', 'Cookie', 'Croissant',
  
  // Sports & Fitness
  'Dumbbell', 'Timer', 'Stopwatch', 'Clock', 'Alarm', 'Watch', 'Footprints',
  'Volleyball', 'Football', 'Dribbble', 'Volleyball', 'Trophy', 'Flag', 'Goal',
  
  // Health & Safety
  'HeartHandshake', 'HeartPulse', 'Stethoscope', 'Thermometer', 'Syringe', 'Pill',
  'Cross', 'CirclePlus', 'ShieldPlus', 'AlertTriangle', 'AlertCircle', 'AlertOctagon',
  'HardHat', 'Construction', 'Cone', 'BadgeAlert', 'CircleAlert', 'OctagonAlert',
  
  // Miscellaneous
  'Gift', 'PartyPopper', 'Candy', 'Balloon', 'Cake', 'Sparkle', 'Wand', 'Wand2',
  'Glasses', 'Sunglasses', 'Watch', 'Hourglass', 'Timer', 'Calendar', 'CalendarDays',
  'Bug', 'Bot', 'Ghost', 'Cat', 'Dog', 'Bird', 'Fish', 'Rabbit', 'Snail', 'Turtle',
  'Aperture', 'Eye', 'EyeOff', 'Scan', 'Fingerprint', 'Hand', 'HandMetal', 'ThumbsUp'
]

// Preset colors for teams
const TEAM_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#64748b', '#78716c'
]

interface TeamWithDetails extends Team {
  member_count: number
  permissions_count: number
  module_defaults: Record<string, unknown> | null  // JSON column from database
}

export function TeamsSettings() {
  const { user, organization, addToast, getEffectiveRole } = usePDMStore()
  
  const isAdmin = getEffectiveRole() === 'admin'
  
  const [teams, setTeams] = useState<TeamWithDetails[]>([])
  const [orgUsers, setOrgUsers] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTeam, setSelectedTeam] = useState<TeamWithDetails | null>(null)
  
  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showMembersDialog, setShowMembersDialog] = useState(false)
  const [showPermissionsEditor, setShowPermissionsEditor] = useState(false)
  const [showModulesDialog, setShowModulesDialog] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
    icon: 'Users',
    is_default: false
  })
  const [isSaving, setIsSaving] = useState(false)
  const [copyFromTeamId, setCopyFromTeamId] = useState<string | null>(null)
  
  // Load teams on mount
  useEffect(() => {
    if (organization) {
      loadTeams()
      loadOrgUsers()
    }
  }, [organization])
  
  const loadTeams = async () => {
    if (!organization) return
    
    setIsLoading(true)
    try {
      // Load teams with member counts
      const { data: teamsData, error } = await supabase
        .from('teams')
        .select(`
          *,
          team_members(count),
          team_permissions(count)
        `)
        .eq('org_id', organization.id)
        .order('name')
      
      if (error) throw error
      
      const teamsWithCounts = (teamsData || []).map(team => ({
        ...team,
        member_count: team.team_members?.[0]?.count || 0,
        permissions_count: team.team_permissions?.[0]?.count || 0
      }))
      
      setTeams(teamsWithCounts)
    } catch (err) {
      console.error('Failed to load teams:', err)
      addToast('error', 'Failed to load teams')
    } finally {
      setIsLoading(false)
    }
  }
  
  const loadOrgUsers = async () => {
    if (!organization) return
    
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, avatar_url, job_title, role')
        .eq('org_id', organization.id)
        .order('full_name')
      
      if (error) throw error
      setOrgUsers(data || [])
    } catch (err) {
      console.error('Failed to load users:', err)
    }
  }
  
  const handleCreateTeam = async () => {
    if (!organization || !user || !formData.name.trim()) return
    
    setIsSaving(true)
    try {
      const { data, error } = await supabase
        .from('teams')
        .insert({
          org_id: organization.id,
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          color: formData.color,
          icon: formData.icon,
          is_default: formData.is_default,
          created_by: user.id
        })
        .select()
        .single()
      
      if (error) throw error
      
      // If copying from an existing team, copy its permissions
      if (copyFromTeamId && data) {
        const { data: sourcePerms, error: permsError } = await supabase
          .from('team_permissions')
          .select('resource, actions')
          .eq('team_id', copyFromTeamId)
        
        if (!permsError && sourcePerms && sourcePerms.length > 0) {
          const newPerms = sourcePerms.map(p => ({
            team_id: data.id,
            resource: p.resource,
            actions: p.actions,
            granted_by: user.id
          }))
          
          await supabase.from('team_permissions').insert(newPerms)
        }
        
        // Optionally copy members too
        const { data: sourceMembers } = await supabase
          .from('team_members')
          .select('user_id')
          .eq('team_id', copyFromTeamId)
        
        if (sourceMembers && sourceMembers.length > 0) {
          const newMembers = sourceMembers.map(m => ({
            team_id: data.id,
            user_id: m.user_id,
            added_by: user.id
          }))
          
          await supabase.from('team_members').insert(newMembers)
        }
        
        const sourceTeam = teams.find(t => t.id === copyFromTeamId)
        addToast('success', `Team "${formData.name}" created (copied from ${sourceTeam?.name})`)
      } else {
        addToast('success', `Team "${formData.name}" created`)
      }
      
      setShowCreateDialog(false)
      resetForm()
      loadTeams()
    } catch (err: any) {
      console.error('Failed to create team:', err)
      if (err.code === '23505') {
        addToast('error', 'A team with this name already exists')
      } else {
        addToast('error', 'Failed to create team')
      }
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleUpdateTeam = async () => {
    if (!selectedTeam || !user || !formData.name.trim()) return
    
    setIsSaving(true)
    try {
      const { error } = await supabase
        .from('teams')
        .update({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          color: formData.color,
          icon: formData.icon,
          is_default: formData.is_default,
          updated_at: new Date().toISOString(),
          updated_by: user.id
        })
        .eq('id', selectedTeam.id)
      
      if (error) throw error
      
      addToast('success', `Team "${formData.name}" updated`)
      setShowEditDialog(false)
      setSelectedTeam(null)
      resetForm()
      loadTeams()
    } catch (err: any) {
      console.error('Failed to update team:', err)
      addToast('error', 'Failed to update team')
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleDeleteTeam = async () => {
    if (!selectedTeam) return
    
    setIsSaving(true)
    try {
      const { error } = await supabase
        .from('teams')
        .delete()
        .eq('id', selectedTeam.id)
      
      if (error) throw error
      
      addToast('success', `Team "${selectedTeam.name}" deleted`)
      setShowDeleteDialog(false)
      setSelectedTeam(null)
      loadTeams()
    } catch (err) {
      console.error('Failed to delete team:', err)
      addToast('error', 'Failed to delete team')
    } finally {
      setIsSaving(false)
    }
  }
  
  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      color: '#3b82f6',
      icon: 'Users',
      is_default: false
    })
    setCopyFromTeamId(null)
  }
  
  const openEditDialog = (team: TeamWithDetails) => {
    setSelectedTeam(team)
    setFormData({
      name: team.name,
      description: team.description || '',
      color: team.color,
      icon: team.icon,
      is_default: team.is_default
    })
    setShowEditDialog(true)
  }
  
  const openDeleteDialog = (team: TeamWithDetails) => {
    setSelectedTeam(team)
    setShowDeleteDialog(true)
  }
  
  const openMembersDialog = (team: TeamWithDetails) => {
    setSelectedTeam(team)
    setShowMembersDialog(true)
  }
  
  const openPermissionsEditor = (team: TeamWithDetails) => {
    setSelectedTeam(team)
    setShowPermissionsEditor(true)
  }
  
  const openModulesDialog = (team: TeamWithDetails) => {
    setSelectedTeam(team)
    setShowModulesDialog(true)
  }
  
  if (!organization) {
    return (
      <div className="text-center py-12 text-plm-fg-muted text-base">
        No organization connected
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-plm-fg flex items-center gap-2">
            <Users size={22} />
            Teams
          </h2>
          <p className="text-sm text-plm-fg-muted mt-1">
            Create teams and assign granular permissions to control access
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => {
              resetForm()
              setShowCreateDialog(true)
            }}
            className="btn btn-primary btn-sm flex items-center gap-2"
          >
            <Plus size={16} />
            Create Team
          </button>
        )}
      </div>

      {/* Teams Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-plm-fg-muted" size={32} />
        </div>
      ) : teams.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-plm-border rounded-xl">
          <Users size={48} className="mx-auto text-plm-fg-muted mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-plm-fg mb-2">No Teams Yet</h3>
          <p className="text-sm text-plm-fg-muted mb-6 max-w-md mx-auto">
            Teams let you group users and assign permissions. Create your first team to get started with granular access control.
          </p>
          {isAdmin && (
            <button
              onClick={() => {
                resetForm()
                setShowCreateDialog(true)
              }}
              className="btn btn-primary flex items-center gap-2 mx-auto"
            >
              <Plus size={16} />
              Create First Team
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map(team => {
            const IconComponent = (LucideIcons as any)[team.icon] || Users
            
            return (
              <div
                key={team.id}
                className="group relative p-4 bg-plm-bg rounded-xl border border-plm-border hover:border-plm-accent/50 transition-all cursor-pointer"
                onClick={() => openPermissionsEditor(team)}
              >
                {/* Team Color Bar */}
                <div
                  className="absolute top-0 left-0 right-0 h-1 rounded-t-xl"
                  style={{ backgroundColor: team.color }}
                />
                
                {/* Header */}
                <div className="flex items-start gap-3 mt-2">
                  <div
                    className="p-2.5 rounded-lg"
                    style={{ backgroundColor: `${team.color}20`, color: team.color }}
                  >
                    <IconComponent size={20} />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-plm-fg truncate">{team.name}</h3>
                      {team.is_default && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-accent/20 text-plm-accent uppercase font-medium">
                          Default
                        </span>
                      )}
                      {team.is_system && (
                        <Crown size={12} className="text-yellow-500" />
                      )}
                    </div>
                    {team.description && (
                      <p className="text-sm text-plm-fg-muted line-clamp-2 mt-0.5">
                        {team.description}
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Stats */}
                <div className="flex items-center gap-4 mt-4 text-sm text-plm-fg-muted">
                  <div className="flex items-center gap-1.5">
                    <Users size={14} />
                    <span>{team.member_count} member{team.member_count !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Shield size={14} />
                    <span>{team.permissions_count} permission{team.permissions_count !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                
                {/* Action Buttons - Always visible */}
                {isAdmin && !team.is_system && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openMembersDialog(team)
                      }}
                      className="flex flex-col items-center gap-1 px-2 py-2.5 text-xs font-medium rounded-lg border border-plm-border text-plm-fg-muted hover:border-blue-400/50 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                    >
                      <UserPlus size={16} />
                      Members
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openPermissionsEditor(team)
                      }}
                      className="flex flex-col items-center gap-1 px-2 py-2.5 text-xs font-medium rounded-lg border border-plm-border text-plm-fg-muted hover:border-purple-400/50 hover:text-purple-400 hover:bg-purple-500/10 transition-all"
                    >
                      <Shield size={16} />
                      Permissions
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openModulesDialog(team)
                      }}
                      className={`flex flex-col items-center gap-1 px-2 py-2.5 text-xs font-medium rounded-lg border transition-all ${
                        team.module_defaults 
                          ? 'border-green-400/50 text-green-400 bg-green-500/10' 
                          : 'border-plm-border text-plm-fg-muted hover:border-green-400/50 hover:text-green-400 hover:bg-green-500/10'
                      }`}
                    >
                      <LayoutGrid size={16} />
                      Modules
                      {team.module_defaults && (
                        <span className="text-[8px] uppercase tracking-wide opacity-75">Configured</span>
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditDialog(team)
                      }}
                      className="flex flex-col items-center gap-1 px-2 py-2.5 text-xs font-medium rounded-lg border border-plm-border text-plm-fg-muted hover:border-plm-accent/50 hover:text-plm-accent hover:bg-plm-accent/10 transition-all"
                    >
                      <Pencil size={16} />
                      Details
                    </button>
                  </div>
                )}
                
                {/* Delete button - top right on hover */}
                {isAdmin && !team.is_system && (
                  <div className="absolute top-4 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openDeleteDialog(team)
                      }}
                      className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded transition-colors"
                      title="Delete team"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create Team Dialog */}
      {showCreateDialog && (
        <TeamFormDialog
          title="Create Team"
          formData={formData}
          setFormData={setFormData}
          onSave={handleCreateTeam}
          onCancel={() => setShowCreateDialog(false)}
          isSaving={isSaving}
          existingTeams={teams}
          copyFromTeamId={copyFromTeamId}
          setCopyFromTeamId={setCopyFromTeamId}
        />
      )}

      {/* Edit Team Dialog */}
      {showEditDialog && selectedTeam && (
        <TeamFormDialog
          title="Edit Team"
          formData={formData}
          setFormData={setFormData}
          onSave={handleUpdateTeam}
          onCancel={() => {
            setShowEditDialog(false)
            setSelectedTeam(null)
          }}
          isSaving={isSaving}
        />
      )}

      {/* Delete Team Dialog */}
      {showDeleteDialog && selectedTeam && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-4">Delete Team</h3>
            <p className="text-base text-plm-fg-muted mb-4">
              Are you sure you want to delete <strong>{selectedTeam.name}</strong>? This will remove all {selectedTeam.member_count} members from the team and delete all associated permissions.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteDialog(false)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleDeleteTeam}
                disabled={isSaving}
                className="btn bg-plm-error text-white hover:bg-plm-error/90"
              >
                {isSaving ? 'Deleting...' : 'Delete Team'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members Dialog */}
      {showMembersDialog && selectedTeam && (
        <TeamMembersDialog
          team={selectedTeam}
          orgUsers={orgUsers}
          onClose={() => {
            setShowMembersDialog(false)
            setSelectedTeam(null)
            loadTeams()
          }}
          userId={user?.id}
        />
      )}

      {/* Permissions Editor */}
      {showPermissionsEditor && selectedTeam && (
        <PermissionsEditor
          team={selectedTeam}
          onClose={() => {
            setShowPermissionsEditor(false)
            setSelectedTeam(null)
            loadTeams()
          }}
          userId={user?.id}
          isAdmin={isAdmin}
        />
      )}

      {/* Team Modules Dialog */}
      {showModulesDialog && selectedTeam && (
        <TeamModulesDialog
          team={selectedTeam}
          onClose={() => {
            setShowModulesDialog(false)
            setSelectedTeam(null)
            loadTeams()
          }}
        />
      )}
    </div>
  )
}

// Team Form Dialog Component
function TeamFormDialog({
  title,
  formData,
  setFormData,
  onSave,
  onCancel,
  isSaving,
  existingTeams,
  copyFromTeamId,
  setCopyFromTeamId
}: {
  title: string
  formData: { name: string; description: string; color: string; icon: string; is_default: boolean }
  setFormData: (data: any) => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
  existingTeams?: TeamWithDetails[]
  copyFromTeamId?: string | null
  setCopyFromTeamId?: (id: string | null) => void
}) {
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [iconSearch, setIconSearch] = useState('')
  const IconComponent = (LucideIcons as any)[formData.icon] || Users
  const isCreating = title === 'Create Team'
  
  // Filter icons based on search
  const filteredIcons = useMemo(() => {
    if (!iconSearch.trim()) return TEAM_ICONS
    const search = iconSearch.toLowerCase()
    return TEAM_ICONS.filter(icon => icon.toLowerCase().includes(search))
  }, [iconSearch])
  
  // When copying from a team, update the form with that team's color/icon as defaults
  const handleCopyFromChange = (teamId: string | null) => {
    if (!setCopyFromTeamId) return
    setCopyFromTeamId(teamId)
    
    if (teamId && existingTeams) {
      const sourceTeam = existingTeams.find(t => t.id === teamId)
      if (sourceTeam) {
        // Optionally pre-fill color and icon from source team
        setFormData({
          ...formData,
          color: sourceTeam.color,
          icon: sourceTeam.icon
        })
      }
    }
  }
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-medium text-plm-fg mb-6">{title}</h3>
        
        <div className="space-y-4">
          {/* Copy from existing team - only show when creating */}
          {isCreating && existingTeams && existingTeams.length > 0 && setCopyFromTeamId && (
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">
                <Copy size={12} className="inline mr-1" />
                Copy from Existing Team
              </label>
              <select
                value={copyFromTeamId || ''}
                onChange={e => handleCopyFromChange(e.target.value || null)}
                className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg focus:outline-none focus:border-plm-accent"
              >
                <option value="">Start fresh (no copy)</option>
                {existingTeams.map(team => {
                  const TeamIcon = (LucideIcons as any)[team.icon] || Users
                  return (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.member_count} members, {team.permissions_count} permissions)
                    </option>
                  )
                })}
              </select>
              {copyFromTeamId && (
                <p className="text-xs text-plm-fg-muted mt-1.5 flex items-center gap-1">
                  <Check size={12} className="text-green-400" />
                  Will copy all members and permissions from this team
                </p>
              )}
            </div>
          )}
          
          {/* Name */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Team Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Engineering, Accounting, Quality"
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
          </div>
          
          {/* Description */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Description</label>
            <textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of this team's purpose..."
              rows={2}
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent resize-none"
            />
          </div>
          
          {/* Color & Icon */}
          <div className="grid grid-cols-2 gap-4">
            {/* Color */}
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Color</label>
              <div className="grid grid-cols-6 gap-1.5 p-2 bg-plm-bg border border-plm-border rounded-lg">
                {TEAM_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setFormData({ ...formData, color })}
                    className={`w-6 h-6 rounded-md transition-all ${
                      formData.color === color ? 'ring-2 ring-plm-fg ring-offset-2 ring-offset-plm-bg scale-110' : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            
            {/* Icon */}
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Icon</label>
              <div className="relative">
                <button
                  onClick={() => setShowIconPicker(!showIconPicker)}
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg flex items-center gap-2 hover:border-plm-accent transition-colors"
                  style={{ color: formData.color }}
                >
                  <IconComponent size={18} />
                  <span className="text-plm-fg text-sm">{formData.icon}</span>
                  <ChevronDown size={14} className="ml-auto text-plm-fg-muted" />
                </button>
                
                {showIconPicker && (
                  <div className="absolute z-50 top-full mt-1 left-0 bg-plm-bg border border-plm-border rounded-lg shadow-xl p-2 w-72">
                    {/* Search input */}
                    <div className="relative mb-2">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
                      <input
                        type="text"
                        value={iconSearch}
                        onChange={e => setIconSearch(e.target.value)}
                        placeholder="Search icons..."
                        className="w-full pl-8 pr-3 py-1.5 text-sm bg-plm-bg-secondary border border-plm-border rounded text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
                        autoFocus
                      />
                    </div>
                    {/* Icons grid */}
                    <div className="max-h-52 overflow-y-auto">
                      <div className="grid grid-cols-8 gap-1">
                        {filteredIcons.map(iconName => {
                          const Icon = (LucideIcons as any)[iconName]
                          if (!Icon) return null
                          return (
                            <button
                              key={iconName}
                              onClick={() => {
                                setFormData({ ...formData, icon: iconName })
                                setShowIconPicker(false)
                                setIconSearch('')
                              }}
                              className={`p-1.5 rounded transition-colors ${
                                formData.icon === iconName
                                  ? 'bg-plm-accent/20 text-plm-accent'
                                  : 'hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg'
                              }`}
                              title={iconName}
                            >
                              <Icon size={16} />
                            </button>
                          )
                        })}
                      </div>
                      {filteredIcons.length === 0 && (
                        <div className="text-center text-sm text-plm-fg-muted py-4">
                          No icons match "{iconSearch}"
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Preview */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Preview</label>
            <div
              className="p-3 bg-plm-bg border border-plm-border rounded-lg flex items-center gap-3"
              style={{ borderTopColor: formData.color, borderTopWidth: '3px' }}
            >
              <div
                className="p-2 rounded-lg"
                style={{ backgroundColor: `${formData.color}20`, color: formData.color }}
              >
                <IconComponent size={20} />
              </div>
              <div>
                <div className="font-medium text-plm-fg">{formData.name || 'Team Name'}</div>
                <div className="text-sm text-plm-fg-muted">
                  {formData.description || 'No description'}
                </div>
              </div>
            </div>
          </div>
          
          {/* Default team toggle */}
          <label className="flex items-center gap-3 p-3 bg-plm-bg border border-plm-border rounded-lg cursor-pointer hover:border-plm-accent/50 transition-colors">
            <input
              type="checkbox"
              checked={formData.is_default}
              onChange={e => setFormData({ ...formData, is_default: e.target.checked })}
              className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
            />
            <div>
              <div className="text-sm text-plm-fg font-medium">Default Team</div>
              <div className="text-xs text-plm-fg-muted">New users will automatically be added to this team</div>
            </div>
          </label>
        </div>
        
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={isSaving || !formData.name.trim()}
            className="btn btn-primary"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
            {title === 'Create Team' ? 'Create Team' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Team Members Dialog Component
function TeamMembersDialog({
  team,
  orgUsers,
  onClose,
  userId
}: {
  team: TeamWithDetails
  orgUsers: any[]
  onClose: () => void
  userId?: string
}) {
  const { addToast } = usePDMStore()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  
  useEffect(() => {
    loadMembers()
  }, [team.id])
  
  const loadMembers = async () => {
    setIsLoading(true)
    try {
      // Use explicit FK relationship syntax for the join
      const { data, error } = await supabase
        .from('team_members')
        .select(`
          id,
          team_id,
          user_id,
          is_team_admin,
          added_at,
          added_by,
          users!user_id (
            id,
            email,
            full_name,
            avatar_url,
            job_title,
            role
          )
        `)
        .eq('team_id', team.id)
        .order('added_at', { ascending: false })
      
      if (error) {
        console.error('Supabase error loading members:', error)
        throw error
      }
      
      // Map the users join to the expected 'user' property
      const mappedData = (data || []).map(m => ({
        ...m,
        user: m.users
      }))
      
      setMembers(mappedData)
    } catch (err) {
      console.error('Failed to load team members:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const memberUserIds = members.map(m => m.user_id)
  const availableUsers = orgUsers.filter(u => !memberUserIds.includes(u.id))
  const filteredUsers = availableUsers.filter(u =>
    u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  const addMember = async (userToAdd: any) => {
    if (!userId) return
    
    setIsAdding(true)
    try {
      const { error } = await supabase
        .from('team_members')
        .insert({
          team_id: team.id,
          user_id: userToAdd.id,
          added_by: userId
        })
      
      if (error) throw error
      
      addToast('success', `Added ${userToAdd.full_name || userToAdd.email} to team`)
      loadMembers()
    } catch (err) {
      console.error('Failed to add member:', err)
      addToast('error', 'Failed to add member')
    } finally {
      setIsAdding(false)
    }
  }
  
  const removeMember = async (member: TeamMember) => {
    try {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', member.id)
      
      if (error) throw error
      
      addToast('success', `Removed ${member.user?.full_name || member.user?.email} from team`)
      loadMembers()
    } catch (err) {
      console.error('Failed to remove member:', err)
      addToast('error', 'Failed to remove member')
    }
  }
  
  const IconComponent = (LucideIcons as any)[team.icon] || Users
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-plm-border flex items-center gap-3">
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: `${team.color}20`, color: team.color }}
          >
            <IconComponent size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-medium text-plm-fg">{team.name} - Members</h3>
            <p className="text-sm text-plm-fg-muted">{members.length} member{members.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="p-2 text-plm-fg-muted hover:text-plm-fg rounded">
            <X size={18} />
          </button>
        </div>
        
        {/* Add member section */}
        <div className="p-4 border-b border-plm-border">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-plm-fg flex items-center gap-2">
              <UserPlus size={14} />
              Add Members
            </h4>
            <span className="text-xs text-plm-fg-muted">
              {availableUsers.length} available
            </span>
          </div>
          
          {/* Search filter */}
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter users..."
              className="w-full pl-9 pr-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
            />
          </div>
          
          {/* Available users list - always visible */}
          {availableUsers.length === 0 ? (
            <div className="text-center py-4 text-sm text-plm-fg-muted bg-plm-bg rounded-lg border border-plm-border">
              All organization members are already in this team
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto bg-plm-bg border border-plm-border rounded-lg">
              {filteredUsers.length === 0 ? (
                <div className="text-center py-4 text-sm text-plm-fg-muted">
                  No users match your search
                </div>
              ) : (
                filteredUsers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => {
                      addMember(u)
                      setSearchQuery('')
                    }}
                    disabled={isAdding}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-plm-highlight transition-colors text-left border-b border-plm-border/50 last:border-b-0"
                  >
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-xs font-medium">
                        {getInitials(u.full_name || u.email)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-plm-fg truncate">{u.full_name || u.email}</div>
                      <div className="text-xs text-plm-fg-muted truncate">{u.email}</div>
                    </div>
                    <div className="flex items-center gap-1 text-plm-accent text-xs font-medium">
                      <Plus size={14} />
                      Add
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        
        {/* Members list */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-plm-fg-muted" size={24} />
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8 text-plm-fg-muted">
              No members in this team yet
            </div>
          ) : (
            <div className="space-y-2">
              {members.map(member => (
                <div
                  key={member.id}
                  className="flex items-center gap-3 p-3 bg-plm-bg rounded-lg group"
                >
                  {member.user?.avatar_url ? (
                    <img src={member.user.avatar_url} alt="" className="w-10 h-10 rounded-full" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-sm font-medium">
                      {getInitials(member.user?.full_name || member.user?.email || '')}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-plm-fg truncate flex items-center gap-2">
                      {member.user?.full_name || member.user?.email}
                      {member.user?.job_title && (
                        <span className="text-xs text-plm-fg-muted">• {member.user.job_title}</span>
                      )}
                    </div>
                    <div className="text-xs text-plm-fg-muted truncate">{member.user?.email}</div>
                  </div>
                  {member.is_team_admin && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-accent/20 text-plm-accent uppercase font-medium">
                      Team Admin
                    </span>
                  )}
                  <button
                    onClick={() => removeMember(member)}
                    className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove from team"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-plm-border flex justify-end">
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// Team Modules Dialog Component
function TeamModulesDialog({
  team,
  onClose
}: {
  team: TeamWithDetails
  onClose: () => void
}) {
  const { addToast, loadTeamModuleDefaults, saveTeamModuleDefaults, clearTeamModuleDefaults, moduleConfig } = usePDMStore()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [teamDefaults, setTeamDefaults] = useState<OrgModuleDefaults | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  
  // Local state for configuring modules
  const [enabledModules, setEnabledModules] = useState<Record<ModuleId, boolean>>({} as Record<ModuleId, boolean>)
  const [enabledGroups, setEnabledGroups] = useState<Record<ModuleGroupId, boolean>>({} as Record<ModuleGroupId, boolean>)
  
  const IconComponent = (LucideIcons as any)[team.icon] || Users
  
  // Load team defaults on mount
  useEffect(() => {
    loadDefaults()
  }, [team.id])
  
  const loadDefaults = async () => {
    setIsLoading(true)
    try {
      const result = await loadTeamModuleDefaults(team.id)
      if (result.success && result.defaults) {
        setTeamDefaults(result.defaults)
        setEnabledModules(result.defaults.enabledModules || {})
        setEnabledGroups(result.defaults.enabledGroups || {})
      } else {
        // No team defaults, initialize with all modules enabled
        const defaultModules: Record<string, boolean> = {}
        const defaultGroups: Record<string, boolean> = {}
        MODULES.forEach(m => { defaultModules[m.id] = m.defaultEnabled })
        MODULE_GROUPS.forEach(g => { defaultGroups[g.id] = g.defaultEnabled })
        setEnabledModules(defaultModules as Record<ModuleId, boolean>)
        setEnabledGroups(defaultGroups as Record<ModuleGroupId, boolean>)
      }
    } catch (err) {
      console.error('Failed to load team defaults:', err)
      addToast('error', 'Failed to load team module defaults')
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleSaveDefaults = async () => {
    setIsSaving(true)
    try {
      // Build config from local state + current user's layout
      const configToSave = {
        ...moduleConfig,
        enabledModules,
        enabledGroups
      }
      
      const result = await saveTeamModuleDefaults(team.id, configToSave)
      if (result.success) {
        addToast('success', `Module defaults saved for ${team.name}`)
        setTeamDefaults({
          enabledModules,
          enabledGroups,
          moduleOrder: moduleConfig.moduleOrder,
          dividers: moduleConfig.dividers,
          moduleParents: moduleConfig.moduleParents,
          moduleIconColors: moduleConfig.moduleIconColors,
          customGroups: moduleConfig.customGroups
        })
        setHasChanges(false)
      } else {
        addToast('error', result.error || 'Failed to save defaults')
      }
    } catch (err) {
      console.error('Failed to save team defaults:', err)
      addToast('error', 'Failed to save team module defaults')
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleClearDefaults = async () => {
    setIsSaving(true)
    try {
      const result = await clearTeamModuleDefaults(team.id)
      if (result.success) {
        addToast('success', `Module defaults cleared for ${team.name}`)
        setTeamDefaults(null)
        // Reset to system defaults
        const defaultModules: Record<string, boolean> = {}
        const defaultGroups: Record<string, boolean> = {}
        MODULES.forEach(m => { defaultModules[m.id] = m.defaultEnabled })
        MODULE_GROUPS.forEach(g => { defaultGroups[g.id] = g.defaultEnabled })
        setEnabledModules(defaultModules as Record<ModuleId, boolean>)
        setEnabledGroups(defaultGroups as Record<ModuleGroupId, boolean>)
        setHasChanges(false)
      } else {
        addToast('error', result.error || 'Failed to clear defaults')
      }
    } catch (err) {
      console.error('Failed to clear team defaults:', err)
      addToast('error', 'Failed to clear team module defaults')
    } finally {
      setIsSaving(false)
    }
  }
  
  const toggleModule = (moduleId: ModuleId) => {
    setEnabledModules(prev => {
      const newState = { ...prev, [moduleId]: !prev[moduleId] }
      setHasChanges(true)
      return newState
    })
  }
  
  const toggleGroup = (groupId: ModuleGroupId) => {
    setEnabledGroups(prev => {
      const newState = { ...prev, [groupId]: !prev[groupId] }
      setHasChanges(true)
      return newState
    })
  }
  
  const enabledCount = Object.values(enabledModules).filter(Boolean).length
  const totalCount = MODULES.length
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div 
        className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col" 
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-plm-border flex items-center gap-3">
          <div
            className="p-2.5 rounded-lg"
            style={{ backgroundColor: `${team.color}20`, color: team.color }}
          >
            <IconComponent size={22} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-medium text-plm-fg flex items-center gap-2">
              {team.name} - Module Defaults
            </h3>
            <p className="text-sm text-plm-fg-muted">
              Configure which modules are enabled by default for team members
            </p>
          </div>
          {teamDefaults && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-green-500/20 text-green-400 font-medium uppercase">
              Has Custom Defaults
            </span>
          )}
          <button onClick={onClose} className="p-2 text-plm-fg-muted hover:text-plm-fg rounded">
            <X size={18} />
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-plm-fg-muted" size={32} />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary */}
              <div className="flex items-center justify-between p-3 bg-plm-bg rounded-lg border border-plm-border">
                <div className="text-sm text-plm-fg">
                  <span className="font-medium">{enabledCount}</span> of <span className="font-medium">{totalCount}</span> modules enabled
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const all: Record<string, boolean> = {}
                      MODULES.forEach(m => { all[m.id] = true })
                      setEnabledModules(all as Record<ModuleId, boolean>)
                      setHasChanges(true)
                    }}
                    className="text-xs px-2 py-1 rounded border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors"
                  >
                    Enable All
                  </button>
                  <button
                    onClick={() => {
                      const minimal: Record<string, boolean> = {}
                      MODULES.forEach(m => { minimal[m.id] = m.required || false })
                      setEnabledModules(minimal as Record<ModuleId, boolean>)
                      setHasChanges(true)
                    }}
                    className="text-xs px-2 py-1 rounded border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors"
                  >
                    Minimal
                  </button>
                </div>
              </div>
              
              {/* Module Groups */}
              {MODULE_GROUPS.filter(g => !g.parentGroup).map(group => {
                const groupModules = MODULES.filter(m => m.group === group.id || 
                  MODULE_GROUPS.find(sg => sg.id === m.group && sg.parentGroup === group.id))
                const enabledInGroup = groupModules.filter(m => enabledModules[m.id]).length
                const isGroupEnabled = enabledGroups[group.id] ?? group.defaultEnabled
                
                return (
                  <div key={group.id} className="border border-plm-border rounded-lg overflow-hidden">
                    {/* Group Header */}
                    <div 
                      className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                        isGroupEnabled ? 'bg-plm-accent/10' : 'bg-plm-bg-secondary'
                      }`}
                      onClick={() => group.isMasterToggle && toggleGroup(group.id)}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-plm-fg">{group.name}</span>
                          <span className="text-xs text-plm-fg-muted">
                            {enabledInGroup}/{groupModules.length} enabled
                          </span>
                        </div>
                        <p className="text-xs text-plm-fg-muted mt-0.5">{group.description}</p>
                      </div>
                      {group.isMasterToggle && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleGroup(group.id)
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                            isGroupEnabled
                              ? 'bg-plm-success/20 text-plm-success border border-plm-success/30'
                              : 'bg-plm-bg border border-plm-border text-plm-fg-muted'
                          }`}
                        >
                          {isGroupEnabled ? 'Enabled' : 'Disabled'}
                        </button>
                      )}
                    </div>
                    
                    {/* Modules in Group */}
                    {isGroupEnabled && (
                      <div className="p-2 bg-plm-bg space-y-1">
                        {groupModules.map(module => {
                          const isEnabled = enabledModules[module.id] ?? module.defaultEnabled
                          const ModuleIcon = (LucideIcons as any)[module.icon]
                          
                          return (
                            <div
                              key={module.id}
                              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                                isEnabled ? 'bg-plm-success/5' : 'bg-transparent'
                              }`}
                            >
                              <div className={`p-1.5 rounded ${isEnabled ? 'text-plm-success' : 'text-plm-fg-muted'}`}>
                                {ModuleIcon ? <ModuleIcon size={16} /> : <LayoutGrid size={16} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className={`text-sm ${isEnabled ? 'text-plm-fg' : 'text-plm-fg-muted'}`}>
                                  {module.name}
                                </span>
                                {!module.implemented && (
                                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">
                                    Coming Soon
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => toggleModule(module.id)}
                                disabled={module.required}
                                className={`w-10 h-5 rounded-full transition-all relative ${
                                  isEnabled ? 'bg-plm-success' : 'bg-plm-bg-secondary'
                                } ${module.required ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                title={module.required ? 'Required module' : undefined}
                              >
                                <div 
                                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                                    isEnabled ? 'left-5' : 'left-0.5'
                                  }`} 
                                />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              
              {/* Info */}
              <div className="p-3 bg-plm-accent/5 border border-plm-accent/20 rounded-lg">
                <p className="text-xs text-plm-fg-muted">
                  <strong className="text-plm-fg">Note:</strong> These defaults apply to team members who haven't customized their own module settings. 
                  The sidebar order from your current configuration will also be saved.
                </p>
              </div>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-plm-border flex items-center justify-between">
          <div>
            {teamDefaults && (
              <button
                onClick={handleClearDefaults}
                disabled={isSaving}
                className="flex items-center gap-2 px-3 py-2 text-sm text-plm-error hover:bg-plm-error/10 rounded-lg transition-colors"
              >
                <RotateCcw size={14} />
                Clear Team Defaults
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button
              onClick={handleSaveDefaults}
              disabled={isSaving}
              className="btn btn-primary flex items-center gap-2"
            >
              {isSaving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save Team Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

