// src/components/context-menu/dialogs/ForceCheckinDialog.tsx
import { Monitor, CloudOff, File, ArrowUp } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import { MAX_VISIBLE_FILES } from '../constants'

interface ForceCheckinDialogProps {
  isOpen: boolean
  onClose: () => void
  filesOnDifferentMachine: LocalFile[]
  machineNames: string[]
  anyMachineOnline: boolean
  onForceCheckin: () => void
}

export function ForceCheckinDialog({
  isOpen,
  onClose,
  filesOnDifferentMachine,
  machineNames,
  anyMachineOnline,
  onForceCheckin
}: ForceCheckinDialogProps) {
  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div 
        className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${anyMachineOnline ? 'bg-plm-warning/20' : 'bg-plm-error/20'}`}>
            {anyMachineOnline ? (
              <Monitor size={20} className="text-plm-warning" />
            ) : (
              <CloudOff size={20} className="text-plm-error" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-plm-fg">
              {anyMachineOnline ? 'Check In From Different Computer' : 'Cannot Check In - Machine Offline'}
            </h3>
            <p className="text-sm text-plm-fg-muted">
              {filesOnDifferentMachine.length} file{filesOnDifferentMachine.length > 1 ? 's are' : ' is'} checked out on {machineNames.join(', ')}.
            </p>
          </div>
        </div>
        
        <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4 max-h-40 overflow-y-auto">
          <div className="space-y-1">
            {filesOnDifferentMachine.slice(0, MAX_VISIBLE_FILES).map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <File size={14} className={anyMachineOnline ? 'text-plm-warning' : 'text-plm-error'} />
                <span className="text-plm-fg truncate">{f.name}</span>
              </div>
            ))}
            {filesOnDifferentMachine.length > MAX_VISIBLE_FILES && (
              <div className="text-xs text-plm-fg-muted">
                ...and {filesOnDifferentMachine.length - MAX_VISIBLE_FILES} more
              </div>
            )}
          </div>
        </div>
        
        {/* Warning/Info based on online status */}
        {anyMachineOnline ? (
          <div className="bg-plm-warning/10 border border-plm-warning/30 rounded p-3 mb-4">
            <p className="text-sm text-plm-fg">
              Are you sure you want to check in from here? Any unsaved changes on {machineNames.length === 1 ? 'that' : 'those'} computer{machineNames.length > 1 ? 's' : ''} will be lost.
            </p>
            <p className="text-xs text-plm-fg-muted mt-2">
              The other computer{machineNames.length > 1 ? 's' : ''} will be notified.
            </p>
          </div>
        ) : (
          <div className="bg-plm-error/10 border border-plm-error/30 rounded p-3 mb-4">
            <p className="text-sm text-plm-fg">
              You can only check in files from another machine when that machine is <strong>online</strong>.
            </p>
            <p className="text-xs text-plm-fg-muted mt-2">
              This ensures no unsaved work is lost. Please check in from the original computer, or wait for it to come online.
            </p>
          </div>
        )}
        
        <div className="flex flex-col gap-2">
          {anyMachineOnline ? (
            <>
              <button
                onClick={onForceCheckin}
                className="btn bg-plm-warning hover:bg-plm-warning/80 text-white w-full justify-center"
              >
                <ArrowUp size={14} />
                Force Check In
              </button>
              <button
                onClick={onClose}
                className="btn btn-ghost w-full justify-center"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="btn btn-primary w-full justify-center"
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
