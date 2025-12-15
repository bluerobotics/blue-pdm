/**
 * Weather Service - Fetches local weather data for dynamic theming
 * Uses Open-Meteo API (free, no API key required)
 * 
 * IMPORTANT: This module is designed to fail gracefully.
 * Any errors will return null/defaults and never crash the app.
 */

export interface WeatherData {
  condition: WeatherCondition
  temperature: number // Celsius
  isDay: boolean
  windSpeed: number // km/h
  humidity: number // %
  cloudCover: number // %
  precipitation: number // mm
  weatherCode: number
  location?: { lat: number; lon: number }
}

export type WeatherCondition = 
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavy-rain'
  | 'snow'
  | 'heavy-snow'
  | 'thunderstorm'
  | 'unknown'

// WMO Weather interpretation codes to condition mapping
// https://open-meteo.com/en/docs
function weatherCodeToCondition(code: number | undefined | null): WeatherCondition {
  try {
    if (code === undefined || code === null || typeof code !== 'number') return 'unknown'
    if (code === 0) return 'clear'
    if (code === 1 || code === 2) return 'partly-cloudy'
    if (code === 3) return 'cloudy'
    if (code >= 45 && code <= 48) return 'fog'
    if (code >= 51 && code <= 55) return 'drizzle'
    if (code >= 56 && code <= 57) return 'drizzle' // Freezing drizzle
    if (code >= 61 && code <= 63) return 'rain'
    if (code >= 65 && code <= 67) return 'heavy-rain'
    if (code >= 71 && code <= 75) return 'snow'
    if (code === 77) return 'snow' // Snow grains
    if (code >= 80 && code <= 82) return 'rain' // Rain showers
    if (code >= 85 && code <= 86) return 'heavy-snow'
    if (code >= 95 && code <= 99) return 'thunderstorm'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

// Cache weather data to avoid excessive API calls
let weatherCache: { data: WeatherData; timestamp: number } | null = null
const CACHE_DURATION = 15 * 60 * 1000 // 15 minutes

// Track if we've had repeated failures to avoid spamming
let failureCount = 0
const MAX_FAILURES = 3
const FAILURE_BACKOFF = 5 * 60 * 1000 // 5 minutes backoff after max failures
let lastFailureTime = 0

// Get user's geolocation
async function getGeolocation(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null)
        return
      }

      // Set a timeout in case geolocation hangs
      const timeoutId = setTimeout(() => {
        resolve(null)
      }, 6000)

      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timeoutId)
          try {
            if (position?.coords?.latitude && position?.coords?.longitude) {
              resolve({
                lat: position.coords.latitude,
                lon: position.coords.longitude
              })
            } else {
              resolve(null)
            }
          } catch {
            resolve(null)
          }
        },
        () => {
          clearTimeout(timeoutId)
          resolve(null)
        },
        { timeout: 5000, maximumAge: 30 * 60 * 1000 }
      )
    } catch {
      resolve(null)
    }
  })
}

// Fallback: Get approximate location from IP (using free service)
async function getLocationFromIP(): Promise<{ lat: number; lon: number } | null> {
  try {
    // Check if fetch is available
    if (typeof fetch === 'undefined') return null

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch('https://ipapi.co/json/', { 
      signal: controller.signal
    })
    clearTimeout(timeoutId)

    if (!response.ok) return null

    const data = await response.json()
    if (data?.latitude && data?.longitude && 
        typeof data.latitude === 'number' && 
        typeof data.longitude === 'number') {
      return { lat: data.latitude, lon: data.longitude }
    }
    return null
  } catch {
    // Silently fail - this is expected if offline or blocked
    return null
  }
}

/**
 * Fetch current weather for user's location
 * Returns null on any error - never throws
 */
export async function fetchWeather(): Promise<WeatherData | null> {
  try {
    // Check if we're in a failure backoff period
    if (failureCount >= MAX_FAILURES) {
      if (Date.now() - lastFailureTime < FAILURE_BACKOFF) {
        return weatherCache?.data || null
      }
      // Reset failure count after backoff
      failureCount = 0
    }

    // Check cache first
    if (weatherCache && Date.now() - weatherCache.timestamp < CACHE_DURATION) {
      return weatherCache.data
    }

    // Check if fetch is available
    if (typeof fetch === 'undefined') {
      return null
    }

    // Try geolocation first, then fall back to IP
    let location = await getGeolocation()
    if (!location) {
      location = await getLocationFromIP()
    }
    
    if (!location) {
      // Can't determine location - use cached data if available
      return weatherCache?.data || null
    }

    // Fetch weather from Open-Meteo
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,relative_humidity_2m,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m&timezone=auto`
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(url, {
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      failureCount++
      lastFailureTime = Date.now()
      return weatherCache?.data || null
    }

    const data = await response.json()
    
    // Validate response structure
    if (!data?.current) {
      failureCount++
      lastFailureTime = Date.now()
      return weatherCache?.data || null
    }

    const current = data.current

    // Build weather data with safe defaults
    const weatherData: WeatherData = {
      condition: weatherCodeToCondition(current.weather_code),
      temperature: typeof current.temperature_2m === 'number' ? current.temperature_2m : 20,
      isDay: current.is_day === 1,
      windSpeed: typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : 0,
      humidity: typeof current.relative_humidity_2m === 'number' ? current.relative_humidity_2m : 50,
      cloudCover: typeof current.cloud_cover === 'number' ? current.cloud_cover : 0,
      precipitation: typeof current.precipitation === 'number' ? current.precipitation : 0,
      weatherCode: typeof current.weather_code === 'number' ? current.weather_code : 0,
      location
    }

    // Update cache and reset failure count on success
    weatherCache = { data: weatherData, timestamp: Date.now() }
    failureCount = 0
    
    console.log('[Weather] Fetched:', weatherData.condition, weatherData.isDay ? 'day' : 'night', `${weatherData.temperature}°C`)
    
    return weatherData
  } catch (err) {
    // Log but don't throw - always return gracefully
    console.warn('[Weather] Failed to fetch (this is okay):', err instanceof Error ? err.message : 'Unknown error')
    failureCount++
    lastFailureTime = Date.now()
    return weatherCache?.data || null
  }
}

/**
 * Get weather-based theme colors
 * All themes are dark/easy-on-the-eyes - never light mode
 * Returns safe defaults if weather data is invalid
 */
export function getWeatherThemeColors(weather: WeatherData | null | undefined): Record<string, string> {
  // Default colors (dark theme) if weather is unavailable
  const defaults = {
    '--plm-bg': '#181818',
    '--plm-bg-light': '#1f1f1f',
    '--plm-bg-lighter': '#252526',
    '--plm-bg-secondary': '#1f1f1f',
    '--plm-sidebar': '#181818',
    '--plm-activitybar': '#151515',
    '--plm-panel': '#181818',
    '--plm-input': '#252526',
    '--plm-border': '#2b2b2b',
    '--plm-border-light': '#323232',
    '--plm-fg': '#cccccc',
    '--plm-fg-dim': '#b4b4b4',
    '--plm-fg-muted': '#7d7d7d',
    '--plm-accent': '#0078d4',
    '--plm-accent-hover': '#1177bb',
    '--plm-accent-dim': '#005a9e',
    '--plm-selection': 'rgba(0, 120, 212, 0.3)',
    '--plm-highlight': 'rgba(0, 120, 212, 0.15)',
    '--plm-success': '#4ade80',
    '--plm-warning': '#dcdcaa',
    '--plm-error': '#f87171',
    '--plm-info': '#0078d4',
    '--plm-wip': '#dcdcaa',
    '--plm-released': '#4ade80',
    '--plm-in-review': '#0078d4',
    '--plm-obsolete': '#6b7280',
    '--plm-locked': '#f87171',
  }

  // Return defaults if no weather data
  if (!weather) return defaults

  try {
    const { condition, isDay, temperature, windSpeed } = weather
    
    // Base colors that change with weather
    let bg = '#181818'
    let bgLight = '#1f1f1f'
    let bgLighter = '#252526'
    let accent = '#0078d4'
    let accentHover = '#1177bb'
    let fg = '#cccccc'
    let fgDim = '#b4b4b4'
    let border = '#2b2b2b'
    
    // Day vs night base adjustment
    if (isDay) {
      bg = '#1a1918'
      bgLight = '#211f1d'
    } else {
      bg = '#14161a'
      bgLight = '#1a1d22'
      bgLighter = '#22262d'
    }
    
    // Condition-specific theming
    switch (condition) {
      case 'clear':
        if (isDay) {
          bg = '#1c1916'
          bgLight = '#252019'
          bgLighter = '#2e281f'
          accent = '#f59e0b'
          accentHover = '#d97706'
          fg = '#fef3c7'
          fgDim = '#d4c7a5'
          border = '#3d3425'
        } else {
          bg = '#0f1219'
          bgLight = '#161b26'
          bgLighter = '#1d2433'
          accent = '#8b5cf6'
          accentHover = '#7c3aed'
          fg = '#e2e8f0'
          fgDim = '#94a3b8'
          border = '#2d3548'
        }
        break
        
      case 'partly-cloudy':
        if (isDay) {
          bg = '#1a1917'
          bgLight = '#232119'
          bgLighter = '#2c291f'
          accent = '#eab308'
          accentHover = '#ca8a04'
          fg = '#f5f0e1'
          fgDim = '#c4baa0'
          border = '#38332a'
        } else {
          bg = '#121620'
          bgLight = '#181d2a'
          bgLighter = '#1f2636'
          accent = '#60a5fa'
          accentHover = '#3b82f6'
          fg = '#dbe4f0'
          fgDim = '#9ca8bc'
          border = '#2a3344'
        }
        break
        
      case 'cloudy':
      case 'overcast':
        bg = '#171819'
        bgLight = '#1e2021'
        bgLighter = '#262829'
        accent = '#64748b'
        accentHover = '#475569'
        fg = '#c8cdd3'
        fgDim = '#9ba3ad'
        border = '#2e3135'
        break
        
      case 'fog':
        bg = '#18191c'
        bgLight = '#1f2124'
        bgLighter = '#27292d'
        accent = '#78a8c4'
        accentHover = '#5a8fad'
        fg = '#c5ccd4'
        fgDim = '#98a1ab'
        border = '#2d3038'
        break
        
      case 'drizzle':
        bg = '#151719'
        bgLight = '#1b1e21'
        bgLighter = '#222629'
        accent = '#38bdf8'
        accentHover = '#0ea5e9'
        fg = '#cad5e0'
        fgDim = '#8fa4b8'
        border = '#283038'
        break
        
      case 'rain':
        bg = '#131619'
        bgLight = '#181c21'
        bgLighter = '#1e242a'
        accent = '#06b6d4'
        accentHover = '#0891b2'
        fg = '#c1d4e2'
        fgDim = '#7da4bf'
        border = '#24323e'
        break
        
      case 'heavy-rain':
        bg = '#111417'
        bgLight = '#161a1f'
        bgLighter = '#1c2126'
        accent = '#0284c7'
        accentHover = '#0369a1'
        fg = '#b8cee0'
        fgDim = '#6896b5'
        border = '#1f2d3b'
        break
        
      case 'snow':
        bg = '#161a1d'
        bgLight = '#1c2125'
        bgLighter = '#23292e'
        accent = '#7dd3fc'
        accentHover = '#38bdf8'
        fg = '#e4edf4'
        fgDim = '#a3c2d6'
        border = '#2a3540'
        break
        
      case 'heavy-snow':
        bg = '#181c1f'
        bgLight = '#1f2428'
        bgLighter = '#272d32'
        accent = '#bae6fd'
        accentHover = '#7dd3fc'
        fg = '#f0f6fa'
        fgDim = '#b0c9da'
        border = '#303942'
        break
        
      case 'thunderstorm':
        bg = '#12101a'
        bgLight = '#1a1824'
        bgLighter = '#22202f'
        accent = '#a855f7'
        accentHover = '#9333ea'
        fg = '#ddd6f3'
        fgDim = '#a498c4'
        border = '#302a44'
        break
        
      default:
        // Unknown - use neutral dark
        break
    }
    
    // Wind intensity affects accent brightness
    if (typeof windSpeed === 'number' && windSpeed > 30) {
      const windAccent = '#14b8a6'
      accent = windSpeed > 50 ? windAccent : safeBlendColors(accent, windAccent, 0.3)
    }
    
    // Temperature affects warmth of foreground
    if (typeof temperature === 'number') {
      if (temperature > 25) {
        fg = safeBlendColors(fg, '#fef3c7', 0.15)
        fgDim = safeBlendColors(fgDim, '#d4c090', 0.15)
      } else if (temperature < 0) {
        fg = safeBlendColors(fg, '#e0f2fe', 0.15)
        fgDim = safeBlendColors(fgDim, '#a0c9e0', 0.15)
      }
    }
    
    return {
      '--plm-bg': bg,
      '--plm-bg-light': bgLight,
      '--plm-bg-lighter': bgLighter,
      '--plm-bg-secondary': bgLight,
      '--plm-sidebar': bg,
      '--plm-activitybar': safeDarken(bg, 0.1),
      '--plm-panel': bg,
      '--plm-input': bgLighter,
      '--plm-border': border,
      '--plm-border-light': safeLighten(border, 0.15),
      '--plm-fg': fg,
      '--plm-fg-dim': fgDim,
      '--plm-fg-muted': safeDarken(fgDim, 0.3),
      '--plm-accent': accent,
      '--plm-accent-hover': accentHover,
      '--plm-accent-dim': safeDarken(accent, 0.2),
      '--plm-selection': safeHexToRgba(accent, 0.3),
      '--plm-highlight': safeHexToRgba(accent, 0.15),
      '--plm-success': '#4ade80',
      '--plm-warning': isDay ? '#fbbf24' : '#dcdcaa',
      '--plm-error': '#f87171',
      '--plm-info': accent,
      '--plm-wip': isDay ? '#fbbf24' : '#dcdcaa',
      '--plm-released': '#4ade80',
      '--plm-in-review': accent,
      '--plm-obsolete': '#6b7280',
      '--plm-locked': '#f87171',
    }
  } catch {
    // Return defaults on any error
    return defaults
  }
}

// Helper: Safely blend two hex colors
function safeBlendColors(color1: string, color2: string, ratio: number): string {
  try {
    if (!color1 || !color2 || typeof color1 !== 'string' || typeof color2 !== 'string') {
      return color1 || '#888888'
    }
    const r1 = parseInt(color1.slice(1, 3), 16) || 0
    const g1 = parseInt(color1.slice(3, 5), 16) || 0
    const b1 = parseInt(color1.slice(5, 7), 16) || 0
    
    const r2 = parseInt(color2.slice(1, 3), 16) || 0
    const g2 = parseInt(color2.slice(3, 5), 16) || 0
    const b2 = parseInt(color2.slice(5, 7), 16) || 0
    
    const r = Math.round(r1 + (r2 - r1) * ratio)
    const g = Math.round(g1 + (g2 - g1) * ratio)
    const b = Math.round(b1 + (b2 - b1) * ratio)
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  } catch {
    return color1 || '#888888'
  }
}

// Helper: Safely darken a hex color
function safeDarken(hex: string, amount: number): string {
  try {
    if (!hex || typeof hex !== 'string') return '#000000'
    const r = Math.max(0, Math.round((parseInt(hex.slice(1, 3), 16) || 0) * (1 - amount)))
    const g = Math.max(0, Math.round((parseInt(hex.slice(3, 5), 16) || 0) * (1 - amount)))
    const b = Math.max(0, Math.round((parseInt(hex.slice(5, 7), 16) || 0) * (1 - amount)))
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  } catch {
    return '#000000'
  }
}

// Helper: Safely lighten a hex color
function safeLighten(hex: string, amount: number): string {
  try {
    if (!hex || typeof hex !== 'string') return '#ffffff'
    const r = Math.min(255, Math.round((parseInt(hex.slice(1, 3), 16) || 0) * (1 + amount)))
    const g = Math.min(255, Math.round((parseInt(hex.slice(3, 5), 16) || 0) * (1 + amount)))
    const b = Math.min(255, Math.round((parseInt(hex.slice(5, 7), 16) || 0) * (1 + amount)))
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  } catch {
    return '#ffffff'
  }
}

// Helper: Safely convert hex to rgba
function safeHexToRgba(hex: string, alpha: number): string {
  try {
    if (!hex || typeof hex !== 'string') return `rgba(128, 128, 128, ${alpha})`
    const r = parseInt(hex.slice(1, 3), 16) || 128
    const g = parseInt(hex.slice(3, 5), 16) || 128
    const b = parseInt(hex.slice(5, 7), 16) || 128
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  } catch {
    return `rgba(128, 128, 128, ${alpha})`
  }
}

/**
 * Get a human-readable description of current weather
 */
export function getWeatherDescription(weather: WeatherData | null | undefined): string {
  try {
    if (!weather) return 'Weather unavailable'
    
    const { condition, isDay, temperature } = weather
    
    const conditionNames: Record<WeatherCondition, string> = {
      'clear': isDay ? 'Sunny' : 'Clear Night',
      'partly-cloudy': 'Partly Cloudy',
      'cloudy': 'Cloudy',
      'overcast': 'Overcast',
      'fog': 'Foggy',
      'drizzle': 'Light Rain',
      'rain': 'Rainy',
      'heavy-rain': 'Heavy Rain',
      'snow': 'Snowy',
      'heavy-snow': 'Heavy Snow',
      'thunderstorm': 'Thunderstorm',
      'unknown': 'Unknown'
    }
    
    const temp = typeof temperature === 'number' ? Math.round(temperature) : '?'
    return `${conditionNames[condition] || 'Unknown'} • ${temp}°C`
  } catch {
    return 'Weather unavailable'
  }
}

/**
 * Clear the weather cache to force a refresh
 */
export function clearWeatherCache(): void {
  try {
    weatherCache = null
    failureCount = 0
  } catch {
    // Ignore
  }
}
