import { usePDMStore } from '../../stores/pdmStore'
import { BackupPanel } from '../BackupPanel'

export function BackupSettings() {
  const { user } = usePDMStore()
  
  return (
    <div className="h-full -m-6">
      <div className="h-full p-6">
        <BackupPanel isAdmin={user?.role === 'admin'} />
      </div>
    </div>
  )
}

