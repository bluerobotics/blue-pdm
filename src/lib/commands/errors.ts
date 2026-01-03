/**
 * Command Error Types
 * 
 * Custom error types for command execution.
 */

/**
 * Error thrown when an unknown command is executed
 */
export class UnknownCommandError extends Error {
  constructor(public command: string) {
    super(`Unknown command: ${command}. Type 'help' for available commands.`)
    this.name = 'UnknownCommandError'
  }
}

/**
 * Error thrown when a command fails during execution
 */
export class CommandExecutionError extends Error {
  constructor(public command: string, public originalError: Error) {
    super(`Command '${command}' failed: ${originalError.message}`)
    this.name = 'CommandExecutionError'
  }
}
