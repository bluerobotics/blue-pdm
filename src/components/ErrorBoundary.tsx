import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertOctagon, Copy, RefreshCw, ChevronDown, ChevronUp, Bug } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
  copied: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      copied: false
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
    
    // Log to console for development
    console.error('ErrorBoundary caught an error:', error)
    console.error('Component stack:', errorInfo.componentStack)
    
    // Log via electron API if available
    if (window.electronAPI?.log) {
      window.electronAPI.log('error', 'Application crash', {
        error: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack
      })
    }
  }

  handleCopyLogs = () => {
    const { error, errorInfo } = this.state
    const timestamp = new Date().toISOString()
    
    const logContent = `BluePLM Crash Report
====================
Timestamp: ${timestamp}
Platform: ${navigator.platform}
User Agent: ${navigator.userAgent}

Error Message:
${error?.message || 'Unknown error'}

Error Stack:
${error?.stack || 'No stack trace available'}

Component Stack:
${errorInfo?.componentStack || 'No component stack available'}
`
    
    navigator.clipboard.writeText(logContent)
    this.setState({ copied: true })
    setTimeout(() => this.setState({ copied: false }), 2000)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const { error, errorInfo, showDetails, copied } = this.state

      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
          <div className="max-w-2xl w-full">
            {/* Main error card */}
            <div className="bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-red-500/20 to-orange-500/20 border-b border-slate-700 p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-red-500/20 rounded-xl">
                    <AlertOctagon size={32} className="text-red-400" />
                  </div>
                  <div>
                    <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
                    <p className="text-slate-400 text-sm mt-1">
                      BluePLM encountered an unexpected error
                    </p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                {/* Error message preview */}
                <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-start gap-3">
                    <Bug size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-red-400 mb-1">Error</p>
                      <p className="text-sm text-slate-300 font-mono break-all">
                        {error?.message || 'Unknown error occurred'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Expandable details */}
                <div className="border border-slate-700 rounded-lg overflow-hidden">
                  <button
                    onClick={() => this.setState({ showDetails: !showDetails })}
                    className="w-full flex items-center justify-between p-3 bg-slate-900/30 hover:bg-slate-900/50 transition-colors text-left"
                  >
                    <span className="text-sm font-medium text-slate-400">
                      Technical Details
                    </span>
                    {showDetails ? (
                      <ChevronUp size={16} className="text-slate-500" />
                    ) : (
                      <ChevronDown size={16} className="text-slate-500" />
                    )}
                  </button>
                  
                  {showDetails && (
                    <div className="p-4 bg-slate-950/50 border-t border-slate-700 space-y-4">
                      {/* Stack trace */}
                      <div>
                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                          Stack Trace
                        </p>
                        <pre className="text-xs text-slate-400 font-mono bg-black/30 rounded p-3 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                          {error?.stack || 'No stack trace available'}
                        </pre>
                      </div>
                      
                      {/* Component stack */}
                      {errorInfo?.componentStack && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                            Component Stack
                          </p>
                          <pre className="text-xs text-slate-400 font-mono bg-black/30 rounded p-3 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                            {errorInfo.componentStack}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={this.handleCopyLogs}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                  >
                    <Copy size={16} />
                    {copied ? 'Copied!' : 'Copy Crash Report'}
                  </button>
                  <button
                    onClick={this.handleReload}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
                  >
                    <RefreshCw size={16} />
                    Reload App
                  </button>
                </div>

                {/* Help text */}
                <p className="text-xs text-slate-500 text-center pt-2">
                  If this keeps happening, please copy the crash report and{' '}
                  <a 
                    href="https://github.com/bluerobotics/bluePLM/issues/new" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline"
                  >
                    create a GitHub issue
                  </a>.
                </p>
              </div>
            </div>

            {/* Version info */}
            <p className="text-center text-slate-600 text-xs mt-4">
              BluePLM • {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary

