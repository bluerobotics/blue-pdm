import { Image, ExternalLink, FolderOpen, Info, Key, Download } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'

export function SolidWorksSettings() {
  const { 
    organization,
    cadPreviewMode, 
    setCadPreviewMode,
    solidworksPath,
    setSolidworksPath
  } = usePDMStore()

  return (
    <div className="space-y-6">
      {/* Preview Mode */}
      <div className="space-y-3">
        <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
          Preview Mode
        </label>
        <div className="space-y-2">
          <button
            onClick={() => setCadPreviewMode('thumbnail')}
            className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
              cadPreviewMode === 'thumbnail'
                ? 'bg-pdm-accent/10 border-pdm-accent text-pdm-fg'
                : 'bg-pdm-bg border-pdm-border text-pdm-fg-muted hover:border-pdm-fg-muted'
            }`}
          >
            <Image size={24} className={cadPreviewMode === 'thumbnail' ? 'text-pdm-accent' : ''} />
            <div className="text-left">
              <div className="text-sm font-medium">Embedded Thumbnail</div>
              <div className="text-xs opacity-70">
                Extract and show preview image from SolidWorks file
              </div>
            </div>
          </button>

          <button
            onClick={() => setCadPreviewMode('edrawings')}
            className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
              cadPreviewMode === 'edrawings'
                ? 'bg-pdm-accent/10 border-pdm-accent text-pdm-fg'
                : 'bg-pdm-bg border-pdm-border text-pdm-fg-muted hover:border-pdm-fg-muted'
            }`}
          >
            <ExternalLink size={24} className={cadPreviewMode === 'edrawings' ? 'text-pdm-accent' : ''} />
            <div className="text-left">
              <div className="text-sm font-medium">eDrawings (External)</div>
              <div className="text-xs opacity-70">
                Open files in external eDrawings application
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Installation Path */}
      <div className="space-y-3">
        <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
          SolidWorks Installation Path
        </label>
        <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border space-y-3">
          <div className="flex items-start gap-3">
            <FolderOpen size={18} className="text-pdm-fg-muted mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={solidworksPath || ''}
                onChange={(e) => setSolidworksPath(e.target.value || null)}
                placeholder="C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS"
                className="w-full bg-pdm-bg-secondary border border-pdm-border rounded-lg px-3 py-2 text-sm font-mono text-pdm-fg placeholder:text-pdm-fg-dim focus:border-pdm-accent focus:outline-none"
              />
            </div>
          </div>
          <div className="flex items-start gap-2 text-xs text-pdm-fg-muted">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            <span>Only needed if SolidWorks is installed in a non-default location.</span>
          </div>
        </div>
      </div>

      {/* Document Manager License */}
      <div className="space-y-3">
        <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
          Document Manager License
        </label>
        <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
          <div className="flex items-center gap-3 mb-3">
            <Key 
              size={20} 
              className={organization?.settings?.solidworks_dm_license_key ? 'text-green-400' : 'text-pdm-fg-muted'} 
            />
            <span className="text-sm text-pdm-fg">
              {organization?.settings?.solidworks_dm_license_key ? (
                <span className="text-green-400 font-medium">Configured</span>
              ) : (
                <span className="text-pdm-fg-muted">Not configured</span>
              )}
            </span>
          </div>
          <div className="text-xs text-pdm-fg-muted space-y-2">
            {organization?.settings?.solidworks_dm_license_key ? (
              <p>Using fast Document Manager API for file reading.</p>
            ) : (
              <p>Using SolidWorks API (slower, launches SW in background).</p>
            )}
            <p className="pt-1">
              DM license key is configured at the organization level.{' '}
              <a
                href="https://customerportal.solidworks.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-pdm-accent hover:underline"
                onClick={(e) => {
                  e.preventDefault()
                  window.electronAPI?.openFile('https://customerportal.solidworks.com/')
                }}
              >
                Get key from SOLIDWORKS Customer Portal
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* eDrawings download link */}
      <div className="pt-2">
        <a
          href="https://www.solidworks.com/support/free-downloads"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-pdm-accent hover:underline"
          onClick={(e) => {
            e.preventDefault()
            window.electronAPI?.openFile('https://www.solidworks.com/support/free-downloads')
          }}
        >
          <Download size={16} />
          Download eDrawings Viewer (Free)
        </a>
      </div>
    </div>
  )
}

