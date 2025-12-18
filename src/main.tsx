import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { initAnalytics, trackError } from './lib/analytics'
import './index.css'

// Initialize Sentry analytics if user has consented
// Read from persisted store in localStorage
try {
  const persistedStore = localStorage.getItem('blue-plm-storage')
  if (persistedStore) {
    const parsed = JSON.parse(persistedStore)
    const state = parsed?.state
    // logSharingEnabled is the consent flag from onboarding
    if (state?.logSharingEnabled === true) {
      initAnalytics(true)
    }
  }
} catch {
  // Silently fail - analytics just won't be enabled
}

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
    
    // Also send to Sentry if it's an Error object
    const errorArg = args.find(arg => arg instanceof Error)
    if (errorArg instanceof Error) {
      trackError(errorArg, { source: 'console.error' })
    }
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

