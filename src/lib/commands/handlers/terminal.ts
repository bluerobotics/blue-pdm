/**
 * Terminal Command Handlers
 * 
 * Commands: echo, clear, cls, help, history, cancel, settings, set, get
 */

import { usePDMStore } from '../../../stores/pdmStore'
import { getCommandHistory, cancelAllOperations, hasActiveOperations, getActiveOperations, getAllCommands } from '../executor'
import { registerTerminalCommand, getTerminalCommandMeta } from '../registry'
import type { ParsedCommand, TerminalOutput } from '../parser'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/**
 * Handle echo command - output text
 */
export function handleEcho(parsed: ParsedCommand, addOutput: OutputFn): void {
  const text = parsed.args.join(' ')
  addOutput('info', text)
}

/**
 * Handle history command - show command history
 */
export function handleHistory(addOutput: OutputFn): void {
  const history = getCommandHistory()
  if (history.length === 0) {
    addOutput('info', 'No command history')
  } else {
    const lines = history.slice(0, 10).map((entry, i) => 
      `${i + 1}. ${entry.commandId} - ${entry.result.message} (${formatTimeAgo(entry.timestamp)})`
    )
    addOutput('info', lines.join('\n'))
  }
}

/**
 * Handle cancel/stop/abort command - cancel running operations
 */
export function handleCancel(addOutput: OutputFn): void {
  if (!hasActiveOperations()) {
    addOutput('info', 'No operations running')
  } else {
    const ops = getActiveOperations()
    const count = cancelAllOperations()
    addOutput('info', `⚠️ Cancelling ${count} operation${count > 1 ? 's' : ''}:`)
    ops.forEach(op => addOutput('info', `  • ${op.description}`))
  }
}

/**
 * Handle settings command - show all settings
 */
export function handleSettings(addOutput: OutputFn): void {
  const state = usePDMStore.getState()
  
  const lines = [
    '⚙️ Settings:',
    '',
    '📐 Display:',
    `   viewMode: ${state.viewMode}`,
    `   iconSize: ${state.iconSize}`,
    `   listRowSize: ${state.listRowSize}`,
    `   lowercaseExtensions: ${state.lowercaseExtensions}`,
    `   cadPreviewMode: ${state.cadPreviewMode}`,
    '',
    '🎨 Theme & Appearance:',
    `   theme: ${state.theme}`,
    `   language: ${state.language}`,
    `   autoApplySeasonalThemes: ${state.autoApplySeasonalThemes}`,
    `   activityBarMode: ${state.activityBarMode}`,
    '',
    '📐 Layout:',
    `   sidebarWidth: ${state.sidebarWidth}`,
    `   detailsPanelHeight: ${state.detailsPanelHeight}`,
    `   rightPanelWidth: ${state.rightPanelWidth}`,
    `   terminalHeight: ${state.terminalHeight}`,
    `   tabsEnabled: ${state.tabsEnabled}`,
    `   sortColumn: ${state.sortColumn}`,
    `   sortDirection: ${state.sortDirection}`,
    '',
    '🔧 SolidWorks:',
    `   solidworksIntegrationEnabled: ${state.solidworksIntegrationEnabled}`,
    `   autoStartSolidworksService: ${state.autoStartSolidworksService}`,
    `   hideSolidworksTempFiles: ${state.hideSolidworksTempFiles}`,
    `   ignoreSolidworksTempFiles: ${state.ignoreSolidworksTempFiles}`,
    '',
    '☁️ Auto-Download:',
    `   autoDownloadCloudFiles: ${state.autoDownloadCloudFiles}`,
    `   autoDownloadUpdates: ${state.autoDownloadUpdates}`,
    `   autoConnect: ${state.autoConnect}`,
    '',
    '📝 Logging:',
    `   logSharingEnabled: ${state.logSharingEnabled}`,
    '',
    '🎄 Christmas Theme:',
    `   christmasSnowOpacity: ${state.christmasSnowOpacity}`,
    `   christmasSnowDensity: ${state.christmasSnowDensity}`,
    `   christmasSnowSize: ${state.christmasSnowSize}`,
    `   christmasBlusteryness: ${state.christmasBlusteryness}`,
    `   christmasUseLocalWeather: ${state.christmasUseLocalWeather}`,
    `   christmasSleighEnabled: ${state.christmasSleighEnabled}`,
    `   christmasSleighDirection: ${state.christmasSleighDirection}`,
    '',
    '🎃 Halloween Theme:',
    `   halloweenSparksEnabled: ${state.halloweenSparksEnabled}`,
    `   halloweenSparksOpacity: ${state.halloweenSparksOpacity}`,
    `   halloweenSparksSpeed: ${state.halloweenSparksSpeed}`,
    `   halloweenGhostsOpacity: ${state.halloweenGhostsOpacity}`,
    '',
    '🌧️ Weather Theme:',
    `   weatherEffectsEnabled: ${state.weatherEffectsEnabled}`,
    `   weatherRainOpacity: ${state.weatherRainOpacity}`,
    `   weatherRainDensity: ${state.weatherRainDensity}`,
    `   weatherSnowOpacity: ${state.weatherSnowOpacity}`,
    `   weatherSnowDensity: ${state.weatherSnowDensity}`,
    '',
    'Use: set <setting> <value>'
  ]
  addOutput('info', lines.join('\n'))
}

/**
 * Handle set command - change a setting
 */
export function handleSet(parsed: ParsedCommand, addOutput: OutputFn): void {
  const setting = parsed.args[0]
  const value = parsed.args[1]
  
  if (!setting || value === undefined) {
    addOutput('error', 'Usage: set <setting> <value>')
    return
  }
  
  const store = usePDMStore.getState()
  
  switch (setting) {
    // Display settings
    case 'cadPreviewMode':
      if (value !== 'thumbnail' && value !== 'edrawings') {
        addOutput('error', 'Value must be "thumbnail" or "edrawings"')
        return
      }
      store.setCadPreviewMode(value)
      break
    case 'lowercaseExtensions':
      store.setLowercaseExtensions(value === 'true')
      break
    case 'viewMode':
      if (value !== 'list' && value !== 'icons') {
        addOutput('error', 'Value must be "list" or "icons"')
        return
      }
      store.setViewMode(value)
      break
    case 'iconSize':
      store.setIconSize(parseInt(value) || 96)
      break
    case 'listRowSize':
      store.setListRowSize(parseInt(value) || 24)
      break
      
    // Theme & Appearance
    case 'theme':
      const validThemes = ['dark', 'deep-blue', 'light', 'christmas', 'halloween', 'weather', 'kenneth', 'system']
      if (!validThemes.includes(value)) {
        addOutput('error', `Value must be one of: ${validThemes.join(', ')}`)
        return
      }
      store.setTheme(value as any)
      break
    case 'language':
      const validLangs = ['en', 'fr', 'de', 'es', 'it', 'pt', 'ja', 'zh-CN', 'zh-TW', 'ko', 'nl', 'sv', 'pl', 'ru', 'sindarin']
      if (!validLangs.includes(value)) {
        addOutput('error', `Value must be one of: ${validLangs.join(', ')}`)
        return
      }
      store.setLanguage(value as any)
      break
    case 'autoApplySeasonalThemes':
      store.setAutoApplySeasonalThemes(value === 'true')
      break
    case 'activityBarMode':
      if (value !== 'expanded' && value !== 'collapsed' && value !== 'hover') {
        addOutput('error', 'Value must be "expanded", "collapsed", or "hover"')
        return
      }
      store.setActivityBarMode(value as any)
      break
      
    // Layout settings
    case 'sidebarWidth':
      store.setSidebarWidth(parseInt(value) || 280)
      break
    case 'detailsPanelHeight':
      store.setDetailsPanelHeight(parseInt(value) || 250)
      break
    case 'rightPanelWidth':
      store.setRightPanelWidth(parseInt(value) || 300)
      break
    case 'terminalHeight':
      store.setTerminalHeight(parseInt(value) || 250)
      break
    case 'tabsEnabled':
      store.setTabsEnabled(value === 'true')
      break
    case 'sortColumn':
      store.setSortColumn(value)
      break
    case 'sortDirection':
      if (value !== 'asc' && value !== 'desc') {
        addOutput('error', 'Value must be "asc" or "desc"')
        return
      }
      store.setSortDirection(value)
      break
      
    // SolidWorks settings
    case 'solidworksIntegrationEnabled':
      store.setSolidworksIntegrationEnabled(value === 'true')
      break
    case 'autoStartSolidworksService':
      store.setAutoStartSolidworksService(value === 'true')
      break
    case 'hideSolidworksTempFiles':
      store.setHideSolidworksTempFiles(value === 'true')
      break
    case 'ignoreSolidworksTempFiles':
      store.setIgnoreSolidworksTempFiles(value === 'true')
      break
    case 'solidworksPath':
      store.setSolidworksPath(value === 'null' ? null : value)
      break
      
    // Auto-Download settings
    case 'autoDownloadCloudFiles':
      store.setAutoDownloadCloudFiles(value === 'true')
      break
    case 'autoDownloadUpdates':
      store.setAutoDownloadUpdates(value === 'true')
      break
    case 'autoConnect':
      store.setAutoConnect(value === 'true')
      break
      
    // Logging
    case 'logSharingEnabled':
      store.setLogSharingEnabled(value === 'true')
      break
      
    // Christmas Theme settings
    case 'christmasSnowOpacity':
      store.setChristmasSnowOpacity(parseFloat(value) || 0.8)
      break
    case 'christmasSnowDensity':
      store.setChristmasSnowDensity(parseFloat(value) || 0.5)
      break
    case 'christmasSnowSize':
      store.setChristmasSnowSize(parseFloat(value) || 1)
      break
    case 'christmasBlusteryness':
      store.setChristmasBlusteryness(parseFloat(value) || 0.3)
      break
    case 'christmasUseLocalWeather':
      store.setChristmasUseLocalWeather(value === 'true')
      break
    case 'christmasSleighEnabled':
      store.setChristmasSleighEnabled(value === 'true')
      break
    case 'christmasSleighDirection':
      if (value !== 'push' && value !== 'pull') {
        addOutput('error', 'Value must be "push" or "pull"')
        return
      }
      store.setChristmasSleighDirection(value)
      break
      
    // Halloween Theme settings
    case 'halloweenSparksEnabled':
      store.setHalloweenSparksEnabled(value === 'true')
      break
    case 'halloweenSparksOpacity':
      store.setHalloweenSparksOpacity(parseFloat(value) || 0.6)
      break
    case 'halloweenSparksSpeed':
      store.setHalloweenSparksSpeed(parseFloat(value) || 1)
      break
    case 'halloweenGhostsOpacity':
      store.setHalloweenGhostsOpacity(parseFloat(value) || 0.4)
      break
      
    // Weather Theme settings
    case 'weatherEffectsEnabled':
      store.setWeatherEffectsEnabled(value === 'true')
      break
    case 'weatherRainOpacity':
      store.setWeatherRainOpacity(parseFloat(value) || 0.6)
      break
    case 'weatherRainDensity':
      store.setWeatherRainDensity(parseFloat(value) || 0.5)
      break
    case 'weatherSnowOpacity':
      store.setWeatherSnowOpacity(parseFloat(value) || 0.8)
      break
    case 'weatherSnowDensity':
      store.setWeatherSnowDensity(parseFloat(value) || 0.5)
      break
      
    default:
      addOutput('error', `Unknown setting: ${setting}. Type 'settings' to see all available settings.`)
      return
  }
  
  addOutput('success', `Set ${setting} = ${value}`)
}

/**
 * Handle get command - get a setting value
 */
export function handleGet(parsed: ParsedCommand, addOutput: OutputFn): void {
  const setting = parsed.args[0]
  if (!setting) {
    addOutput('error', 'Usage: get <setting>')
    return
  }
  
  const store = usePDMStore.getState()
  const value = (store as any)[setting]
  
  if (value === undefined) {
    addOutput('error', `Unknown setting: ${setting}`)
  } else {
    addOutput('info', `${setting} = ${JSON.stringify(value)}`)
  }
}

/**
 * Handle help command - format help text
 */
export function handleHelp(command: string | undefined, addOutput: OutputFn): void {
  addOutput('info', formatHelp(command))
}

/**
 * Format help text using the command registry
 */
function formatHelp(command?: string): string {
  if (command) {
    // First try the registry
    const meta = getTerminalCommandMeta(command)
    if (meta) {
      const lines = [
        `📖 ${meta.aliases[0].toUpperCase()}`,
        `   ${meta.description}`
      ]
      if (meta.usage) lines.push(`   Usage: ${meta.usage}`)
      if (meta.examples?.length) {
        lines.push(`   Examples:`)
        meta.examples.forEach(ex => lines.push(`     ${ex}`))
      }
      if (meta.aliases.length > 1) {
        lines.push(`   Aliases: ${meta.aliases.join(', ')}`)
      }
      return lines.join('\n')
    }
    
    // Fall back to executor commands
    const commands = getAllCommands()
    const cmd = commands.find(c => c.id === command || c.aliases?.includes(command))
    if (cmd) {
      return [
        `📖 ${cmd.name}`,
        `   ${cmd.description}`,
        cmd.usage ? `   Usage: ${cmd.usage}` : '',
        cmd.aliases?.length ? `   Aliases: ${cmd.aliases.join(', ')}` : ''
      ].filter(Boolean).join('\n')
    }
    return `Unknown command: ${command}`
  }
  
  // Return static help text for now - registry is used for command-specific help above
  // The static text is comprehensive and well-organized
  return `
📖 BluePLM Terminal Commands

PDM Operations:
  checkout <path>      Check out files (alias: co)
  checkin <path>       Check in files (alias: ci)
  sync <path>          Upload new files (alias: upload, add)
  download <path>      Download cloud files (alias: dl)
  get-latest <path>    Update outdated files (alias: gl, update)
  discard <path>       Discard changes, revert to server
  delete <path>        Delete from server (alias: rm)
  remove <path>        Remove local copy (alias: rm-local)
  force-release <path> Force release checkout (admin)

SolidWorks Operations:
  sync-sw-metadata <p> Sync SW properties to server (alias: sw-sync)

Batch Operations:
  sync-all             Sync all unsynced files
  checkin-all          Check in all my checkouts
  checkout-all <path>  Check out all files in folder
  pending              Show pending operations

File Management:
  mkdir <name>         Create folder (alias: md)
  rename <path> <new>  Rename file/folder (alias: ren)
  move <src> <dest>    Move files (alias: mv)
  copy <src> <dest>    Copy files (alias: cp)
  touch <name>         Create empty file

Text File Operations:
  cat <path>           Display file contents (alias: type)
  head <path> [-n N]   Show first N lines (default 10)
  tail <path> [-n N]   Show last N lines (default 10)
  wc <path>            Word/line/character count
  diff <file1> <file2> Compare two text files
  write <path> <text>  Write text to file (use \\n for newlines)
  append <path> <text> Append text to file
  grep-content <p> [d] Search text in files (alias: rg, fgrep) [-i]
  sed <f> <find> <rep> Find/replace in file (--all for all)

JSON Operations:
  json <path>          Pretty-print JSON file
  json-get <path> [k]  Get value by key path (alias: jq)
  json-set <p> <k> <v> Set value in JSON file

Version Control:
  versions <path>      Show version history
  rollback <path> <v>  Roll back to version (must be checked out)
  activity [-n N]      Show recent activity

Trash:
  trash                List deleted files
  restore <path>       Restore from trash
  empty-trash          Permanently delete all trash (admin)

Navigation:
  ls [path]            List files (alias: dir)
  cd <path>            Change directory
  pwd                  Print current directory
  tree [path]          Show directory tree (--depth=N)

Search & Select:
  find <query>         Search files (alias: search)
  select <pattern>     Select files (--add to append)
  select all/clear     Select all or clear

Info & Metadata:
  status [path]        Show file/vault status
  info <path>          Show file properties
  metadata <path>      Show file metadata
  set-metadata <path>  Set metadata (--part, --desc, --rev)
  set-state <path> <s> Set state (wip/in_review/released/obsolete)
  checkouts            List checked out files (--mine, --others)
  whoami               Show current user

Vault Management:
  vault                Show connected vaults
  switch-vault <name>  Switch active vault (alias: use)
  disconnect-vault     Disconnect a vault

Backup:
  backup               Request backup
  backup-status        Show backup status
  backup-history       List backup snapshots

Settings:
  settings             Show all settings
  set <key> <value>    Change a setting
  get <key>            Get a setting value

Logs:
  logs [-n N]          Show recent logs
  export-logs          Export logs to file
  logs-dir             Open logs directory

Members & Teams:
  members              List organization members
  invite <email>       Invite user (--name, --role, --team)
  remove-member <email> Remove member from org
  user-info <email>    Show user details
  pending              List pending invites
  teams                List all teams
  create-team <name>   Create team (--color, --icon, --desc)
  delete-team <name>   Delete a team
  add-to-team <e> <t>  Add user to team
  remove-from-team     Remove user from team
  team-info <name>     Show team details

Roles & Permissions:
  roles                List workflow roles
  create-role <name>   Create role (--color, --icon, --desc)
  delete-role <name>   Delete a role
  assign-role <e> <r>  Assign role to user
  unassign-role <e> <r> Remove role from user
  titles               List job titles
  create-title <name>  Create job title
  set-title <e> <t>    Set user's job title
  permissions <team>   View team permissions
  grant <t> <r> <a>    Grant permission (team, resource, action)
  revoke <t> <r> [a]   Revoke permission

Auth:
  sign-out             Sign out (alias: logout)
  offline [on/off]     Toggle offline mode
  reload-app           Force full app reload (alias: restart)

Utilities:
  open <path>          Open with default app
  reveal <path>        Show in Explorer
  pin/unpin <path>     Pin/unpin to sidebar
  ignore [pattern]     Add/show ignore patterns
  refresh              Refresh file list
  cancel               Cancel operations
  history              Command history
  clear                Clear terminal
  env                  Environment info
  help [cmd]           Show this help
`.trim()
}

/**
 * Format time ago
 */
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// ============================================
// Self-registration
// ============================================

registerTerminalCommand({
  aliases: ['echo'],
  description: 'Output text to terminal',
  usage: 'echo <text>',
  category: 'terminal'
}, (parsed, _files, addOutput) => {
  handleEcho(parsed, addOutput)
})

registerTerminalCommand({
  aliases: ['history', 'h'],
  description: 'Show command history',
  category: 'terminal'
}, (_parsed, _files, addOutput) => {
  handleHistory(addOutput)
})

registerTerminalCommand({
  aliases: ['cancel', 'stop', 'abort'],
  description: 'Cancel running operations',
  category: 'terminal'
}, (_parsed, _files, addOutput) => {
  handleCancel(addOutput)
})

registerTerminalCommand({
  aliases: ['settings'],
  description: 'Show all settings',
  category: 'terminal'
}, (_parsed, _files, addOutput) => {
  handleSettings(addOutput)
})

registerTerminalCommand({
  aliases: ['set'],
  description: 'Change a setting',
  usage: 'set <setting> <value>',
  examples: ['set theme dark', 'set viewMode icons'],
  category: 'terminal'
}, (parsed, _files, addOutput) => {
  handleSet(parsed, addOutput)
})

registerTerminalCommand({
  aliases: ['get'],
  description: 'Get a setting value',
  usage: 'get <setting>',
  category: 'terminal'
}, (parsed, _files, addOutput) => {
  handleGet(parsed, addOutput)
})

registerTerminalCommand({
  aliases: ['help', '?'],
  description: 'Show help for commands',
  usage: 'help [command]',
  examples: ['help', 'help checkout'],
  category: 'terminal'
}, (parsed, _files, addOutput) => {
  handleHelp(parsed.args[0], addOutput)
})
