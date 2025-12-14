import { useState, useEffect } from 'react'
import { Database, Key, Users, Loader2, Check, Copy, AlertCircle, ChevronRight, ExternalLink, Eye, EyeOff } from 'lucide-react'
import { 
  saveConfig, 
  generateOrgCode, 
  parseOrgCode, 
  validateConfig, 
  type SupabaseConfig 
} from '../lib/supabaseConfig'
import { reconfigureSupabase } from '../lib/supabase'
import { LanguageSelector } from './LanguageSelector'
import { useTranslation } from '../lib/i18n'

interface SetupScreenProps {
  onConfigured: () => void
}

type SetupMode = 'select' | 'admin' | 'member'

// Minimal title bar for window dragging (shown only on setup screen)
function SetupTitleBar() {
  const [appVersion, setAppVersion] = useState('')
  const [platform, setPlatform] = useState<string>('win32')
  const [titleBarPadding, setTitleBarPadding] = useState(140)

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setAppVersion)
      window.electronAPI.getPlatform().then(setPlatform)
      window.electronAPI.getTitleBarOverlayRect?.().then((rect) => {
        if (rect?.width) {
          setTitleBarPadding(rect.width + 8)
        }
      })
    }
  }, [])

  return (
    <div 
      className="h-[38px] bg-plm-activitybar border-b border-plm-border select-none flex-shrink-0 titlebar-drag-region relative"
    >
      {/* Left side - App name (add padding on macOS for window buttons) */}
      <div 
        className="absolute left-0 top-0 h-full flex items-center"
        style={{ paddingLeft: platform === 'darwin' ? 72 : 16 }}
      >
        <div className="flex items-center gap-2 titlebar-no-drag">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-plm-accent">
            <path 
              d="M12 2L2 7L12 12L22 7L12 2Z" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
            <path 
              d="M2 17L12 22L22 17" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
            <path 
              d="M2 12L12 17L22 12" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-sm font-semibold text-plm-fg">BluePLM</span>
          {appVersion && (
            <span className="text-xs text-plm-fg-muted">v{appVersion}</span>
          )}
        </div>
      </div>

      {/* Right side padding for window controls on Windows */}
      <div 
        className="absolute right-0 top-0 h-full"
        style={{ paddingRight: platform === 'darwin' ? 16 : titleBarPadding }}
      />
    </div>
  )
}

export function SetupScreen({ onConfigured }: SetupScreenProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<SetupMode>('select')
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Admin mode state
  const [supabaseUrl, setSupabaseUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [generatedCode, setGeneratedCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  
  // Member mode state
  const [orgCode, setOrgCode] = useState('')
  
  const handleAdminSetup = async () => {
    if (!supabaseUrl.trim() || !anonKey.trim()) {
      setError('Please enter both Supabase URL and Anon Key')
      return
    }
    
    // Basic URL validation
    if (!supabaseUrl.includes('supabase.co') && !supabaseUrl.includes('supabase.in')) {
      setError('Please enter a valid Supabase URL')
      return
    }
    
    setIsValidating(true)
    setError(null)
    
    const config: SupabaseConfig = {
      version: 1,
      url: supabaseUrl.trim(),
      anonKey: anonKey.trim(),
      orgSlug: orgSlug.trim() || undefined
    }
    
    // Validate connection
    const { valid, error: validationError } = await validateConfig(config)
    
    if (!valid) {
      setError(validationError || 'Failed to connect to Supabase')
      setIsValidating(false)
      return
    }
    
    // Save config and reconfigure client
    saveConfig(config)
    reconfigureSupabase(config)
    
    // Generate shareable code
    const code = generateOrgCode(config)
    setGeneratedCode(code)
    setIsValidating(false)
  }
  
  const handleCopyCode = async () => {
    if (!generatedCode) return
    
    try {
      await navigator.clipboard.writeText(generatedCode)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }
  
  const handleMemberSetup = async () => {
    if (!orgCode.trim()) {
      setError('Please enter the Organization Code')
      return
    }
    
    setIsValidating(true)
    setError(null)
    
    // Parse the code
    const config = parseOrgCode(orgCode.trim())
    
    if (!config) {
      setError('Invalid Organization Code. Please check and try again.')
      setIsValidating(false)
      return
    }
    
    // Validate connection
    const { valid, error: validationError } = await validateConfig(config)
    
    if (!valid) {
      setError(validationError || 'Failed to connect to Supabase with provided code')
      setIsValidating(false)
      return
    }
    
    // Save config and reconfigure client
    saveConfig(config)
    reconfigureSupabase(config)
    setIsValidating(false)
    onConfigured()
  }
  
  const handleFinishAdminSetup = () => {
    onConfigured()
  }
  
  // Selection mode - choose admin or member
  if (mode === 'select') {
    return (
      <div className="h-full flex flex-col bg-plm-bg">
        <SetupTitleBar />
        <div className="flex-1 flex items-center justify-center p-8 relative">
          {/* Language selector in corner */}
          <div className="absolute top-4 right-4">
            <LanguageSelector compact dropdownPosition="bottom-right" />
          </div>
          
        <div className="max-w-xl w-full">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
              <Database size={40} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold text-plm-fg mb-2">{t('setup.welcome')}</h1>
            <p className="text-plm-fg-muted">
              {t('setup.connectToBackend')}
            </p>
          </div>
          
          {/* Setup Options */}
          <div className="space-y-4">
            <button
              onClick={() => setMode('admin')}
              className="w-full p-6 bg-plm-bg-light border border-plm-border rounded-xl hover:border-plm-accent transition-colors text-left group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-plm-accent/20 flex items-center justify-center flex-shrink-0">
                  <Key size={24} className="text-plm-accent" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-plm-fg text-lg">{t('setup.imAdmin')}</h3>
                    <ChevronRight size={20} className="text-plm-fg-muted group-hover:text-plm-accent transition-colors" />
                  </div>
                  <p className="text-sm text-plm-fg-muted mt-1">
                    {t('setup.imAdminDesc')}
                  </p>
                </div>
              </div>
            </button>
            
            <button
              onClick={() => setMode('member')}
              className="w-full p-6 bg-plm-bg-light border border-plm-border rounded-xl hover:border-plm-accent transition-colors text-left group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                  <Users size={24} className="text-green-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-plm-fg text-lg">{t('setup.haveCode')}</h3>
                    <ChevronRight size={20} className="text-plm-fg-muted group-hover:text-plm-accent transition-colors" />
                  </div>
                  <p className="text-sm text-plm-fg-muted mt-1">
                    {t('setup.haveCodeDesc')}
                  </p>
                </div>
              </div>
            </button>
          </div>
          
          {/* Help Link */}
          <div className="mt-8 text-center">
            <a 
              href="https://github.com/bluerobotics/bluePLM#setup" 
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-plm-fg-muted hover:text-plm-accent transition-colors"
            >
              {t('setup.needHelp')}
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
        </div>
      </div>
    )
  }
  
  // Admin setup mode
  if (mode === 'admin') {
    // Show success screen with code
    if (generatedCode) {
      return (
        <div className="h-full flex flex-col bg-plm-bg">
          <SetupTitleBar />
          <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-xl w-full">
            <div className="text-center mb-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check size={32} className="text-green-500" />
              </div>
              <h1 className="text-2xl font-bold text-plm-fg mb-2">{t('setup.connectedSuccess')}</h1>
              <p className="text-plm-fg-muted">
                {t('setup.shareCode')}
              </p>
            </div>
            
            {/* Organization Code */}
            <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 mb-6">
              <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
                {t('setup.organizationCode')}
              </label>
              <div className="relative">
                <div className="font-mono text-sm bg-plm-bg border border-plm-border rounded-lg p-4 pr-12 break-all text-plm-fg">
                  {generatedCode}
                </div>
                <button
                  onClick={handleCopyCode}
                  className="absolute top-1/2 right-3 -translate-y-1/2 p-2 hover:bg-plm-highlight rounded transition-colors"
                  title="Copy to clipboard"
                >
                  {codeCopied ? (
                    <Check size={18} className="text-green-500" />
                  ) : (
                    <Copy size={18} className="text-plm-fg-muted" />
                  )}
                </button>
              </div>
              <p className="text-xs text-plm-fg-muted mt-3">
                {t('setup.keepCodeSecure')}
              </p>
            </div>
            
            <button
              onClick={handleFinishAdminSetup}
              className="w-full btn btn-primary btn-lg justify-center"
            >
              {t('setup.continueToBluePLM')}
            </button>
          </div>
          </div>
        </div>
      )
    }
    
    // Admin credential entry form
    return (
      <div className="h-full flex flex-col bg-plm-bg">
        <SetupTitleBar />
        <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-xl w-full">
          <button
            onClick={() => setMode('select')}
            className="mb-6 text-sm text-plm-fg-muted hover:text-plm-fg transition-colors"
          >
            ← {t('common.back')}
          </button>
          
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-plm-accent/20 flex items-center justify-center">
              <Key size={32} className="text-plm-accent" />
            </div>
            <h1 className="text-2xl font-bold text-plm-fg mb-2">{t('setup.adminSetup')}</h1>
            <p className="text-plm-fg-muted">
              {t('setup.enterCredentials')}
            </p>
          </div>
          
          <div className="space-y-4">
            {/* Supabase URL */}
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">
                {t('setup.supabaseUrl')}
              </label>
              <input
                type="url"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://xxxxx.supabase.co"
                className="w-full bg-plm-bg-light border border-plm-border rounded-lg px-4 py-3 text-plm-fg placeholder-plm-fg-dim focus:border-plm-accent focus:outline-none"
              />
            </div>
            
            {/* Anon Key */}
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">
                {t('setup.anonKey')}
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full bg-plm-bg-light border border-plm-border rounded-lg px-4 py-3 pr-12 text-plm-fg placeholder-plm-fg-dim focus:border-plm-accent focus:outline-none font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                >
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            
            {/* Organization Slug (optional) */}
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">
                {t('setup.orgSlug')} <span className="text-plm-fg-dim">({t('common.optional')})</span>
              </label>
              <input
                type="text"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                placeholder="e.g., bluerobotics"
                className="w-full bg-plm-bg-light border border-plm-border rounded-lg px-4 py-3 text-plm-fg placeholder-plm-fg-dim focus:border-plm-accent focus:outline-none"
              />
              <p className="text-xs text-plm-fg-dim mt-1">
                {t('setup.orgSlugHelp')}
              </p>
            </div>
            
            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-red-400">{error}</span>
              </div>
            )}
            
            {/* Submit Button */}
            <button
              onClick={handleAdminSetup}
              disabled={isValidating || !supabaseUrl || !anonKey}
              className="w-full btn btn-primary btn-lg justify-center mt-6"
            >
              {isValidating ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  {t('common.connecting')}
                </>
              ) : (
                <>
                  {t('setup.connectToSupabase')}
                </>
              )}
            </button>
          </div>
          
          {/* Help Text */}
          <p className="text-xs text-plm-fg-dim text-center mt-6">
            {t('setup.findInDashboard')}
          </p>
        </div>
        </div>
      </div>
    )
  }
  
  // Member setup mode
  if (mode === 'member') {
    return (
      <div className="h-full flex flex-col bg-plm-bg">
        <SetupTitleBar />
        <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-xl w-full">
          <button
            onClick={() => setMode('select')}
            className="mb-6 text-sm text-plm-fg-muted hover:text-plm-fg transition-colors"
          >
            ← {t('common.back')}
          </button>
          
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-green-500/20 flex items-center justify-center">
              <Users size={32} className="text-green-500" />
            </div>
            <h1 className="text-2xl font-bold text-plm-fg mb-2">{t('setup.joinOrg')}</h1>
            <p className="text-plm-fg-muted">
              {t('setup.enterCode')}
            </p>
          </div>
          
          <div className="space-y-4">
            {/* Organization Code Input */}
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">
                {t('setup.organizationCode')}
              </label>
              <textarea
                value={orgCode}
                onChange={(e) => setOrgCode(e.target.value)}
                placeholder="PDM-XXXX-XXXX-XXXX..."
                rows={4}
                className="w-full bg-plm-bg-light border border-plm-border rounded-lg px-4 py-3 text-plm-fg placeholder-plm-fg-dim focus:border-plm-accent focus:outline-none font-mono text-sm resize-none"
              />
            </div>
            
            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-red-400">{error}</span>
              </div>
            )}
            
            {/* Submit Button */}
            <button
              onClick={handleMemberSetup}
              disabled={isValidating || !orgCode}
              className="w-full btn btn-primary btn-lg justify-center mt-6"
            >
              {isValidating ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  {t('common.connecting')}
                </>
              ) : (
                <>
                  {t('common.connect')}
                </>
              )}
            </button>
          </div>
        </div>
        </div>
      </div>
    )
  }
  
  return null
}

