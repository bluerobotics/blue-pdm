import { useState, useEffect } from 'react'
import { Github, Heart, ExternalLink, Info } from 'lucide-react'

export function AboutSettings() {
  const [appVersion, setAppVersion] = useState<string>('')
  const [platform, setPlatform] = useState<string>('win32')

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setAppVersion)
      window.electronAPI.getPlatform().then(setPlatform)
    }
  }, [])

  const platformDisplay = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux'
  }[platform] || platform

  return (
    <div className="space-y-6">
      {/* App Info */}
      <div className="text-center py-8">
        <div className="w-24 h-24 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
          <span className="text-4xl font-bold text-white">B</span>
        </div>
        <h2 className="text-3xl font-bold text-plm-fg">BluePLM</h2>
        <p className="text-base text-plm-fg-muted mt-1">
          Version {appVersion || '...'}
        </p>
        <p className="text-sm text-plm-fg-dim mt-1">
          Platform: {platformDisplay}
        </p>
      </div>

      {/* Description */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <p className="text-base text-plm-fg leading-relaxed">
          BluePLM is a modern Product Lifecycle Management system designed for everyone who builds.
          Manage CAD files, track revisions, and collaborate with your team seamlessly.
        </p>
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
          Made with <Heart size={16} className="text-red-400" /> by Blue Robotics
        </p>
      </div>
    </div>
  )
}

