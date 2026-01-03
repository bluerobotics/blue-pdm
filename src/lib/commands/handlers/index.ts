/**
 * Command Handlers Index
 * 
 * This barrel file imports all handler modules to trigger self-registration.
 * Import this file once to register all terminal commands with the registry.
 */

// Import all handlers to trigger self-registration
import './navigation'
import './search'
import './terminal'
import './info'
import './fileTerminal'
import './vaultOps'
import './pinning'
import './backupOps'
import './admin'
import './batch'

// PDM command handlers (used via executor, not self-registered)
// These are imported when needed by the parser for PDM operations
export * from './checkin'
export * from './checkout'
export * from './delete'
export * from './discard'
export * from './download'
export * from './fileOps'
export * from './forceRelease'
export * from './getLatest'
export * from './misc'
export * from './sync'
export * from './syncSwMetadata'

// Re-export registry for external use
export * from '../registry'
