import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { X, Terminal as TerminalIcon, Minus, ChevronUp, ChevronDown } from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'
// Force reimport of parser with all new commands (v3 - reload command)
import { executeTerminalCommand, getAutocompleteSuggestions, TerminalOutput } from '../lib/commands/parser'

interface TerminalProps {
  onRefresh?: (silent?: boolean) => void
}

export function Terminal({ onRefresh }: TerminalProps) {
  const { 
    terminalVisible, 
    terminalHeight, 
    terminalHistory,
    toggleTerminal, 
    setTerminalHeight,
    addTerminalHistory,
    files,
    currentFolder
  } = usePDMStore()
  
  const [input, setInput] = useState('')
  const [outputs, setOutputs] = useState<TerminalOutput[]>([
    {
      id: 'welcome',
      type: 'info',
      content: '🔷 BluePDM Terminal v1.0\nType "help" for available commands.',
      timestamp: new Date()
    }
  ])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)

  // Auto-scroll to bottom when outputs change
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [outputs])

  // Focus input when terminal opens
  useEffect(() => {
    if (terminalVisible && inputRef.current) {
      inputRef.current.focus()
    }
  }, [terminalVisible])
  
  // Listen for CLI commands from external CLI tool (via Electron IPC)
  useEffect(() => {
    if (!window.electronAPI?.onCliCommand) return
    
    const unsubscribe = window.electronAPI.onCliCommand(async ({ requestId, command }) => {
      console.log('[Terminal] Received CLI command:', command)
      
      // Add to output
      setOutputs(prev => [...prev, {
        id: `cli-input-${Date.now()}`,
        type: 'input',
        content: `[CLI] $ ${command}`,
        timestamp: new Date()
      }])
      
      // Execute command
      try {
        const results = await executeTerminalCommand(command, onRefresh)
        
        // Handle clear command
        if (results.length === 1 && results[0].content === '__CLEAR__') {
          setOutputs([{
            id: 'cleared',
            type: 'info',
            content: 'Terminal cleared. Type "help" for commands.',
            timestamp: new Date()
          }])
          window.electronAPI?.sendCliResponse(requestId, { outputs: [{ type: 'info', content: 'Cleared' }] })
        } else {
          // Add results to output
          setOutputs(prev => [...prev, ...results])
          
          // Send response back to CLI
          window.electronAPI?.sendCliResponse(requestId, { 
            outputs: results.map(r => ({ type: r.type, content: r.content }))
          })
        }
      } catch (err) {
        const errorOutput = {
          id: `error-${Date.now()}`,
          type: 'error' as const,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date()
        }
        setOutputs(prev => [...prev, errorOutput])
        window.electronAPI?.sendCliResponse(requestId, { 
          outputs: [{ type: 'error', content: errorOutput.content }] 
        })
      }
    })
    
    return () => unsubscribe()
  }, [onRefresh])

  // Update suggestions as user types
  useEffect(() => {
    if (input.length > 0) {
      const newSuggestions = getAutocompleteSuggestions(input, files)
      setSuggestions(newSuggestions)
      setSuggestionIndex(0)
    } else {
      setSuggestions([])
    }
  }, [input, files])

  const handleSubmit = async () => {
    if (!input.trim() || isProcessing) return
    
    const command = input.trim()
    
    // Add input to outputs
    setOutputs(prev => [...prev, {
      id: `input-${Date.now()}`,
      type: 'input',
      content: `$ ${command}`,
      timestamp: new Date()
    }])
    
    // Add to history
    addTerminalHistory(command)
    
    // Clear input and reset history index
    setInput('')
    setHistoryIndex(-1)
    setSuggestions([])
    
    // Execute command
    setIsProcessing(true)
    try {
      const results = await executeTerminalCommand(command, onRefresh)
      
      // Check for clear command
      if (results.length === 1 && results[0].content === '__CLEAR__') {
        setOutputs([{
          id: 'cleared',
          type: 'info',
          content: 'Terminal cleared. Type "help" for commands.',
          timestamp: new Date()
        }])
      } else {
        setOutputs(prev => [...prev, ...results])
      }
    } catch (err) {
      setOutputs(prev => [...prev, {
        id: `error-${Date.now()}`,
        type: 'error',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date()
      }])
    }
    setIsProcessing(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (terminalHistory.length > 0) {
        const newIndex = Math.min(historyIndex + 1, terminalHistory.length - 1)
        setHistoryIndex(newIndex)
        setInput(terminalHistory[newIndex])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setInput(terminalHistory[newIndex])
      } else if (historyIndex === 0) {
        setHistoryIndex(-1)
        setInput('')
      }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (suggestions.length > 0) {
        // Apply the current suggestion
        const parts = input.split(' ')
        parts[parts.length - 1] = suggestions[suggestionIndex]
        setInput(parts.join(' '))
        setSuggestions([])
      }
    } else if (e.key === 'Escape') {
      setSuggestions([])
      if (input === '') {
        toggleTerminal()
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      // Ctrl+C to cancel/clear
      if (isProcessing) {
        // Could add cancel logic here if commands support it
      } else {
        setInput('')
        setHistoryIndex(-1)
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      // Ctrl+L to clear
      e.preventDefault()
      setOutputs([{
        id: 'cleared',
        type: 'info',
        content: 'Terminal cleared.',
        timestamp: new Date()
      }])
    }
  }

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startY: e.clientY, startHeight: terminalHeight }
    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }

  const handleResizeMove = (e: MouseEvent) => {
    if (resizeRef.current) {
      const delta = resizeRef.current.startY - e.clientY
      setTerminalHeight(resizeRef.current.startHeight + delta)
    }
  }

  const handleResizeEnd = () => {
    resizeRef.current = null
    document.removeEventListener('mousemove', handleResizeMove)
    document.removeEventListener('mouseup', handleResizeEnd)
  }

  const getOutputColor = (type: TerminalOutput['type']) => {
    switch (type) {
      case 'input': return 'text-cyan-400'
      case 'success': return 'text-emerald-400'
      case 'error': return 'text-red-400'
      case 'info': return 'text-slate-300'
      default: return 'text-slate-400'
    }
  }

  if (!terminalVisible) return null

  return (
    <div 
      ref={containerRef}
      className="flex flex-col bg-[#0d1117] border-t border-[#30363d] select-none"
      style={{ height: terminalHeight }}
      data-testid="terminal-panel"
    >
      {/* Resize handle */}
      <div 
        className="h-1 cursor-ns-resize hover:bg-pdm-accent/50 transition-colors group"
        onMouseDown={handleResizeStart}
      >
        <div className="h-0.5 mx-auto w-16 mt-0.5 bg-[#30363d] group-hover:bg-pdm-accent rounded-full" />
      </div>
      
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#30363d] bg-[#161b22]">
        <div className="flex items-center gap-2">
          <TerminalIcon size={14} className="text-emerald-500" />
          <span className="text-xs font-mono text-slate-300">Terminal</span>
          <span className="text-[10px] text-slate-500 font-mono">
            {currentFolder || '/'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTerminalHeight(Math.max(150, terminalHeight - 50))}
            className="p-1 rounded hover:bg-[#30363d] text-slate-400 hover:text-slate-200"
            title="Shrink"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={() => setTerminalHeight(Math.min(600, terminalHeight + 50))}
            className="p-1 rounded hover:bg-[#30363d] text-slate-400 hover:text-slate-200"
            title="Expand"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => setTerminalHeight(150)}
            className="p-1 rounded hover:bg-[#30363d] text-slate-400 hover:text-slate-200"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={toggleTerminal}
            className="p-1 rounded hover:bg-[#30363d] text-slate-400 hover:text-red-400"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      
      {/* Output area */}
      <div 
        ref={outputRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1"
        onClick={() => inputRef.current?.focus()}
        data-testid="terminal-output"
      >
        {outputs.map((output) => (
          <div key={output.id} className={`${getOutputColor(output.type)} whitespace-pre-wrap`}>
            {output.content}
          </div>
        ))}
        {isProcessing && (
          <div className="text-amber-400 animate-pulse">Processing...</div>
        )}
      </div>
      
      {/* Input area */}
      <div className="relative border-t border-[#30363d]">
        {/* Autocomplete suggestions */}
        {suggestions.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 bg-[#161b22] border border-[#30363d] border-b-0 rounded-t max-h-32 overflow-y-auto">
            {suggestions.map((suggestion, idx) => (
              <div
                key={suggestion}
                className={`px-3 py-1 text-xs font-mono cursor-pointer ${
                  idx === suggestionIndex 
                    ? 'bg-pdm-accent/30 text-slate-200' 
                    : 'text-slate-400 hover:bg-[#30363d]'
                }`}
                onClick={() => {
                  const parts = input.split(' ')
                  parts[parts.length - 1] = suggestion
                  setInput(parts.join(' '))
                  setSuggestions([])
                  inputRef.current?.focus()
                }}
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}
        
        <div className="flex items-center px-3 py-2 gap-2 bg-[#0d1117]">
          <span className="text-emerald-500 font-mono text-xs">❯</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent border-none outline-none text-slate-200 font-mono text-xs placeholder:text-slate-600"
            autoComplete="off"
            spellCheck={false}
            data-testid="terminal-input"
          />
        </div>
      </div>
    </div>
  )
}

