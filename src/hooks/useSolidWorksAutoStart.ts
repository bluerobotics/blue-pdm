import { useEffect } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import type { Organization } from '@/types/pdm'

/**
 * Auto-start SolidWorks service if enabled and SolidWorks is installed
 * Handles:
 * - Checking if SolidWorks is installed
 * - Auto-starting the service
 * - Sending DM license key to running service
 */
export function useSolidWorksAutoStart(organization: Organization | null) {
  useEffect(() => {
    const { autoStartSolidworksService: autoStart, solidworksIntegrationEnabled } = usePDMStore.getState()
    const dmLicenseKey = organization?.settings?.solidworks_dm_license_key
    
    window.electronAPI?.log?.('info', '[SolidWorks] Auto-start effect triggered')
    window.electronAPI?.log?.('info', `[SolidWorks] integrationEnabled: ${solidworksIntegrationEnabled}`)
    window.electronAPI?.log?.('info', `[SolidWorks] autoStart setting: ${autoStart}`)
    window.electronAPI?.log?.('info', `[SolidWorks] organization loaded: ${!!organization}`)
    window.electronAPI?.log?.('info', `[SolidWorks] dmLicenseKey from org settings: ${dmLicenseKey ? `PRESENT (${dmLicenseKey.length} chars)` : 'NOT PRESENT'}`)
    
    // Skip auto-start if integration is disabled
    if (!solidworksIntegrationEnabled) {
      window.electronAPI?.log?.('info', '[SolidWorks] Integration disabled, skipping auto-start')
      return
    }
    
    if (autoStart && window.electronAPI?.solidworks) {
      // First check if SolidWorks is installed on this machine
      window.electronAPI.solidworks.getServiceStatus().then(result => {
        // Only proceed if SolidWorks is installed
        if (!result?.data?.installed) {
          // SolidWorks not installed - silently skip auto-start
          return
        }
        
        const data = result?.data as any
        
        // SolidWorks is installed, check if service is already running
        if (result?.success && !data?.running) {
          // Service not running - start it with license key
          console.log('[SolidWorks] Auto-starting service...')
          console.log('[SolidWorks] DM License key available:', !!dmLicenseKey)
          window.electronAPI?.solidworks?.startService(dmLicenseKey || undefined).then(startResult => {
            if (startResult?.success) {
              const modeMsg = (startResult.data as any)?.fastModeEnabled 
                ? ' (fast mode)' 
                : ''
              console.log(`[SolidWorks] Service auto-started${modeMsg}`)
            } else {
              console.warn('[SolidWorks] Auto-start failed:', startResult?.error)
            }
          }).catch(err => {
            console.warn('[SolidWorks] Auto-start error:', err)
          })
        } else if (result?.success && data?.running && dmLicenseKey && !data?.documentManagerAvailable) {
          // Service is running but DM API not available - send license key
          console.log('[SolidWorks] Service running but DM API not available, sending license key...')
          window.electronAPI?.solidworks?.startService(dmLicenseKey).then(setKeyResult => {
            if (setKeyResult?.success) {
              console.log('[SolidWorks] License key sent to running service')
            } else {
              console.warn('[SolidWorks] Failed to set license key:', setKeyResult?.error)
            }
          }).catch(err => {
            console.warn('[SolidWorks] Error sending license key:', err)
          })
        }
      }).catch(() => {
        // Service check failed, don't try to start
      })
    }
  }, [organization]) // Re-check when organization loads (for DM license key)
}
