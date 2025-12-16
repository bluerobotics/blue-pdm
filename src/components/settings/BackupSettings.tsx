import { usePDMStore } from '../../stores/pdmStore'
import { BackupPanel } from '../BackupPanel'

export function BackupSettings() {
  const { getEffectiveRole } = usePDMStore()
  
  return (
    <div className="h-full -m-6">
      <div className="h-full p-6">
        <BackupPanel isAdmin={getEffectiveRole() === 'admin'} />
      </div>
    </div>
  )
}

