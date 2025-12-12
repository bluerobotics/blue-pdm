import { useEffect, useState } from 'react'
import { X, AlertCircle, CheckCircle, Info, AlertTriangle, Copy, Check, Loader2, Download, RefreshCw, ArrowDownToLine } from 'lucide-react'
import { usePDMStore, ToastMessage, ToastType } from '../stores/pdmStore'

export function Toast() {
  const { toasts, removeToast, dismissUpdateToast } = usePDMStore()
  
  // Separate different toast types
  const updateToasts = toasts.filter(t => t.type === 'update')
  const progressToasts = toasts.filter(t => t.type === 'progress')
  const regularToasts = toasts.filter(t => t.type !== 'progress' && t.type !== 'update')

  return (
    <div className="fixed bottom-8 left-4 z-50 flex flex-col gap-2 max-w-md">
      {/* Update toasts at the very top */}
      {updateToasts.map(toast => (
        <UpdateToastItem 
          key={toast.id} 
          toast={toast} 
          onDismiss={dismissUpdateToast}
        />
      ))}
      {/* Progress toasts next */}
      {progressToasts.map(toast => (
        <ProgressToastItem 
          key={toast.id} 
          toast={toast}
        />
      ))}
      {/* Regular toasts below */}
      {regularToasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}

function UpdateToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const { updateDownloading, updateDownloaded, updateProgress, setUpdateDownloading } = usePDMStore()
  const [isExiting, setIsExiting] = useState(false)

  const handleDownload = async () => {
    if (updateDownloading || updateDownloaded) return
    
    setUpdateDownloading(true)
    try {
      const result = await window.electronAPI.downloadUpdate()
      if (!result.success) {
        console.error('Download failed:', result.error)
        setUpdateDownloading(false)
      }
    } catch (err) {
      console.error('Download error:', err)
      setUpdateDownloading(false)
    }
  }

  const handleInstall = async () => {
    try {
      await window.electronAPI.installUpdate()
    } catch (err) {
      console.error('Install error:', err)
    }
  }

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(onDismiss, 200)
  }

  // Format bytes to human readable
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatSpeed = (bytesPerSecond: number) => {
    return `${formatBytes(bytesPerSecond)}/s`
  }

  return (
    <div
      className={`
        flex flex-col gap-2 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm min-w-[320px]
        bg-gradient-to-r from-pdm-accent/20 to-cyan-500/10 border-pdm-accent/50
        ${isExiting ? 'animate-slide-out' : 'animate-slide-in'}
      `}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ArrowDownToLine size={16} className="text-pdm-accent" />
          <span className="text-sm font-medium text-pdm-fg">{toast.message}</span>
        </div>
        {!updateDownloading && !updateDownloaded && (
          <button
            onClick={handleDismiss}
            className="opacity-60 hover:opacity-100 transition-opacity text-pdm-fg-muted"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        )}
      </div>
      
      {/* Download Progress */}
      {updateDownloading && updateProgress && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-pdm-bg-dark rounded-full overflow-hidden">
            <div 
              className="h-full bg-pdm-accent transition-all duration-200 ease-out"
              style={{ width: `${updateProgress.percent}%` }}
            />
          </div>
          <span className="text-xs text-pdm-fg-muted tabular-nums whitespace-nowrap">
            {updateProgress.percent.toFixed(0)}%
          </span>
          <span className="text-xs text-pdm-fg-muted whitespace-nowrap">
            {formatSpeed(updateProgress.bytesPerSecond)}
          </span>
        </div>
      )}
      
      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {!updateDownloading && !updateDownloaded && (
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
              bg-pdm-accent text-white hover:bg-pdm-accent/90 transition-colors"
          >
            <Download size={12} />
            Download Update
          </button>
        )}
        
        {updateDownloading && !updateDownloaded && (
          <div className="flex items-center gap-2 text-xs text-pdm-fg-muted">
            <Loader2 size={12} className="animate-spin text-pdm-accent" />
            <span>Downloading...</span>
          </div>
        )}
        
        {updateDownloaded && (
          <button
            onClick={handleInstall}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
              bg-green-600 text-white hover:bg-green-500 transition-colors"
          >
            <RefreshCw size={12} />
            Restart & Install
          </button>
        )}
        
        {updateDownloaded && (
          <button
            onClick={handleDismiss}
            className="px-3 py-1.5 rounded-md text-xs text-pdm-fg-muted hover:text-pdm-fg transition-colors"
          >
            Later
          </button>
        )}
      </div>
    </div>
  )
}

function ProgressToastItem({ toast }: { toast: ToastMessage }) {
  const progress = toast.progress
  
  return (
    <div className="flex flex-col gap-2 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm bg-pdm-panel/95 border-pdm-border min-w-[300px]">
      <div className="flex items-center gap-2">
        <Loader2 size={14} className="text-pdm-accent animate-spin" />
        <span className="text-sm text-pdm-fg">{toast.message}</span>
      </div>
      {progress && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-pdm-bg-dark rounded-full overflow-hidden">
            <div 
              className="h-full transition-all duration-200 ease-out bg-pdm-accent"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="text-xs text-pdm-fg-muted tabular-nums whitespace-nowrap">
            {progress.label || `${progress.current}/${progress.total}`}
          </span>
        </div>
      )}
    </div>
  )
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  const [isExiting, setIsExiting] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (toast.duration !== 0) {
      const timer = setTimeout(() => {
        setIsExiting(true)
        setTimeout(onClose, 200) // Wait for exit animation
      }, toast.duration || 5000)
      return () => clearTimeout(timer)
    }
  }, [toast.duration, onClose])

  const handleClose = () => {
    setIsExiting(true)
    setTimeout(onClose, 200)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(toast.message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const icons: Record<ToastType, React.ReactNode> = {
    error: <AlertCircle size={16} />,
    success: <CheckCircle size={16} />,
    info: <Info size={16} />,
    warning: <AlertTriangle size={16} />,
    progress: <Loader2 size={16} className="animate-spin" />,
    update: <ArrowDownToLine size={16} />
  }

  const colors: Record<ToastType, string> = {
    error: 'bg-red-900/90 border-red-700 text-red-100',
    success: 'bg-green-900/90 border-green-700 text-green-100',
    info: 'bg-blue-900/90 border-blue-700 text-blue-100',
    warning: 'bg-yellow-900/90 border-yellow-700 text-yellow-100',
    progress: 'bg-pdm-panel border-pdm-border text-pdm-fg',
    update: 'bg-pdm-accent/20 border-pdm-accent/50 text-pdm-fg'
  }

  const iconColors: Record<ToastType, string> = {
    error: 'text-red-400',
    success: 'text-green-400',
    info: 'text-blue-400',
    warning: 'text-yellow-400',
    progress: 'text-pdm-accent',
    update: 'text-pdm-accent'
  }

  return (
    <div
      className={`
        flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm
        ${colors[toast.type]}
        ${isExiting ? 'animate-slide-out' : 'animate-slide-in'}
      `}
    >
      <span className={`flex-shrink-0 mt-0.5 ${iconColors[toast.type]}`}>
        {icons[toast.type]}
      </span>
      <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Copy button - show for errors and warnings */}
        {(toast.type === 'error' || toast.type === 'warning') && (
          <button
            onClick={handleCopy}
            className="opacity-60 hover:opacity-100 transition-opacity p-0.5"
            title={copied ? 'Copied!' : 'Copy error'}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
        <button
          onClick={handleClose}
          className="opacity-60 hover:opacity-100 transition-opacity"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

