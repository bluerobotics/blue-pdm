// High-speed telemetry service for performance monitoring
// Collects CPU, memory, network, FPS data at configurable intervals

export interface TelemetrySnapshot {
  timestamp: number
  fps: number
  cpu: number
  memory: {
    system: number  // System memory percent
    app: {
      heapUsed: number
      heapTotal: number
      rss: number
    }
  }
  network: {
    rxSpeed: number
    txSpeed: number
  }
  modules: Record<string, ModuleMemory>
}

export interface ModuleMemory {
  name: string
  heapUsed: number
  instances: number
  lastUpdate: number
}

export interface TelemetryConfig {
  sampleRateHz: number      // How often to sample (default 50Hz)
  retentionSeconds: number  // How long to keep data (default 60s)
  enabled: boolean
}

const DEFAULT_CONFIG: TelemetryConfig = {
  sampleRateHz: 50,
  retentionSeconds: 60,
  enabled: false
}

// Circular buffer for efficient time-series storage
class CircularBuffer<T> {
  private buffer: T[]
  private head = 0
  private tail = 0
  private count = 0
  
  constructor(private capacity: number) {
    this.buffer = new Array(capacity)
  }
  
  push(item: T): void {
    this.buffer[this.tail] = item
    this.tail = (this.tail + 1) % this.capacity
    
    if (this.count < this.capacity) {
      this.count++
    } else {
      this.head = (this.head + 1) % this.capacity
    }
  }
  
  toArray(): T[] {
    const result: T[] = []
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(this.head + i) % this.capacity])
    }
    return result
  }
  
  get length(): number {
    return this.count
  }
  
  clear(): void {
    this.head = 0
    this.tail = 0
    this.count = 0
  }
  
  resize(newCapacity: number): void {
    const data = this.toArray()
    this.capacity = newCapacity
    this.buffer = new Array(newCapacity)
    this.head = 0
    this.tail = 0
    this.count = 0
    
    // Keep only the most recent data that fits
    const start = Math.max(0, data.length - newCapacity)
    for (let i = start; i < data.length; i++) {
      this.push(data[i])
    }
  }
}

// Module memory tracking registry
const moduleRegistry = new Map<string, ModuleMemory>()

// Register a module for memory tracking
export function registerModule(name: string): void {
  if (!moduleRegistry.has(name)) {
    moduleRegistry.set(name, {
      name,
      heapUsed: 0,
      instances: 0,
      lastUpdate: Date.now()
    })
  }
  const mod = moduleRegistry.get(name)!
  mod.instances++
  mod.lastUpdate = Date.now()
}

// Unregister a module instance
export function unregisterModule(name: string): void {
  const mod = moduleRegistry.get(name)
  if (mod) {
    mod.instances = Math.max(0, mod.instances - 1)
    mod.lastUpdate = Date.now()
  }
}

// Update module memory usage (call periodically from components)
export function updateModuleMemory(name: string, heapUsed: number): void {
  const mod = moduleRegistry.get(name)
  if (mod) {
    mod.heapUsed = heapUsed
    mod.lastUpdate = Date.now()
  }
}

// Get all registered modules
export function getModules(): ModuleMemory[] {
  return Array.from(moduleRegistry.values())
}

// Telemetry service singleton
class TelemetryService {
  private config: TelemetryConfig = { ...DEFAULT_CONFIG }
  private buffer: CircularBuffer<TelemetrySnapshot>
  private intervalId: number | null = null
  private listeners: Set<(snapshot: TelemetrySnapshot) => void> = new Set()
  
  // FPS tracking
  private frameCount = 0
  private lastFpsTime = performance.now()
  private currentFps = 60
  private rafId: number | null = null
  
  // System stats cache (from slower API)
  private cachedSystemStats: {
    cpu: number
    memory: { system: number; app: { heapUsed: number; heapTotal: number; rss: number } }
    network: { rxSpeed: number; txSpeed: number }
  } | null = null
  
  constructor() {
    // Calculate buffer size based on config
    const bufferSize = this.config.sampleRateHz * this.config.retentionSeconds
    this.buffer = new CircularBuffer(bufferSize)
  }
  
  // Configure the service
  configure(config: Partial<TelemetryConfig>): void {
    const wasEnabled = this.config.enabled
    this.config = { ...this.config, ...config }
    
    // Resize buffer if retention changed
    const newBufferSize = this.config.sampleRateHz * this.config.retentionSeconds
    this.buffer.resize(newBufferSize)
    
    // Persist config
    localStorage.setItem('telemetry.config', JSON.stringify(this.config))
    
    // Start/stop based on enabled state
    if (this.config.enabled && !wasEnabled) {
      this.start()
    } else if (!this.config.enabled && wasEnabled) {
      this.stop()
    }
  }
  
  // Load saved config
  loadConfig(): TelemetryConfig {
    const saved = localStorage.getItem('telemetry.config')
    if (saved) {
      try {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) }
      } catch {
        // Ignore parse errors
      }
    }
    return this.config
  }
  
  getConfig(): TelemetryConfig {
    return { ...this.config }
  }
  
  // Start collecting telemetry
  start(): void {
    if (this.intervalId) return
    
    this.config.enabled = true
    
    // Start FPS counter
    this.startFpsCounter()
    
    // Start system stats polling (slower rate - 2Hz for actual system calls)
    this.startSystemStatsPolling()
    
    // Start high-speed sampling
    const intervalMs = 1000 / this.config.sampleRateHz
    this.intervalId = window.setInterval(() => this.sample(), intervalMs)
    
    console.log(`[Telemetry] Started at ${this.config.sampleRateHz}Hz, retention ${this.config.retentionSeconds}s`)
  }
  
  // Stop collecting
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.config.enabled = false
    console.log('[Telemetry] Stopped')
  }
  
  // Check if running
  isRunning(): boolean {
    return this.intervalId !== null
  }
  
  // Subscribe to real-time updates
  subscribe(callback: (snapshot: TelemetrySnapshot) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  
  // Get historical data
  getHistory(): TelemetrySnapshot[] {
    return this.buffer.toArray()
  }
  
  // Get current FPS (can be used externally)
  getCurrentFps(): number {
    return this.currentFps
  }
  
  // Clear all data
  clear(): void {
    this.buffer.clear()
  }
  
  private startFpsCounter(): void {
    const measureFrame = () => {
      this.frameCount++
      const now = performance.now()
      const delta = now - this.lastFpsTime
      
      // Update FPS every 100ms for smoother display
      if (delta >= 100) {
        this.currentFps = Math.round((this.frameCount / delta) * 1000)
        this.frameCount = 0
        this.lastFpsTime = now
      }
      
      if (this.config.enabled) {
        this.rafId = requestAnimationFrame(measureFrame)
      }
    }
    this.rafId = requestAnimationFrame(measureFrame)
  }
  
  private startSystemStatsPolling(): void {
    // Poll system stats at 2Hz (slower rate since it involves IPC)
    const pollStats = async () => {
      if (!this.config.enabled) return
      
      try {
        const stats = await window.electronAPI?.getSystemStats?.()
        if (stats) {
          this.cachedSystemStats = {
            cpu: stats.cpu.usage,
            memory: {
              system: stats.memory.percent,
              app: stats.app || { heapUsed: 0, heapTotal: 0, rss: 0 }
            },
            network: {
              rxSpeed: stats.network.rxSpeed,
              txSpeed: stats.network.txSpeed
            }
          }
        }
      } catch (err) {
        console.error('[Telemetry] Failed to get system stats:', err)
      }
      
      if (this.config.enabled) {
        setTimeout(pollStats, 500) // 2Hz
      }
    }
    pollStats()
  }
  
  private sample(): void {
    const snapshot: TelemetrySnapshot = {
      timestamp: Date.now(),
      fps: this.currentFps,
      cpu: this.cachedSystemStats?.cpu ?? 0,
      memory: this.cachedSystemStats?.memory ?? {
        system: 0,
        app: { heapUsed: 0, heapTotal: 0, rss: 0 }
      },
      network: this.cachedSystemStats?.network ?? { rxSpeed: 0, txSpeed: 0 },
      modules: Object.fromEntries(moduleRegistry)
    }
    
    this.buffer.push(snapshot)
    
    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (err) {
        console.error('[Telemetry] Listener error:', err)
      }
    }
  }
}

// Export singleton
export const telemetry = new TelemetryService()

// React hook for module memory tracking
export function useModuleTracker(_moduleName: string): void {
  // This will be imported and used in components
  // Implementation in the component file to avoid circular deps
}

// Export for external FPS access (faster updates)
export function getFps(): number {
  return telemetry.getCurrentFps()
}

