import { useEffect, useState } from 'react'
import { Check, Cpu, Info, Loader2 } from 'lucide-react'

import { useTranslation } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

/**
 * First-run picker shown when several SOLIDWORKS releases are installed.
 *
 * A running SOLIDWORKS only publishes itself for COM under its own versioned
 * ProgID, so BluePLM has to be told which release to talk to. Without a choice it
 * falls back to whatever Windows registered as the default, which is frequently
 * not the release the user actually opens.
 */
export function SolidWorksVersionModal() {
  const { t } = useTranslation()
  const showSolidworksVersionModal = usePDMStore((state) => state.showSolidworksVersionModal)
  const setShowSolidworksVersionModal = usePDMStore((state) => state.setShowSolidworksVersionModal)
  const solidworksProgId = usePDMStore((state) => state.solidworksProgId)
  const setSolidworksProgId = usePDMStore((state) => state.setSolidworksProgId)

  const [installs, setInstalls] = useState<SolidWorksComInstall[]>([])
  const [selectedProgId, setSelectedProgId] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)

  useEffect(() => {
    if (!showSolidworksVersionModal) return

    let cancelled = false
    window.electronAPI?.solidworks
      ?.getComInstalls()
      .then((result) => {
        if (cancelled || !result?.success || !result.installs) return
        setInstalls(result.installs)
        setSelectedProgId(
          solidworksProgId ??
            result.installs.find((install) => install.isDefault)?.progId ??
            result.installs[0]?.progId ??
            null,
        )
      })
      .catch((error) => {
        log.warn('[SolidWorks]', `Failed to load COM installs: ${error}`)
      })

    return () => {
      cancelled = true
    }
  }, [showSolidworksVersionModal, solidworksProgId])

  if (!showSolidworksVersionModal) return null

  const handleConfirm = async () => {
    if (!selectedProgId) return
    setIsApplying(true)
    setSolidworksProgId(selectedProgId)

    try {
      // Persist before restarting: startSWService reads the choice back from disk.
      await window.electronAPI?.solidworks?.setAutoStartConfig({
        autoStartEnabled: usePDMStore.getState().autoStartSolidworksService,
        integrationEnabled: usePDMStore.getState().solidworksIntegrationEnabled,
        swProgId: selectedProgId,
      })
      await window.electronAPI?.solidworks?.forceRestart()
      log.info('[SolidWorks]', `Version selected: ${selectedProgId}, service restarted`)
    } catch (error) {
      log.error('[SolidWorks]', `Failed to apply version selection: ${error}`)
    } finally {
      setIsApplying(false)
      setShowSolidworksVersionModal(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative w-full max-w-lg mx-4 overflow-hidden rounded-lg border border-plm-border bg-plm-bg-secondary shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-plm-border">
          <div className="p-2 rounded-full bg-plm-accent/20">
            <Cpu size={20} className="text-plm-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-plm-fg">{t('solidworksVersion.title')}</h2>
            <p className="text-sm text-plm-fg-muted">{t('solidworksVersion.subtitle')}</p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted">
            <Info size={16} className="mt-0.5 flex-shrink-0" />
            <span>{t('solidworksVersion.explanation')}</span>
          </div>

          <div className="space-y-2">
            {installs.map((install) => {
              const isSelected = selectedProgId === install.progId
              return (
                <button
                  key={install.progId}
                  onClick={() => setSelectedProgId(install.progId)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'bg-plm-accent/10 border-plm-accent'
                      : 'bg-plm-bg border-plm-border hover:border-plm-fg-muted'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium text-plm-fg">
                        SOLIDWORKS {install.year}
                      </span>
                      {install.isDefault && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded bg-plm-bg-secondary text-plm-fg-muted">
                          {t('solidworksVersion.windowsDefault')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-plm-fg-muted truncate">
                      {install.exePath || install.progId}
                    </div>
                  </div>
                  {isSelected && <Check size={18} className="text-plm-accent flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-plm-border">
          <button
            onClick={handleConfirm}
            disabled={!selectedProgId || isApplying}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-plm-accent text-white hover:bg-plm-accent/90 transition-colors disabled:opacity-50"
          >
            {isApplying && <Loader2 size={16} className="animate-spin" />}
            {t('solidworksVersion.confirm')}
          </button>
          <button
            onClick={() => setShowSolidworksVersionModal(false)}
            disabled={isApplying}
            className="ml-auto px-4 py-2 rounded-md text-sm text-plm-fg-muted hover:text-plm-fg transition-colors disabled:opacity-50"
          >
            {t('solidworksVersion.decideLater')}
          </button>
        </div>
      </div>
    </div>
  )
}
