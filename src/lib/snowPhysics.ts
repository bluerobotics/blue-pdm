/**
 * Shared Snow Physics Library
 * Used by both Christmas and Weather themes for consistent snow behavior
 */

// Snowflake interface for Canvas-based rendering
export interface Snowflake {
  id: number
  x: number  // 0-100 percentage
  y: number  // 0-100 percentage
  vx: number  // Horizontal velocity
  vy: number  // Vertical velocity (falling speed)
  size: number
  baseSpeed: number  // Base falling speed
  opacity: number
  mass: number  // Larger flakes are heavier, less affected by wind
}

// Wind simulation state
export interface WindState {
  baseWind: number       // Slow-changing base wind (-1 to 1)
  gustStrength: number   // Current gust strength (0 to 1)
  gustDirection: number  // Gust direction in radians
  turbulence: number     // High-frequency noise
  weatherWind: number    // Wind speed from weather API (0-1 normalized)
}

// Gust state for wind simulation
export interface GustState {
  nextGustTime: number
  gustDuration: number
}

/**
 * Smooth noise function using multiple sine waves (approximates Perlin noise)
 * Creates organic, natural-looking variation
 */
export function smoothNoise(t: number, octaves: number = 3): number {
  let value = 0
  let amplitude = 1
  let frequency = 1
  let maxValue = 0
  
  for (let i = 0; i < octaves; i++) {
    value += Math.sin(t * frequency * 0.1) * amplitude
    value += Math.sin(t * frequency * 0.157 + 1.7) * amplitude * 0.5
    value += Math.sin(t * frequency * 0.0731 + 2.9) * amplitude * 0.3
    maxValue += amplitude * 1.8
    amplitude *= 0.5
    frequency *= 2
  }
  
  return value / maxValue
}

/**
 * 2D spatial noise for position-based wind variation
 * Creates a wind field where different screen areas have slightly different wind
 * This makes the snow look more realistic with swirls and eddies
 */
export function spatialNoise(x: number, y: number, t: number): { dx: number, dy: number } {
  // Multiple overlapping wave patterns create organic spatial variation
  const scale1 = 0.02  // Large swirls
  const scale2 = 0.05  // Medium eddies
  const scale3 = 0.12  // Small turbulence
  const timeScale = 0.0002  // Time-varying offsets so the wind field evolves
  
  // Layer 1: Large slow-moving patterns
  const dx1 = Math.sin(x * scale1 + t * timeScale) * Math.cos(y * scale1 * 0.7 + t * timeScale * 0.8)
  const dy1 = Math.cos(x * scale1 * 0.8 + t * timeScale * 1.1) * Math.sin(y * scale1 + t * timeScale * 0.9) * 0.3
  
  // Layer 2: Medium patterns
  const dx2 = Math.sin(x * scale2 + y * scale2 * 0.5 + t * timeScale * 2) * 0.5
  const dy2 = Math.cos(y * scale2 + x * scale2 * 0.3 + t * timeScale * 1.8) * 0.15
  
  // Layer 3: Small fast-changing turbulence
  const dx3 = Math.sin(x * scale3 + t * timeScale * 5) * Math.sin(y * scale3 * 1.3 + t * timeScale * 4) * 0.25
  const dy3 = Math.cos(x * scale3 * 0.9 + t * timeScale * 4.5) * Math.cos(y * scale3 + t * timeScale * 5.5) * 0.08
  
  return {
    dx: dx1 + dx2 + dx3,
    dy: dy1 + dy2 + dy3
  }
}

/**
 * Create a new snowflake with random properties
 */
export function createSnowflake(id: number, startY?: number): Snowflake {
  const size = Math.random() * 4 + 2
  return {
    id,
    x: Math.random() * 100,
    y: startY ?? Math.random() * 100,
    vx: 0,
    vy: 0,
    size,
    baseSpeed: Math.random() * 1.2 + 0.4,
    opacity: Math.random() * 0.6 + 0.4,
    mass: size / 6, // Larger flakes are heavier (0.33 to 1)
  }
}

/**
 * Create initial wind state
 */
export function createWindState(): WindState {
  return {
    baseWind: 0,
    gustStrength: 0,
    gustDirection: 0,
    turbulence: 0,
    weatherWind: 0,
  }
}

/**
 * Create initial gust state
 */
export function createGustState(): GustState {
  return {
    nextGustTime: Math.random() * 3000 + 2000,
    gustDuration: 0
  }
}

/**
 * Update wind simulation
 * @param wind - Current wind state (will be mutated)
 * @param gust - Current gust state (will be mutated)
 * @param time - Current animation time in ms
 * @param deltaTime - Time since last frame in ms
 * @param blusteryness - Manual blusteryness setting (0-1)
 * @param useWeather - Whether to use weather-based wind
 */
export function updateWind(
  wind: WindState,
  gust: GustState,
  time: number,
  deltaTime: number,
  blusteryness: number
): void {
  // Base wind - uses multiple slow-changing noise layers
  const slowDrift = smoothNoise(time * 0.00015, 2)
  const mediumDrift = smoothNoise(time * 0.0004 + 50, 2) * 0.4
  wind.baseWind = (slowDrift + mediumDrift) * (0.3 + blusteryness * 0.7)
  
  // High-frequency turbulence
  wind.turbulence = smoothNoise(time * 0.003, 2) * blusteryness * 0.5
  
  // Gust system - random bursts of wind
  gust.nextGustTime -= deltaTime
  
  if (gust.nextGustTime <= 0 && wind.gustStrength < 0.1) {
    // Start a new gust
    wind.gustStrength = 0.6 + Math.random() * 0.4
    wind.gustDirection = (Math.random() - 0.5) * Math.PI * 0.67
    gust.gustDuration = 600 + Math.random() * 1400
    
    // Schedule next gust - more frequent when blustery
    const minDelay = 2000 - blusteryness * 1500
    const maxDelay = 6000 - blusteryness * 4000
    gust.nextGustTime = minDelay + Math.random() * (maxDelay - minDelay)
  }
  
  // Decay gust over time
  if (wind.gustStrength > 0) {
    gust.gustDuration -= deltaTime
    if (gust.gustDuration <= 0) {
      wind.gustStrength *= 0.93
      if (wind.gustStrength < 0.01) wind.gustStrength = 0
    }
  }
}

/**
 * Calculate wind forces for a frame
 * @returns Object with x and y wind forces
 */
export function calculateWindForces(
  wind: WindState,
  time: number,
  effectiveBluster: number,
  useWeather: boolean
): { baseWindX: number, baseWindY: number, weatherWindX: number, weatherWindY: number } {
  const gustForceX = Math.cos(wind.gustDirection) * wind.gustStrength * effectiveBluster
  const gustForceY = Math.sin(wind.gustDirection) * wind.gustStrength * effectiveBluster * 0.3
  
  let weatherWindX = 0
  let weatherWindY = 0
  
  if (useWeather && wind.weatherWind > 0) {
    // Weather wind direction slowly oscillates
    const weatherDir = smoothNoise(time * 0.00005, 2) * Math.PI * 0.5
    weatherWindX = Math.cos(weatherDir) * wind.weatherWind * 1.2
    weatherWindY = Math.sin(weatherDir) * wind.weatherWind * 0.25
  }
  
  const baseWindX = (wind.baseWind + wind.turbulence + gustForceX) * effectiveBluster + weatherWindX
  const baseWindY = gustForceY * effectiveBluster + weatherWindY
  
  return { baseWindX, baseWindY, weatherWindX, weatherWindY }
}

/**
 * Update a single snowflake's physics
 * @param flake - Snowflake to update (will be mutated)
 * @param deltaTime - Time since last frame in ms
 * @param baseWindX - Base horizontal wind force
 * @param baseWindY - Base vertical wind force
 * @param effectiveBluster - Current effective blusteryness (0-1)
 * @param time - Current animation time for spatial noise
 */
export function updateSnowflake(
  flake: Snowflake,
  deltaTime: number,
  baseWindX: number,
  baseWindY: number,
  effectiveBluster: number,
  time: number
): void {
  // Wind force - smaller/lighter flakes are more affected
  const windInfluence = 1 - (flake.mass * 0.5)
  
  // Get spatial wind variation based on flake position
  const spatial = spatialNoise(flake.x, flake.y, time)
  const spatialStrength = effectiveBluster * 0.6
  
  // Combine global wind with spatial variation
  const totalWindX = baseWindX + spatial.dx * spatialStrength
  const totalWindY = baseWindY + spatial.dy * spatialStrength
  
  // Target velocity based on wind
  const targetVx = totalWindX * windInfluence * 3
  const targetVy = flake.baseSpeed + totalWindY * windInfluence
  
  // Smoothly interpolate velocity (inertia)
  const inertia = 0.92 + flake.mass * 0.05
  flake.vx = flake.vx * inertia + targetVx * (1 - inertia)
  flake.vy = flake.vy * inertia + targetVy * (1 - inertia)
  
  // Update position
  flake.x += flake.vx * deltaTime * 0.01
  flake.y += flake.vy * deltaTime * 0.01
  
  // Reset if off screen (bottom)
  if (flake.y > 105) {
    flake.x = Math.random() * 100
    flake.y = -5
    flake.vx = 0
    flake.vy = 0
  }
  
  // Wrap horizontally
  if (flake.x > 105) flake.x = -5
  if (flake.x < -5) flake.x = 105
}

/**
 * Render a snowflake to a canvas context
 */
export function renderSnowflake(
  ctx: CanvasRenderingContext2D,
  flake: Snowflake,
  canvasWidth: number,
  canvasHeight: number,
  opacity: number,
  sizeMult: number = 1
): void {
  const screenX = (flake.x / 100) * canvasWidth
  const screenY = (flake.y / 100) * canvasHeight
  const finalOpacity = flake.opacity * opacity
  const renderSize = flake.size * sizeMult
  
  // Main snowflake
  ctx.beginPath()
  ctx.arc(screenX, screenY, renderSize, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(255, 255, 255, ${finalOpacity})`
  ctx.fill()
  
  // Subtle glow
  ctx.beginPath()
  ctx.arc(screenX, screenY, renderSize + 1, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(255, 255, 255, ${finalOpacity * 0.3})`
  ctx.fill()
}

/**
 * Manage snowflake array density
 * @param flakes - Array of snowflakes (will be mutated)
 * @param targetDensity - Target number of snowflakes
 * @param nextId - Reference to next available ID
 * @returns Updated nextId value
 */
export function manageDensity(
  flakes: Snowflake[],
  targetDensity: number,
  nextId: { current: number }
): void {
  const currentCount = flakes.length
  
  if (currentCount < targetDensity) {
    const toAdd = Math.min(5, targetDensity - currentCount)
    for (let i = 0; i < toAdd; i++) {
      flakes.push(createSnowflake(nextId.current++, Math.random() * 100))
    }
  } else if (currentCount > targetDensity) {
    const toRemove = Math.min(5, currentCount - targetDensity)
    flakes.splice(0, toRemove)
  }
}

