import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// Intercept console.error and console.warn to also send them to app logs
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.error = (...args: unknown[]) => {
  // Call original so dev tools still work
  originalConsoleError.apply(console, args)
  
  // Forward to app logs
  try {
    const message = args
      .map(arg => {
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`
        }
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        }
        return String(arg)
      })
      .join(' ')
    
    window.electronAPI?.log('error', `[Console] ${message}`)
  } catch {
    // Silently fail if logging fails
  }
}

console.warn = (...args: unknown[]) => {
  // Call original so dev tools still work
  originalConsoleWarn.apply(console, args)
  
  // Forward to app logs
  try {
    const message = args
      .map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        }
        return String(arg)
      })
      .join(' ')
    
    window.electronAPI?.log('warn', `[Console] ${message}`)
  } catch {
    // Silently fail if logging fails
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

