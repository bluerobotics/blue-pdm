import { useState } from 'react'
import { Database, Key, Users, Loader2, Check, Copy, AlertCircle, ChevronRight, ExternalLink, Eye, EyeOff } from 'lucide-react'
import { 
  saveConfig, 
  generateOrgCode, 
  parseOrgCode, 
  validateConfig, 
  type SupabaseConfig 
} from '../lib/supabaseConfig'
import { reconfigureSupabase } from '../lib/supabase'

interface SetupScreenProps {
  onConfigured: () => void
}

type SetupMode = 'select' | 'admin' | 'member'

export function SetupScreen({ onConfigured }: SetupScreenProps) {
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
      <div className="flex-1 flex items-center justify-center bg-pdm-bg p-8">
        <div className="max-w-xl w-full">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
              <Database size={40} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold text-pdm-fg mb-2">Welcome to BluePDM</h1>
            <p className="text-pdm-fg-muted">
              Connect to your organization's Supabase backend to get started
            </p>
          </div>
          
          {/* Setup Options */}
          <div className="space-y-4">
            <button
              onClick={() => setMode('admin')}
              className="w-full p-6 bg-pdm-bg-light border border-pdm-border rounded-xl hover:border-pdm-accent transition-colors text-left group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-pdm-accent/20 flex items-center justify-center flex-shrink-0">
                  <Key size={24} className="text-pdm-accent" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-pdm-fg text-lg">I'm an Organization Admin</h3>
                    <ChevronRight size={20} className="text-pdm-fg-muted group-hover:text-pdm-accent transition-colors" />
                  </div>
                  <p className="text-sm text-pdm-fg-muted mt-1">
                    Set up BluePDM with your organization's Supabase credentials. 
                    You'll get a code to share with your team.
                  </p>
                </div>
              </div>
            </button>
            
            <button
              onClick={() => setMode('member')}
              className="w-full p-6 bg-pdm-bg-light border border-pdm-border rounded-xl hover:border-pdm-accent transition-colors text-left group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                  <Users size={24} className="text-green-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-pdm-fg text-lg">I have an Organization Code</h3>
                    <ChevronRight size={20} className="text-pdm-fg-muted group-hover:text-pdm-accent transition-colors" />
                  </div>
                  <p className="text-sm text-pdm-fg-muted mt-1">
                    Enter the code provided by your organization admin to connect.
                  </p>
                </div>
              </div>
            </button>
          </div>
          
          {/* Help Link */}
          <div className="mt-8 text-center">
            <a 
              href="https://github.com/BlueRobotics/blue-pdm#setup" 
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-pdm-fg-muted hover:text-pdm-accent transition-colors"
            >
              Need help setting up Supabase?
              <ExternalLink size={14} />
            </a>
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
        <div className="flex-1 flex items-center justify-center bg-pdm-bg p-8">
          <div className="max-w-xl w-full">
            <div className="text-center mb-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check size={32} className="text-green-500" />
              </div>
              <h1 className="text-2xl font-bold text-pdm-fg mb-2">Connected Successfully!</h1>
              <p className="text-pdm-fg-muted">
                Share this code with your team members so they can connect
              </p>
            </div>
            
            {/* Organization Code */}
            <div className="bg-pdm-bg-light border border-pdm-border rounded-xl p-6 mb-6">
              <label className="block text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
                Organization Code
              </label>
              <div className="relative">
                <div className="font-mono text-sm bg-pdm-bg border border-pdm-border rounded-lg p-4 pr-12 break-all text-pdm-fg">
                  {generatedCode}
                </div>
                <button
                  onClick={handleCopyCode}
                  className="absolute top-1/2 right-3 -translate-y-1/2 p-2 hover:bg-pdm-highlight rounded transition-colors"
                  title="Copy to clipboard"
                >
                  {codeCopied ? (
                    <Check size={18} className="text-green-500" />
                  ) : (
                    <Copy size={18} className="text-pdm-fg-muted" />
                  )}
                </button>
              </div>
              <p className="text-xs text-pdm-fg-muted mt-3">
                Team members can paste this code when they first open BluePDM. 
                Keep this code secure - it contains your Supabase credentials.
              </p>
            </div>
            
            <button
              onClick={handleFinishAdminSetup}
              className="w-full btn btn-primary btn-lg justify-center"
            >
              Continue to BluePDM
            </button>
          </div>
        </div>
      )
    }
    
    // Admin credential entry form
    return (
      <div className="flex-1 flex items-center justify-center bg-pdm-bg p-8">
        <div className="max-w-xl w-full">
          <button
            onClick={() => setMode('select')}
            className="mb-6 text-sm text-pdm-fg-muted hover:text-pdm-fg transition-colors"
          >
            ← Back
          </button>
          
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-pdm-accent/20 flex items-center justify-center">
              <Key size={32} className="text-pdm-accent" />
            </div>
            <h1 className="text-2xl font-bold text-pdm-fg mb-2">Admin Setup</h1>
            <p className="text-pdm-fg-muted">
              Enter your Supabase credentials from your project's API settings
            </p>
          </div>
          
          <div className="space-y-4">
            {/* Supabase URL */}
            <div>
              <label className="block text-sm text-pdm-fg-muted mb-1.5">
                Supabase URL
              </label>
              <input
                type="url"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://xxxxx.supabase.co"
                className="w-full bg-pdm-bg-light border border-pdm-border rounded-lg px-4 py-3 text-pdm-fg placeholder-pdm-fg-dim focus:border-pdm-accent focus:outline-none"
              />
            </div>
            
            {/* Anon Key */}
            <div>
              <label className="block text-sm text-pdm-fg-muted mb-1.5">
                Anon (Public) Key
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full bg-pdm-bg-light border border-pdm-border rounded-lg px-4 py-3 pr-12 text-pdm-fg placeholder-pdm-fg-dim focus:border-pdm-accent focus:outline-none font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-pdm-fg-muted hover:text-pdm-fg"
                >
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            
            {/* Organization Slug (optional) */}
            <div>
              <label className="block text-sm text-pdm-fg-muted mb-1.5">
                Organization Slug <span className="text-pdm-fg-dim">(optional)</span>
              </label>
              <input
                type="text"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                placeholder="e.g., bluerobotics"
                className="w-full bg-pdm-bg-light border border-pdm-border rounded-lg px-4 py-3 text-pdm-fg placeholder-pdm-fg-dim focus:border-pdm-accent focus:outline-none"
              />
              <p className="text-xs text-pdm-fg-dim mt-1">
                This helps identify your organization in the generated code
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
                  Connecting...
                </>
              ) : (
                <>
                  Connect to Supabase
                </>
              )}
            </button>
          </div>
          
          {/* Help Text */}
          <p className="text-xs text-pdm-fg-dim text-center mt-6">
            Find these values in your Supabase Dashboard → Project Settings → API
          </p>
        </div>
      </div>
    )
  }
  
  // Member setup mode
  if (mode === 'member') {
    return (
      <div className="flex-1 flex items-center justify-center bg-pdm-bg p-8">
        <div className="max-w-xl w-full">
          <button
            onClick={() => setMode('select')}
            className="mb-6 text-sm text-pdm-fg-muted hover:text-pdm-fg transition-colors"
          >
            ← Back
          </button>
          
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-green-500/20 flex items-center justify-center">
              <Users size={32} className="text-green-500" />
            </div>
            <h1 className="text-2xl font-bold text-pdm-fg mb-2">Join Your Organization</h1>
            <p className="text-pdm-fg-muted">
              Enter the code provided by your organization admin
            </p>
          </div>
          
          <div className="space-y-4">
            {/* Organization Code Input */}
            <div>
              <label className="block text-sm text-pdm-fg-muted mb-1.5">
                Organization Code
              </label>
              <textarea
                value={orgCode}
                onChange={(e) => setOrgCode(e.target.value)}
                placeholder="PDM-XXXX-XXXX-XXXX..."
                rows={4}
                className="w-full bg-pdm-bg-light border border-pdm-border rounded-lg px-4 py-3 text-pdm-fg placeholder-pdm-fg-dim focus:border-pdm-accent focus:outline-none font-mono text-sm resize-none"
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
                  Connecting...
                </>
              ) : (
                <>
                  Connect
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }
  
  return null
}

