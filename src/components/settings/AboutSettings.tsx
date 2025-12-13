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
        <h2 className="text-2xl font-bold text-pdm-fg">BluePDM</h2>
        <p className="text-sm text-pdm-fg-muted mt-1">
          Version {appVersion || '...'}
        </p>
        <p className="text-xs text-pdm-fg-dim mt-1">
          Platform: {platformDisplay}
        </p>
      </div>

      {/* Description */}
      <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
        <p className="text-sm text-pdm-fg leading-relaxed">
          BluePDM is a modern Product Data Management system designed for engineering teams.
          Manage CAD files, track revisions, and collaborate with your team seamlessly.
        </p>
      </div>

      {/* Links */}
      <div className="space-y-2">
        <a
          href="https://github.com/bluerobotics/bluepdm"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-pdm-bg rounded-lg border border-pdm-border hover:border-pdm-fg-muted transition-colors"
          onClick={(e) => {
            e.preventDefault()
            window.electronAPI?.openFile('https://github.com/bluerobotics/bluepdm')
          }}
        >
          <Github size={22} className="text-pdm-fg-muted" />
          <div className="flex-1">
            <div className="text-sm font-medium text-pdm-fg">GitHub Repository</div>
            <div className="text-xs text-pdm-fg-muted">View source code and contribute</div>
          </div>
          <ExternalLink size={16} className="text-pdm-fg-muted" />
        </a>

        <a
          href="https://github.com/bluerobotics/bluepdm/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-pdm-bg rounded-lg border border-pdm-border hover:border-pdm-fg-muted transition-colors"
          onClick={(e) => {
            e.preventDefault()
            window.electronAPI?.openFile('https://github.com/bluerobotics/bluepdm/issues')
          }}
        >
          <Info size={22} className="text-pdm-fg-muted" />
          <div className="flex-1">
            <div className="text-sm font-medium text-pdm-fg">Report Issues</div>
            <div className="text-xs text-pdm-fg-muted">Found a bug? Let us know!</div>
          </div>
          <ExternalLink size={16} className="text-pdm-fg-muted" />
        </a>
      </div>

      {/* Credits */}
      <div className="pt-4 border-t border-pdm-border text-center">
        <p className="text-sm text-pdm-fg-muted flex items-center justify-center gap-1.5">
          Made with <Heart size={14} className="text-red-400" /> by Blue Robotics
        </p>
      </div>
    </div>
  )
}

