import { useState } from 'react'
import {
  Image,
  ExternalLink,
  FolderOpen,
  Info,
  EyeOff,
  FileX,
  FileInput,
  Hash,
  FileText,
  Globe,
  Loader2,
  Check,
  ChevronDown,
  Cpu,
} from 'lucide-react'

import { useTranslation } from '@/lib/i18n'

import { useSolidWorksSettings } from '../hooks'

export function SettingsTab() {
  const { t } = useTranslation()
  const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState(false)
  const {
    cadPreviewMode,
    setCadPreviewMode,
    solidworksPath,
    setSolidworksPath,
    swComInstalls,
    solidworksProgId,
    handleSelectSolidworksProgId,
    hideSolidworksTempFiles,
    setHideSolidworksTempFiles,
    ignoreSolidworksTempFiles,
    setIgnoreSolidworksTempFiles,
    lockDrawingRevision,
    setLockDrawingRevision,
    lockDrawingItemNumber,
    setLockDrawingItemNumber,
    lockDrawingDescription,
    setLockDrawingDescription,
    // Model revision policy (org-wide)
    allowModelRevision,
    isSavingRevisionPolicy,
    handleToggleModelRevision,
    isAdmin,
  } = useSolidWorksSettings()

  return (
    <div className="space-y-6">
      {/* Preview Mode */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          Preview Mode
        </label>
        <div className="space-y-2">
          <button
            onClick={() => setCadPreviewMode('thumbnail')}
            className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
              cadPreviewMode === 'thumbnail'
                ? 'bg-plm-accent/10 border-plm-accent text-plm-fg'
                : 'bg-plm-bg border-plm-border text-plm-fg-muted hover:border-plm-fg-muted'
            }`}
          >
            <Image size={24} className={cadPreviewMode === 'thumbnail' ? 'text-plm-accent' : ''} />
            <div className="text-left">
              <div className="text-base font-medium">Embedded Thumbnail</div>
              <div className="text-sm opacity-70">
                Extract and show preview image from SolidWorks file
              </div>
            </div>
          </button>

          <button
            onClick={() => setCadPreviewMode('edrawings')}
            className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
              cadPreviewMode === 'edrawings'
                ? 'bg-plm-accent/10 border-plm-accent text-plm-fg'
                : 'bg-plm-bg border-plm-border text-plm-fg-muted hover:border-plm-fg-muted'
            }`}
          >
            <ExternalLink
              size={24}
              className={cadPreviewMode === 'edrawings' ? 'text-plm-accent' : ''}
            />
            <div className="text-left">
              <div className="text-base font-medium">eDrawings (External)</div>
              <div className="text-sm opacity-70">Open files in external eDrawings application</div>
            </div>
          </button>
        </div>
      </div>

      {/* Temp Files (~$) */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          Temporary Lock Files (~$)
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted">
            <Info size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              SolidWorks creates temporary{' '}
              <code className="px-1.5 py-0.5 bg-plm-bg-secondary rounded">~$filename.sldprt</code>{' '}
              lock files when files are open. These indicate a file is being edited and are
              automatically deleted when closed.
            </span>
          </div>

          {/* Hide toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div className="flex items-center gap-3">
              <EyeOff size={18} className="text-plm-fg-muted" />
              <div>
                <div className="text-sm text-plm-fg">Hide from file browser</div>
                <div className="text-xs text-plm-fg-muted">
                  Don't show ~$ temp files in the file list
                </div>
              </div>
            </div>
            <button
              onClick={() => setHideSolidworksTempFiles(!hideSolidworksTempFiles)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                hideSolidworksTempFiles ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  hideSolidworksTempFiles ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Ignore toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div className="flex items-center gap-3">
              <FileX size={18} className="text-plm-fg-muted" />
              <div>
                <div className="text-sm text-plm-fg">Ignore from sync</div>
                <div className="text-xs text-plm-fg-muted">
                  Skip ~$ files during check-in and sync operations
                </div>
              </div>
            </div>
            <button
              onClick={() => setIgnoreSolidworksTempFiles(!ignoreSolidworksTempFiles)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                ignoreSolidworksTempFiles ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  ignoreSolidworksTempFiles ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Part & Assembly Revision Policy (org-wide) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
            Part & Assembly Revisions
          </label>
          <span className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded bg-plm-accent/20 text-plm-accent">
            Org-wide
          </span>
        </div>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted">
            <Info size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Part (.sldprt) and assembly (.sldasm) revisions are typically controlled at the
              configuration level, driven by drawings. When disabled, file-level revision editing
              and workflow auto-increment are blocked for these file types.
            </span>
          </div>

          {/* Allow file-level revision toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div className="flex items-center gap-3">
              <FileInput size={18} className="text-plm-fg-muted" />
              <div>
                <div className="text-sm text-plm-fg">
                  Allow file-level revisions on parts & assemblies
                </div>
                <div className="text-xs text-plm-fg-muted">
                  When off, revisions are controlled from drawings only
                </div>
              </div>
            </div>
            {isSavingRevisionPolicy ? (
              <Loader2 size={18} className="animate-spin text-plm-accent" />
            ) : (
              <button
                onClick={() => handleToggleModelRevision(!allowModelRevision)}
                disabled={!isAdmin || isSavingRevisionPolicy}
                title={!isAdmin ? 'Only admins can change org-wide settings' : undefined}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  allowModelRevision ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
                } ${!isAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    allowModelRevision ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            )}
          </div>

          {!isAdmin && (
            <div className="flex items-start gap-2 text-xs text-plm-fg-muted/70 pt-1">
              <Globe size={12} className="mt-0.5 flex-shrink-0" />
              <span>This is an organization-wide setting. Only admins can change it.</span>
            </div>
          )}
        </div>
      </div>

      {/* Drawing Metadata Lockouts */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          Drawing Metadata
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted">
            <Info size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Drawing files (.slddrw) typically inherit their metadata from the model they
              reference. When locked, these fields are read-only and show a{' '}
              <FileInput size={12} className="inline mx-0.5" /> indicator.
            </span>
          </div>

          {/* Lock Revision toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div className="flex items-center gap-3">
              <FileInput size={18} className="text-plm-fg-muted" />
              <div>
                <div className="text-sm text-plm-fg">Lock drawing revision</div>
                <div className="text-xs text-plm-fg-muted">
                  Revision comes from the drawing's revision table
                </div>
              </div>
            </div>
            <button
              onClick={() => setLockDrawingRevision(!lockDrawingRevision)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                lockDrawingRevision ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  lockDrawingRevision ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Lock Item Number toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div className="flex items-center gap-3">
              <Hash size={18} className="text-plm-fg-muted" />
              <div>
                <div className="text-sm text-plm-fg">Lock drawing item number</div>
                <div className="text-xs text-plm-fg-muted">
                  Item number inherited from referenced model
                </div>
              </div>
            </div>
            <button
              onClick={() => setLockDrawingItemNumber(!lockDrawingItemNumber)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                lockDrawingItemNumber ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  lockDrawingItemNumber ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Lock Description toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div className="flex items-center gap-3">
              <FileText size={18} className="text-plm-fg-muted" />
              <div>
                <div className="text-sm text-plm-fg">Lock drawing description</div>
                <div className="text-xs text-plm-fg-muted">
                  Description inherited from referenced model
                </div>
              </div>
            </div>
            <button
              onClick={() => setLockDrawingDescription(!lockDrawingDescription)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                lockDrawingDescription ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  lockDrawingDescription ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Version selection - only meaningful with several releases installed */}
      {swComInstalls.length > 1 && (
        <div className="space-y-3">
          <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
            {t('solidworksVersion.settingTitle')}
          </label>
          <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Cpu size={18} className="text-plm-fg-muted" />
                <div>
                  <div className="text-sm text-plm-fg">{t('solidworksVersion.settingLabel')}</div>
                  <div className="text-xs text-plm-fg-muted">
                    {t('solidworksVersion.settingDescription')}
                  </div>
                </div>
              </div>
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => setIsVersionDropdownOpen(!isVersionDropdownOpen)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-plm-bg-secondary border border-plm-border rounded-lg hover:border-plm-accent/50 transition-colors min-w-[200px]"
                >
                  <span className="flex-1 text-left text-plm-fg font-medium">
                    {swComInstalls.find((install) => install.progId === solidworksProgId)
                      ? `SOLIDWORKS ${swComInstalls.find((install) => install.progId === solidworksProgId)!.year}`
                      : t('solidworksVersion.automatic')}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`text-plm-fg-muted transition-transform ${isVersionDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {isVersionDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsVersionDropdownOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-[280px] bg-plm-bg-secondary border border-plm-border rounded-lg shadow-xl overflow-hidden">
                      {[null, ...swComInstalls.map((install) => install.progId)].map((progId) => {
                        const install = swComInstalls.find((item) => item.progId === progId)
                        const isSelected = solidworksProgId === progId
                        return (
                          <button
                            key={progId ?? 'automatic'}
                            onClick={() => {
                              setIsVersionDropdownOpen(false)
                              handleSelectSolidworksProgId(progId)
                            }}
                            className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                              isSelected
                                ? 'bg-plm-accent/15 text-plm-accent'
                                : 'text-plm-fg hover:bg-plm-bg'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-medium">
                                {install
                                  ? `SOLIDWORKS ${install.year}`
                                  : t('solidworksVersion.automatic')}
                              </div>
                              <div className="text-xs text-plm-fg-muted truncate">
                                {install
                                  ? install.exePath || install.progId
                                  : t('solidworksVersion.automaticDescription')}
                              </div>
                            </div>
                            {isSelected && <Check size={16} className="flex-shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2 text-sm text-plm-fg-muted pt-2 border-t border-plm-border">
              <Info size={16} className="mt-0.5 flex-shrink-0" />
              <span>{t('solidworksVersion.settingHint')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Installation Path */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          SolidWorks Installation Path
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-3">
          <div className="flex items-start gap-3">
            <FolderOpen size={20} className="text-plm-fg-muted mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0 flex gap-2">
              <input
                type="text"
                value={solidworksPath || ''}
                onChange={(e) => setSolidworksPath(e.target.value || null)}
                placeholder="C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS"
                className="flex-1 bg-plm-bg-secondary border border-plm-border rounded-lg px-3 py-2 text-base font-mono text-plm-fg placeholder:text-plm-fg-dim focus:border-plm-accent focus:outline-none"
              />
              <button
                onClick={async () => {
                  const result = await window.electronAPI?.selectFolder()
                  if (result?.success && result.folderPath) {
                    setSolidworksPath(result.folderPath)
                  }
                }}
                className="px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded-lg text-sm text-plm-fg hover:border-plm-accent transition-colors flex-shrink-0"
              >
                Browse
              </button>
            </div>
          </div>
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted">
            <Info size={16} className="mt-0.5 flex-shrink-0" />
            <span>Only needed if SolidWorks is installed in a non-default location.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
