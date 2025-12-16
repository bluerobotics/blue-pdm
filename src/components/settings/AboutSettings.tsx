import { useState, useEffect } from 'react'
import { Github, Heart, ExternalLink, Info, RefreshCw, Loader2, CheckCircle, Download, History, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { usePDMStore } from '../../stores/pdmStore'

interface GitHubRelease {
  tag_name: string
  name: string
  published_at: string
  html_url: string
  prerelease: boolean
  body: string
}

export function AboutSettings() {
  const { t } = useTranslation()
  const { addToast } = usePDMStore()
  const [appVersion, setAppVersion] = useState<string>('')
  const [platform, setPlatform] = useState<string>('win32')
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateCheckResult, setUpdateCheckResult] = useState<'none' | 'available' | 'error' | null>(null)
  
  // Version selector state
  const [releases, setReleases] = useState<GitHubRelease[]>([])
  const [isLoadingReleases, setIsLoadingReleases] = useState(false)
  const [releasesError, setReleasesError] = useState<string | null>(null)

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setAppVersion)
      window.electronAPI.getPlatform().then(setPlatform)
    }
    // Fetch releases on mount
    fetchReleases()
  }, [])
  
  const fetchReleases = async () => {
    setIsLoadingReleases(true)
    setReleasesError(null)
    
    try {
      const response = await fetch('https://api.github.com/repos/bluerobotics/bluePLM/releases?per_page=20')
      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`)
      }
      const data: GitHubRelease[] = await response.json()
      setReleases(data)
    } catch (err) {
      console.error('Failed to fetch releases:', err)
      setReleasesError(err instanceof Error ? err.message : 'Failed to fetch releases')
    } finally {
      setIsLoadingReleases(false)
    }
  }
  
  const handleInstallVersion = async (release: GitHubRelease) => {
    const { setUpdateAvailable, setShowUpdateModal, setUpdateDownloading, setUpdateDownloaded, setInstallerPath } = usePDMStore.getState()
    
    // Determine the correct asset for this platform
    const platformExtensions: Record<string, string[]> = {
      win32: ['.exe'],
      darwin: ['.dmg', '.zip'],
      linux: ['.AppImage', '.deb']
    }
    
    const extensions = platformExtensions[platform] || ['.exe']
    
    // Fetch release assets
    try {
      const response = await fetch(`https://api.github.com/repos/bluerobotics/bluePLM/releases/tags/${release.tag_name}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch release: ${response.status}`)
      }
      
      const releaseData = await response.json()
      const assets = releaseData.assets || []
      
      // Find the appropriate asset for this platform
      let downloadUrl: string | null = null
      for (const ext of extensions) {
        const asset = assets.find((a: { name: string; browser_download_url: string }) => 
          a.name.toLowerCase().endsWith(ext.toLowerCase())
        )
        if (asset) {
          downloadUrl = asset.browser_download_url
          break
        }
      }
      
      if (!downloadUrl) {
        // Fallback: open release page
        addToast('warning', `No installer found for ${platformDisplay}. Opening release page...`)
        window.electronAPI?.openFile(release.html_url)
        return
      }
      
      // Determine if this is a rollback or upgrade
      const relation = getVersionRelation(release.tag_name)
      
      // Reset update state
      setUpdateDownloading(false)
      setUpdateDownloaded(false)
      setInstallerPath(null)
      
      // Set up the update modal with the selected version
      setUpdateAvailable({
        version: release.tag_name.replace(/^v/, ''),
        releaseDate: release.published_at,
        releaseNotes: relation === 'older' ? 'rollback' : undefined,
        downloadUrl,
        isManualVersion: true
      })
      
      // Show the update modal
      setShowUpdateModal(true)
      
    } catch (err) {
      console.error('Failed to get release assets:', err)
      addToast('error', `Failed to get download URL: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  
  // Compare versions: returns -1 if a < b, 0 if equal, 1 if a > b
  const compareVersions = (a: string, b: string): number => {
    const parseVersion = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
    const aParts = parseVersion(a)
    const bParts = parseVersion(b)
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0
      const bPart = bParts[i] || 0
      if (aPart < bPart) return -1
      if (aPart > bPart) return 1
    }
    return 0
  }
  
  const getVersionRelation = (releaseVersion: string): 'current' | 'newer' | 'older' => {
    const cleanRelease = releaseVersion.replace(/^v/, '')
    const cleanCurrent = appVersion.replace(/^v/, '')
    const cmp = compareVersions(cleanRelease, cleanCurrent)
    if (cmp === 0) return 'current'
    if (cmp > 0) return 'newer'
    return 'older'
  }

  // Handle manual update check
  const handleCheckForUpdates = async () => {
    if (!window.electronAPI || isCheckingUpdate) return
    
    setIsCheckingUpdate(true)
    setUpdateCheckResult(null)
    
    try {
      const result = await window.electronAPI.checkForUpdates()
      if (result.success && result.updateInfo) {
        setUpdateCheckResult('available')
      } else if (result.success) {
        setUpdateCheckResult('none')
      } else {
        setUpdateCheckResult('error')
      }
    } catch (err) {
      console.error('Update check error:', err)
      setUpdateCheckResult('error')
    } finally {
      setIsCheckingUpdate(false)
      setTimeout(() => setUpdateCheckResult(null), 5000)
    }
  }

  const platformDisplay = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux'
  }[platform] || platform

  return (
    <div className="space-y-6">
      {/* App Info */}
      <div className="text-center py-8">
        {/* Stacked Layers Logo */}
        <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" className="text-plm-accent">
            <path 
              d="M12 2L2 7L12 12L22 7L12 2Z" 
              stroke="currentColor" 
              strokeWidth="1.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
            <path 
              d="M2 17L12 22L22 17" 
              stroke="currentColor" 
              strokeWidth="1.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
            <path 
              d="M2 12L12 17L22 12" 
              stroke="currentColor" 
              strokeWidth="1.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 className="text-3xl font-bold text-plm-fg">BluePLM</h2>
        <p className="text-sm text-plm-fg-muted mt-2 max-w-md mx-auto leading-relaxed">
          Open-source Product Lifecycle Management for everyone who builds. 
          Check in/out CAD files, track revisions, manage engineering changes, 
          control release workflows, and collaborate with your team—all in one place.
        </p>
        <p className="text-base text-plm-fg-muted mt-4">
          Version {appVersion || '...'}
        </p>
        <p className="text-sm text-plm-fg-dim mt-1">
          Platform: {platformDisplay}
        </p>
        
        {/* Check for Updates */}
        <button
          onClick={handleCheckForUpdates}
          disabled={isCheckingUpdate}
          className={`mt-4 flex items-center gap-2 mx-auto px-4 py-2 text-base font-medium rounded-lg transition-colors ${
            updateCheckResult === 'none'
              ? 'bg-green-600/20 text-green-400 border border-green-600/30'
              : updateCheckResult === 'available'
              ? 'bg-plm-accent/20 text-plm-accent border border-plm-accent/30'
              : 'bg-plm-highlight text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight/80'
          }`}
        >
          {isCheckingUpdate ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t('preferences.checking')}
            </>
          ) : updateCheckResult === 'none' ? (
            <>
              <CheckCircle size={14} />
              {t('preferences.upToDate')}
            </>
          ) : updateCheckResult === 'available' ? (
            <>
              <Download size={14} />
              {t('preferences.available')}
            </>
          ) : (
            <>
              <RefreshCw size={14} />
              {t('preferences.checkForUpdates')}
            </>
          )}
        </button>
        {updateCheckResult === 'none' && (
          <p className="text-sm text-plm-fg-dim mt-2">{t('preferences.youHaveLatest')}</p>
        )}
        {updateCheckResult === 'available' && (
          <p className="text-sm text-plm-accent mt-2">{t('preferences.updateAvailable')}</p>
        )}
      </div>

      {/* Version History */}
      <div className="bg-plm-bg rounded-lg border border-plm-border overflow-hidden">
        <div className="flex items-center gap-3 p-3 border-b border-white/5">
          <History size={18} className="text-plm-fg-muted" />
          <span className="text-sm font-medium text-plm-fg">Version History</span>
        </div>
        
        {isLoadingReleases ? (
          <div className="flex items-center justify-center gap-2 p-6 text-plm-fg-muted">
            <Loader2 size={16} className="animate-spin" />
            <span>Loading releases...</span>
          </div>
        ) : releasesError ? (
          <div className="p-4 text-center">
            <p className="text-sm text-plm-error mb-2">{releasesError}</p>
            <button
              onClick={fetchReleases}
              className="text-sm text-plm-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="h-48 overflow-y-auto">
            {releases.map((release) => {
              const relation = getVersionRelation(release.tag_name)
              const isCurrent = relation === 'current'
              const isNewer = relation === 'newer'
              
              return (
                <div
                  key={release.tag_name}
                  className={`flex items-center justify-between px-3 py-2 border-b border-white/5 last:border-b-0 ${
                    isCurrent ? 'bg-plm-accent/10' : 'hover:bg-plm-highlight/30'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isNewer ? (
                      <ArrowUpCircle size={14} className="text-green-400 flex-shrink-0" />
                    ) : isCurrent ? (
                      <CheckCircle size={14} className="text-plm-accent flex-shrink-0" />
                    ) : (
                      <ArrowDownCircle size={14} className="text-plm-fg-muted flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isCurrent ? 'text-plm-accent' : 'text-plm-fg'}`}>
                          {release.tag_name}
                        </span>
                        {release.prerelease && (
                          <span className="px-1 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-400 rounded">
                            Pre
                          </span>
                        )}
                        {isCurrent && (
                          <span className="px-1 py-0.5 text-[10px] bg-plm-accent/20 text-plm-accent rounded">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-plm-fg-muted">
                        {new Date(release.published_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </div>
                    </div>
                  </div>
                  
                  {!isCurrent && (
                    <button
                      onClick={() => handleInstallVersion(release)}
                      className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                        isNewer
                          ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                          : 'bg-plm-highlight text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight/80'
                      }`}
                    >
                      <Download size={10} />
                      {isNewer ? 'Upgrade' : 'Rollback'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Links */}
      <div className="space-y-2">
        <a
          href="https://github.com/bluerobotics/bluePLM"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-plm-bg rounded-lg border border-plm-border hover:border-plm-fg-muted transition-colors"
          onClick={(e) => {
            e.preventDefault()
            window.electronAPI?.openFile('https://github.com/bluerobotics/bluePLM')
          }}
        >
          <Github size={24} className="text-plm-fg-muted" />
          <div className="flex-1">
            <div className="text-base font-medium text-plm-fg">GitHub Repository</div>
            <div className="text-sm text-plm-fg-muted">View source code and contribute</div>
          </div>
          <ExternalLink size={18} className="text-plm-fg-muted" />
        </a>

        <a
          href="https://github.com/bluerobotics/bluePLM/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-plm-bg rounded-lg border border-plm-border hover:border-plm-fg-muted transition-colors"
          onClick={(e) => {
            e.preventDefault()
            window.electronAPI?.openFile('https://github.com/bluerobotics/bluePLM/issues')
          }}
        >
          <Info size={24} className="text-plm-fg-muted" />
          <div className="flex-1">
            <div className="text-base font-medium text-plm-fg">Report Issues</div>
            <div className="text-sm text-plm-fg-muted">Found a bug? Let us know!</div>
          </div>
          <ExternalLink size={18} className="text-plm-fg-muted" />
        </a>
      </div>

      {/* Credits */}
      <div className="pt-4 border-t border-plm-border text-center">
        <p className="text-base text-plm-fg-muted flex items-center justify-center gap-1.5">
          Made with <Heart size={16} className="text-blue-400 fill-blue-400" /> by Blue Robotics and contributors worldwide
        </p>
      </div>
    </div>
  )
}

