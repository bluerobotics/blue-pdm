import { useEffect, useState, useRef, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'
import { fetchWeather, getWeatherThemeColors, getWeatherDescription, clearWeatherCache, type WeatherData } from '../lib/weather'
import {
  type Snowflake,
  type WindState,
  type GustState,
  createSnowflake,
  createWindState,
  createGustState,
  updateWind,
  updateSnowflake,
  renderSnowflake,
  manageDensity,
  smoothNoise
} from '../lib/snowPhysics'

/**
 * WeatherEffects component
 * Applies dynamic theme colors based on local weather conditions
 * Also displays subtle weather-based visual effects with wind physics
 * 
 * Snow physics are shared with Christmas theme via snowPhysics.ts
 * 
 * IMPORTANT: This component is designed to fail gracefully.
 * Any errors will be caught and the component will render nothing.
 * The app will never crash due to weather-related issues.
 */

// Rain drop interface
interface RainDrop {
  x: number
  y: number
  vx: number
  vy: number
  length: number
  opacity: number
}

export function WeatherEffects() {
  try {
    return <WeatherEffectsInner />
  } catch (err) {
    console.warn('[WeatherEffects] Render error (this is okay):', err)
    return null
  }
}

function WeatherEffectsInner() {
  const theme = usePDMStore(s => s.theme)
  const user = usePDMStore(s => s.user)
  const isOfflineMode = usePDMStore(s => s.isOfflineMode)
  
  // Weather theme settings from store
  const rainOpacity = usePDMStore(s => s.weatherRainOpacity)
  const rainDensity = usePDMStore(s => s.weatherRainDensity)
  const snowOpacity = usePDMStore(s => s.weatherSnowOpacity)
  const snowDensity = usePDMStore(s => s.weatherSnowDensity)
  const effectsEnabled = usePDMStore(s => s.weatherEffectsEnabled)
  const setRainOpacity = usePDMStore(s => s.setWeatherRainOpacity)
  const setRainDensity = usePDMStore(s => s.setWeatherRainDensity)
  const setSnowOpacity = usePDMStore(s => s.setWeatherSnowOpacity)
  const setSnowDensity = usePDMStore(s => s.setWeatherSnowDensity)
  const setEffectsEnabled = usePDMStore(s => s.setWeatherEffectsEnabled)
  
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [hasError, setHasError] = useState(false)
  const [, setIsTransitioning] = useState(false)
  const [showControls, setShowControls] = useState(false)
  const [minutesAgo, setMinutesAgo] = useState<number>(0)
  const previousColorsRef = useRef<Record<string, string> | null>(null)
  const isMountedRef = useRef(true)
  const weatherUpdatedAtRef = useRef<number | null>(null)
  
  // Refs for slider values (avoid re-renders during animation)
  const rainOpacityRef = useRef(rainOpacity)
  const rainDensityRef = useRef(rainDensity)
  const snowOpacityRef = useRef(snowOpacity)
  const snowDensityRef = useRef(snowDensity)
  const effectsEnabledRef = useRef(effectsEnabled)
  const weatherRef = useRef<WeatherData | null>(null)
  
  // Keep refs in sync
  useEffect(() => { rainOpacityRef.current = rainOpacity }, [rainOpacity])
  useEffect(() => { rainDensityRef.current = rainDensity }, [rainDensity])
  useEffect(() => { snowOpacityRef.current = snowOpacity }, [snowOpacity])
  useEffect(() => { snowDensityRef.current = snowDensity }, [snowDensity])
  useEffect(() => { effectsEnabledRef.current = effectsEnabled }, [effectsEnabled])
  useEffect(() => { weatherRef.current = weather }, [weather])
  
  const isActive = theme === 'weather' && (!!user || isOfflineMode)
  
  // Reset error state when theme changes
  useEffect(() => {
    if (!isActive) {
      setHasError(false)
    }
  }, [isActive])
  
  // Fetch weather data
  const loadWeather = useCallback(async () => {
    try {
      const data = await fetchWeather()
      if (isMountedRef.current && data) {
        setWeather(data)
        weatherUpdatedAtRef.current = Date.now()
        setMinutesAgo(0)
        console.log('[WeatherEffects] Weather loaded:', {
          condition: data.condition,
          isDay: data.isDay,
          temp: data.temperature,
          wind: data.windSpeed
        })
      }
    } catch (err) {
      console.warn('[WeatherEffects] Load error (this is okay):', err)
    }
  }, [])
  
  // Initial fetch and periodic updates
  useEffect(() => {
    if (!isActive || hasError) {
      try {
        if (previousColorsRef.current) {
          document.documentElement.removeAttribute('data-weather')
          document.documentElement.removeAttribute('data-weather-day')
          previousColorsRef.current = null
        }
      } catch { /* ignore */ }
      return
    }
    
    isMountedRef.current = true
    loadWeather()
    const interval = setInterval(loadWeather, 15 * 60 * 1000)
    
    return () => {
      isMountedRef.current = false
      clearInterval(interval)
    }
  }, [isActive, hasError, loadWeather])
  
  // Update minutes ago
  useEffect(() => {
    if (!weatherUpdatedAtRef.current) return
    
    const updateMinutesAgo = () => {
      if (weatherUpdatedAtRef.current) {
        const mins = Math.floor((Date.now() - weatherUpdatedAtRef.current) / 60000)
        setMinutesAgo(mins)
      }
    }
    
    const interval = setInterval(updateMinutesAgo, 30000)
    return () => clearInterval(interval)
  }, [weather])
  
  // Apply weather theme colors
  useEffect(() => {
    if (!isActive || !weather) return
    
    try {
      const colors = getWeatherThemeColors(weather)
      if (!colors || typeof colors !== 'object') return
      
      setIsTransitioning(true)
      
      const root = document.documentElement
      if (!root) return
      
      root.setAttribute('data-weather', weather.condition || 'unknown')
      root.setAttribute('data-weather-day', weather.isDay ? 'true' : 'false')
      
      Object.entries(colors).forEach(([key, value]) => {
        try {
          if (key && value && typeof key === 'string' && typeof value === 'string') {
            root.style.setProperty(key, value)
          }
        } catch { /* ignore */ }
      })
      
      previousColorsRef.current = colors
      
      const timeoutId = setTimeout(() => {
        if (isMountedRef.current) {
          setIsTransitioning(false)
        }
      }, 500)
      
      try {
        const bgColor = colors['--plm-bg']
        const fgColor = colors['--plm-fg']
        if (bgColor && fgColor) {
          window.electronAPI?.setTitleBarOverlay?.({
            color: bgColor,
            symbolColor: fgColor
          })
        }
      } catch { /* ignore */ }
      
      return () => clearTimeout(timeoutId)
    } catch (err) {
      console.warn('[WeatherEffects] Apply colors error:', err)
    }
  }, [isActive, weather])
  
  // Clean up when theme changes
  useEffect(() => {
    try {
      if (!isActive && previousColorsRef.current) {
        const root = document.documentElement
        if (root) {
          root.removeAttribute('data-weather')
          root.removeAttribute('data-weather-day')
          Object.keys(previousColorsRef.current).forEach((key) => {
            try { root.style.removeProperty(key) } catch { /* ignore */ }
          })
        }
        previousColorsRef.current = null
      }
    } catch { /* ignore */ }
  }, [isActive])
  
  if (!isActive || hasError) return null
  
  const getWeatherIcon = (): string => {
    try {
      if (!weather?.condition) return '🌤️'
      switch (weather.condition) {
        case 'clear': return weather.isDay ? '☀️' : '🌙'
        case 'partly-cloudy': return weather.isDay ? '⛅' : '☁️'
        case 'cloudy':
        case 'overcast': return '☁️'
        case 'fog': return '🌫️'
        case 'drizzle': return '🌦️'
        case 'rain':
        case 'heavy-rain': return '🌧️'
        case 'snow':
        case 'heavy-snow': return '❄️'
        case 'thunderstorm': return '⛈️'
        default: return '🌤️'
      }
    } catch { return '🌤️' }
  }
  
  const isRainy = weather?.condition === 'rain' || weather?.condition === 'heavy-rain' || weather?.condition === 'drizzle'
  const isSnowy = weather?.condition === 'snow' || weather?.condition === 'heavy-snow'
  
  return (
    <>
      {/* Rain effect - Canvas-based with wind physics */}
      {effectsEnabled && isRainy && (
        <RainCanvas 
          weather={weather}
          densityRef={rainDensityRef}
          opacityRef={rainOpacityRef}
        />
      )}
      
      {/* Snow effect - Canvas-based with wind physics (shared with Christmas) */}
      {effectsEnabled && isSnowy && (
        <SnowCanvas
          weather={weather}
          densityRef={snowDensityRef}
          opacityRef={snowOpacityRef}
        />
      )}
      
      {/* Lightning flash */}
      {effectsEnabled && weather?.condition === 'thunderstorm' && <LightningEffect />}
      
      {/* Fog overlay */}
      {effectsEnabled && weather?.condition === 'fog' && <FogEffect />}
      
      {/* Settings panel - bottom right corner */}
      <div 
        className="fixed bottom-4 right-4"
        style={{ zIndex: 10001 }}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
      >
        {showControls && (
          <div className="mb-2 p-2.5 bg-plm-bg-lighter rounded-lg border border-plm-border shadow-lg text-xs min-w-[180px]">
            <div className="text-plm-fg-muted mb-2 flex items-center gap-2">
              <span className="text-base">{getWeatherIcon()}</span>
              <span>Weather Effects</span>
            </div>
            
            {/* Weather info */}
            {weather && (
              <div className="px-1 mb-2 pb-2 border-b border-plm-border">
                <div className="flex items-center justify-between text-plm-fg">
                  <span>{Math.round(weather.temperature)}°C</span>
                  <span className="text-plm-fg-muted capitalize">{weather.condition?.replace('-', ' ')}</span>
                </div>
                <div className="flex items-center justify-between text-plm-fg-muted mt-0.5">
                  <span>💨 {Math.round(weather.windSpeed)} km/h</span>
                  <div className="flex items-center gap-1">
                    <span>{minutesAgo === 0 ? 'just now' : `${minutesAgo}m ago`}</span>
                    <button
                      onClick={() => {
                        clearWeatherCache()
                        loadWeather()
                      }}
                      className="p-0.5 rounded hover:bg-plm-border/50 text-plm-fg-muted hover:text-plm-fg transition-colors"
                      title="Refresh weather"
                    >
                      <RefreshCw size={10} />
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {/* Effects toggle */}
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-plm-fg">✨ Effects</span>
              <button
                onClick={() => setEffectsEnabled(!effectsEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  effectsEnabled ? 'bg-green-600' : 'bg-plm-border'
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    effectsEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            
            {effectsEnabled && (
              <>
                {/* Rain settings - only show if rainy */}
                {isRainy && (
                  <>
                    <div className="mb-2 px-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-plm-fg">🌧️ Rain Opacity</span>
                        <span className="text-plm-fg-muted">{rainOpacity}%</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={rainOpacity}
                        onChange={(e) => setRainOpacity(Number(e.target.value))}
                        className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-blue-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-400 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
                      />
                    </div>
                    
                    <div className="mb-2 px-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-plm-fg">💧 Rain Density</span>
                        <span className="text-plm-fg-muted">{rainDensity}</span>
                      </div>
                      <input
                        type="range"
                        min="20"
                        max="200"
                        value={rainDensity}
                        onChange={(e) => setRainDensity(Number(e.target.value))}
                        className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-blue-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-400 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
                      />
                    </div>
                  </>
                )}
                
                {/* Snow settings - only show if snowy */}
                {isSnowy && (
                  <>
                    <div className="mb-2 px-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-plm-fg">❄️ Snow Opacity</span>
                        <span className="text-plm-fg-muted">{snowOpacity}%</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={snowOpacity}
                        onChange={(e) => setSnowOpacity(Number(e.target.value))}
                        className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-white [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
                      />
                    </div>
                    
                    <div className="mb-2 px-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-plm-fg">🌨️ Snow Density</span>
                        <span className="text-plm-fg-muted">{snowDensity}</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="150"
                        value={snowDensity}
                        onChange={(e) => setSnowDensity(Number(e.target.value))}
                        className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-white [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
                      />
                    </div>
                  </>
                )}
                
                {/* Wind indicator */}
                {weather && (isRainy || isSnowy) && (
                  <div className="px-1 pt-1 border-t border-plm-border/50 text-plm-fg-muted">
                    <div className="flex items-center gap-1">
                      <span>💨</span>
                      <span>Wind affects {isRainy ? 'rain' : 'snow'} direction</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        
        <button
          onClick={() => setShowControls(s => !s)}
          className="w-10 h-10 rounded-full bg-plm-accent/20 hover:bg-plm-accent/30 border border-plm-accent/50 flex items-center justify-center text-xl transition-colors"
          title={getWeatherDescription(weather)}
        >
          {getWeatherIcon()}
        </button>
      </div>
    </>
  )
}

// Canvas-based rain with wind physics (uses shared wind from snowPhysics.ts)
function RainCanvas({ 
  weather, 
  densityRef, 
  opacityRef 
}: { 
  weather: WeatherData | null
  densityRef: React.MutableRefObject<number>
  opacityRef: React.MutableRefObject<number>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const dropsRef = useRef<RainDrop[]>([])
  const windRef = useRef<WindState>(createWindState())
  const gustRef = useRef<GustState>(createGustState())
  const timeRef = useRef(0)
  
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    
    // Initialize rain drops
    const createDrop = (): RainDrop => ({
      x: Math.random() * 120 - 10,
      y: Math.random() * -20,
      vx: 0,
      vy: 15 + Math.random() * 10,
      length: 15 + Math.random() * 20,
      opacity: 0.4 + Math.random() * 0.4
    })
    
    const initialCount = densityRef.current
    dropsRef.current = Array.from({ length: initialCount }, createDrop)
    dropsRef.current.forEach(d => d.y = Math.random() * 100)
    
    let lastTime = performance.now()
    
    const animate = (currentTime: number) => {
      const deltaTime = Math.min(currentTime - lastTime, 50)
      lastTime = currentTime
      timeRef.current += deltaTime
      
      // Get wind from weather
      const windSpeed = weather?.windSpeed ?? 0
      windRef.current.weatherWind = Math.min(windSpeed / 50, 1)
      
      const wind = windRef.current
      const gust = gustRef.current
      const time = timeRef.current
      const bluster = wind.weatherWind
      
      // Update wind using shared physics
      updateWind(wind, gust, time, deltaTime, bluster)
      
      // Calculate total wind force for rain
      const gustForceX = Math.cos(wind.gustDirection) * wind.gustStrength * bluster
      const baseWindX = (wind.baseWind + wind.turbulence + gustForceX) * bluster
      
      // Weather direction (slow oscillation)
      const weatherDir = smoothNoise(time * 0.0001, 2) * Math.PI * 0.3
      const weatherWindX = Math.cos(weatherDir) * bluster * 1.5
      
      const totalWindX = baseWindX + weatherWindX
      
      // Handle density changes
      const targetDensity = densityRef.current
      const currentCount = dropsRef.current.length
      
      if (currentCount < targetDensity) {
        const toAdd = Math.min(5, targetDensity - currentCount)
        for (let i = 0; i < toAdd; i++) {
          dropsRef.current.push(createDrop())
        }
      } else if (currentCount > targetDensity) {
        const toRemove = Math.min(5, currentCount - targetDensity)
        dropsRef.current.splice(0, toRemove)
      }
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      const opacity = opacityRef.current / 100
      
      // Update and render drops
      for (const drop of dropsRef.current) {
        // Wind affects horizontal velocity (rain is affected more than snow)
        const targetVx = totalWindX * 4 // Rain gets pushed more by wind
        drop.vx = drop.vx * 0.92 + targetVx * 0.08
        
        // Update position
        drop.x += drop.vx * deltaTime * 0.01
        drop.y += drop.vy * deltaTime * 0.01
        
        // Reset if off screen
        if (drop.y > 105) {
          drop.x = Math.random() * 120 - 10
          drop.y = Math.random() * -10
          drop.vx = totalWindX * 2
        }
        
        // Wrap horizontally
        if (drop.x > 105) drop.x = -5
        if (drop.x < -5) drop.x = 105
        
        // Calculate screen position
        const screenX = (drop.x / 100) * canvas.width
        const screenY = (drop.y / 100) * canvas.height
        
        // Calculate rain angle based on wind (rain shows wind angle more dramatically)
        const angle = Math.atan2(drop.vy, drop.vx + drop.vx * 0.5) // Emphasize wind angle
        const endX = screenX + Math.cos(angle) * drop.length
        const endY = screenY + Math.sin(angle) * drop.length
        
        // Draw rain drop as angled line
        ctx.beginPath()
        ctx.moveTo(screenX, screenY)
        ctx.lineTo(endX, endY)
        ctx.strokeStyle = `rgba(150, 200, 255, ${drop.opacity * opacity})`
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.stroke()
        
        // Subtle glow
        ctx.beginPath()
        ctx.moveTo(screenX, screenY)
        ctx.lineTo(endX, endY)
        ctx.strokeStyle = `rgba(100, 180, 255, ${drop.opacity * opacity * 0.3})`
        ctx.lineWidth = 4
        ctx.stroke()
      }
      
      animationRef.current = requestAnimationFrame(animate)
    }
    
    animationRef.current = requestAnimationFrame(animate)
    
    return () => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [weather])
  
  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 9998 }}
    />
  )
}

// Canvas-based snow with wind physics (uses shared snowPhysics.ts)
function SnowCanvas({ 
  weather, 
  densityRef, 
  opacityRef 
}: { 
  weather: WeatherData | null
  densityRef: React.MutableRefObject<number>
  opacityRef: React.MutableRefObject<number>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const snowflakesRef = useRef<Snowflake[]>([])
  const windRef = useRef<WindState>(createWindState())
  const gustRef = useRef<GustState>(createGustState())
  const timeRef = useRef(0)
  const nextFlakeIdRef = useRef({ current: 0 })
  
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    
    // Initialize snowflakes using shared function
    const initialCount = densityRef.current
    snowflakesRef.current = []
    for (let i = 0; i < initialCount; i++) {
      snowflakesRef.current.push(createSnowflake(i))
    }
    nextFlakeIdRef.current.current = initialCount
    
    let lastTime = performance.now()
    
    const animate = (currentTime: number) => {
      const deltaTime = Math.min(currentTime - lastTime, 50)
      lastTime = currentTime
      timeRef.current += deltaTime
      
      // Get wind from weather
      const windSpeed = weather?.windSpeed ?? 0
      windRef.current.weatherWind = Math.min(windSpeed / 50, 1)
      
      const wind = windRef.current
      const gust = gustRef.current
      const time = timeRef.current
      const bluster = wind.weatherWind
      
      // Update wind using shared physics
      updateWind(wind, gust, time, deltaTime, bluster)
      
      // Calculate wind forces
      const gustForceX = Math.cos(wind.gustDirection) * wind.gustStrength * bluster
      const gustForceY = Math.sin(wind.gustDirection) * wind.gustStrength * bluster * 0.3
      const weatherDir = smoothNoise(time * 0.00005, 2) * Math.PI * 0.5
      const weatherWindX = Math.cos(weatherDir) * bluster * 1.2
      const weatherWindY = Math.sin(weatherDir) * bluster * 0.25
      const baseWindX = (wind.baseWind + wind.turbulence + gustForceX) * bluster + weatherWindX
      const baseWindY = gustForceY * bluster + weatherWindY
      
      // Handle density changes using shared function
      manageDensity(snowflakesRef.current, densityRef.current, nextFlakeIdRef.current)
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      const opacity = opacityRef.current / 100
      
      // Update and render flakes using shared physics
      for (const flake of snowflakesRef.current) {
        updateSnowflake(flake, deltaTime, baseWindX, baseWindY, bluster, time)
        renderSnowflake(ctx, flake, canvas.width, canvas.height, opacity)
      }
      
      animationRef.current = requestAnimationFrame(animate)
    }
    
    animationRef.current = requestAnimationFrame(animate)
    
    return () => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [weather])
  
  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 9999 }}
    />
  )
}

// Lightning flash effect
function LightningEffect() {
  const [flash, setFlash] = useState(false)
  
  useEffect(() => {
    try {
      const triggerFlash = () => {
        if (Math.random() > 0.7) {
          setFlash(true)
          setTimeout(() => setFlash(false), 100)
          if (Math.random() > 0.5) {
            setTimeout(() => {
              setFlash(true)
              setTimeout(() => setFlash(false), 50)
            }, 150)
          }
        }
      }
      
      const interval = setInterval(triggerFlash, 8000 + Math.random() * 12000)
      return () => clearInterval(interval)
    } catch {
      return undefined
    }
  }, [])
  
  if (!flash) return null
  
  return (
    <div className="fixed inset-0 pointer-events-none z-50 bg-white/10 transition-opacity duration-100" />
  )
}

// Fog overlay effect
function FogEffect() {
  return (
    <div className="fixed inset-0 pointer-events-none z-40">
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          background: 'linear-gradient(135deg, transparent 0%, rgba(200, 200, 200, 0.3) 50%, transparent 100%)',
          animation: 'fog-drift 30s ease-in-out infinite',
        }}
      />
    </div>
  )
}
