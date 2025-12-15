import { useState, useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'
import { fetchWeather, clearWeatherCache } from '../lib/weather'
import {
  type Snowflake,
  type WindState,
  type GustState,
  createSnowflake,
  createWindState,
  createGustState,
  updateWind,
  calculateWindForces,
  updateSnowflake,
  renderSnowflake,
  manageDensity
} from '../lib/snowPhysics'

// 🎄 CHRISTMAS EFFECTS COMPONENT 🎅
// Adds festive magic when the Christmas theme is active
// Uses Canvas for efficient GPU-accelerated snowflake rendering
// Snow physics are shared with Weather theme via snowPhysics.ts

interface Star {
  id: number
  x: number
  y: number
  size: number
  opacity: number
  twinkleSpeed: number
}


export function ChristmasEffects() {
  const theme = usePDMStore(s => s.theme)
  const snowOpacity = usePDMStore(s => s.christmasSnowOpacity)
  const snowDensity = usePDMStore(s => s.christmasSnowDensity)
  const snowSize = usePDMStore(s => s.christmasSnowSize)
  const blusteryness = usePDMStore(s => s.christmasBlusteryness)
  const useLocalWeather = usePDMStore(s => s.christmasUseLocalWeather)
  const sleighEnabled = usePDMStore(s => s.christmasSleighEnabled)
  const setSnowOpacity = usePDMStore(s => s.setChristmasSnowOpacity)
  const setSnowDensity = usePDMStore(s => s.setChristmasSnowDensity)
  const setSnowSize = usePDMStore(s => s.setChristmasSnowSize)
  const setBlusteryness = usePDMStore(s => s.setChristmasBlusteryness)
  const setUseLocalWeather = usePDMStore(s => s.setChristmasUseLocalWeather)
  const setSleighEnabled = usePDMStore(s => s.setChristmasSleighEnabled)
  
  // Use refs for snowflakes to avoid React re-renders - Canvas handles all rendering
  const snowflakesRef = useRef<Snowflake[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  const [stars, setStars] = useState<Star[]>([])
  const [sleighPosition, setSleighPosition] = useState({ x: -300, y: 80, visible: false })
  const [showControls, setShowControls] = useState(false)
  const animationRef = useRef<number>(0)
  const sleighTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const sleighAnimationRef = useRef<number | null>(null)
  const sleighEnabledRef = useRef(sleighEnabled) // Ref to track current value in callbacks
  
  // Wind state - using refs to avoid re-renders on every frame
  const windRef = useRef<WindState>(createWindState())
  const gustRef = useRef<GustState>(createGustState())
  const timeRef = useRef(0)
  
  // Use refs for slider values to avoid re-renders during animation
  // The actual state is used for the UI display, refs are used in animation loop
  const blusterynessRef = useRef(blusteryness)
  const snowOpacityRef = useRef(snowOpacity)
  const snowDensityRef = useRef(snowDensity)
  const snowSizeRef = useRef(snowSize)
  const useLocalWeatherRef = useRef(useLocalWeather)
  const nextFlakeIdRef = useRef({ current: 200 }) // For generating unique IDs when adding flakes
  const [weatherStatus, setWeatherStatus] = useState<'loading' | 'success' | 'error' | 'disabled'>('loading')
  const [displayWindSpeed, setDisplayWindSpeed] = useState<number | null>(null) // Wind speed in km/h for UI
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState<number | null>(null) // Timestamp of last update
  const [minutesAgo, setMinutesAgo] = useState<number>(0) // Minutes since last update
  const weatherFetchRef = useRef<(() => Promise<void>) | null>(null) // Ref to fetch function for manual refresh
  
  // Keep refs in sync with state
  useEffect(() => {
    sleighEnabledRef.current = sleighEnabled
  }, [sleighEnabled])
  
  useEffect(() => {
    blusterynessRef.current = blusteryness
  }, [blusteryness])
  
  useEffect(() => {
    snowOpacityRef.current = snowOpacity
  }, [snowOpacity])
  
  useEffect(() => {
    snowDensityRef.current = snowDensity
  }, [snowDensity])
  
  useEffect(() => {
    snowSizeRef.current = snowSize
  }, [snowSize])
  
  useEffect(() => {
    useLocalWeatherRef.current = useLocalWeather
  }, [useLocalWeather])
  
  // Only render if Christmas theme is active - must be defined before useEffects that use it
  const isChristmas = theme === 'christmas'
  
  // Fetch local weather data using shared weather library
  useEffect(() => {
    if (!isChristmas) return
    
    const loadWeather = async () => {
      if (!useLocalWeatherRef.current) {
        setWeatherStatus('disabled')
        windRef.current.weatherWind = 0
        return
      }
      
      setWeatherStatus('loading')
      const weather = await fetchWeather() // Uses shared weather library with caching
      
      if (weather) {
        // Normalize wind speed: 0-1 scale (50 km/h = max effect)
        windRef.current.weatherWind = Math.min(weather.windSpeed / 50, 1)
        // Weather library doesn't provide direction, so we oscillate slowly based on time
        // This creates natural-feeling direction changes
        setDisplayWindSpeed(Math.round(weather.windSpeed))
        setWeatherUpdatedAt(Date.now())
        setMinutesAgo(0)
        setWeatherStatus('success')
      } else {
        windRef.current.weatherWind = 0
        setDisplayWindSpeed(null)
        setWeatherStatus('error')
      }
    }
    
    // Store fetch function in ref for manual refresh
    weatherFetchRef.current = loadWeather
    
    loadWeather()
    
    // Refresh every 10 minutes (weather library also caches for 15 min)
    const interval = setInterval(loadWeather, 600000)
    
    return () => clearInterval(interval)
  }, [isChristmas, useLocalWeather])
  
  // Update "minutes ago" display
  useEffect(() => {
    if (!weatherUpdatedAt) return
    
    const updateMinutesAgo = () => {
      const mins = Math.floor((Date.now() - weatherUpdatedAt) / 60000)
      setMinutesAgo(mins)
    }
    
    updateMinutesAgo()
    const interval = setInterval(updateMinutesAgo, 30000) // Update every 30 seconds
    
    return () => clearInterval(interval)
  }, [weatherUpdatedAt])
  
  // Initialize stars
  useEffect(() => {
    if (!isChristmas) return
    
    const newStars: Star[] = []
    for (let i = 0; i < 50; i++) {
      newStars.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 40, // Only in top portion
        size: Math.random() * 2 + 1,
        opacity: Math.random() * 0.5 + 0.3,
        twinkleSpeed: Math.random() * 2 + 1,
      })
    }
    setStars(newStars)
  }, [isChristmas])
  
  // Note: createSnowflake, updateWind, and other snow physics functions
  // are imported from shared snowPhysics.ts library
  
  // Canvas-based snowflake animation - no React re-renders, pure GPU rendering
  useEffect(() => {
    if (!isChristmas) {
      snowflakesRef.current = []
      return
    }
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // Set canvas size to window size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    
    // Create initial snowflakes based on density setting
    const initialCount = snowDensityRef.current
    snowflakesRef.current = []
    for (let i = 0; i < initialCount; i++) {
      snowflakesRef.current.push(createSnowflake(i))
    }
    nextFlakeIdRef.current.current = initialCount
    
    let lastTime = performance.now()
    
    // Main animation loop - updates physics AND renders to canvas
    // Uses shared snow physics from snowPhysics.ts
    const animate = (currentTime: number) => {
      const deltaTime = Math.min(currentTime - lastTime, 50) // Cap delta to avoid jumps
      lastTime = currentTime
      timeRef.current += deltaTime
      
      const wind = windRef.current
      const gust = gustRef.current
      const bluster = blusterynessRef.current / 100
      const targetDensity = snowDensityRef.current
      const opacity = snowOpacityRef.current / 100
      const sizeMult = snowSizeRef.current / 100
      const useWeather = useLocalWeatherRef.current
      const time = timeRef.current
      
      // Update wind using shared physics
      updateWind(wind, gust, time, deltaTime, bluster)
      
      // Determine effective bluster based on weather vs manual setting
      let effectiveBluster: number
      if (useWeather && wind.weatherWind > 0) {
        effectiveBluster = Math.min(wind.weatherWind * 1.5, 1)
      } else {
        effectiveBluster = bluster
      }
      
      // Calculate wind forces using shared physics
      const { baseWindX, baseWindY } = calculateWindForces(
        wind, time, effectiveBluster, useWeather && wind.weatherWind > 0
      )
      
      // Handle density changes using shared function
      manageDensity(snowflakesRef.current, targetDensity, nextFlakeIdRef.current)
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      // Update and render each flake using shared physics
      for (const flake of snowflakesRef.current) {
        // Update flake physics
        updateSnowflake(flake, deltaTime, baseWindX, baseWindY, effectiveBluster, time)
        
        // Render with Christmas-specific size multiplier
        renderSnowflake(ctx, flake, canvas.width, canvas.height, opacity, sizeMult)
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
  }, [isChristmas])
  
  // Sleigh animation - flies across periodically
  useEffect(() => {
    // Clean up any existing animations/timeouts first
    if (sleighTimeoutRef.current) {
      clearTimeout(sleighTimeoutRef.current)
      sleighTimeoutRef.current = null
    }
    if (sleighAnimationRef.current) {
      cancelAnimationFrame(sleighAnimationRef.current)
      sleighAnimationRef.current = null
    }
    
    if (!isChristmas || !sleighEnabled) {
      setSleighPosition({ x: -300, y: 80, visible: false })
      return
    }
    
    const scheduleSleigh = () => {
      // Random delay between 30-90 seconds
      const delay = Math.random() * 60000 + 30000
      
      sleighTimeoutRef.current = setTimeout(() => {
        // Check ref for current value (not stale closure)
        if (!sleighEnabledRef.current) return
        
        // Start sleigh animation
        setSleighPosition({ x: -300, y: 50 + Math.random() * 60, visible: true })
        
        // Animate sleigh across screen
        let x = -300
        const animateSleigh = () => {
          // Check ref each frame
          if (!sleighEnabledRef.current) {
            setSleighPosition({ x: -300, y: 80, visible: false })
            return
          }
          
          x += 3
          setSleighPosition(prev => ({ ...prev, x }))
          
          if (x < window.innerWidth + 300) {
            sleighAnimationRef.current = requestAnimationFrame(animateSleigh)
          } else {
            setSleighPosition({ x: -300, y: 80, visible: false })
            scheduleSleigh() // Schedule next sleigh
          }
        }
        sleighAnimationRef.current = requestAnimationFrame(animateSleigh)
      }, delay)
    }
    
    // Initial sleigh after 10 seconds
    sleighTimeoutRef.current = setTimeout(() => {
      // Check ref for current value
      if (!sleighEnabledRef.current) return
      
      setSleighPosition({ x: -300, y: 60, visible: true })
      
      let x = -300
      const animateSleigh = () => {
        // Check ref each frame
        if (!sleighEnabledRef.current) {
          setSleighPosition({ x: -300, y: 80, visible: false })
          return
        }
        
        x += 3
        setSleighPosition(prev => ({ ...prev, x }))
        
        if (x < window.innerWidth + 300) {
          sleighAnimationRef.current = requestAnimationFrame(animateSleigh)
        } else {
          setSleighPosition({ x: -300, y: 80, visible: false })
          scheduleSleigh()
        }
      }
      sleighAnimationRef.current = requestAnimationFrame(animateSleigh)
    }, 10000)
    
    return () => {
      if (sleighTimeoutRef.current) {
        clearTimeout(sleighTimeoutRef.current)
      }
      if (sleighAnimationRef.current) {
        cancelAnimationFrame(sleighAnimationRef.current)
      }
    }
  }, [isChristmas, sleighEnabled])
  
  if (!isChristmas) return null
  
  return (
    <>
      {/* Background gradient with aurora effect - z-index negative to go behind everything */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: -10,
          background: `
            radial-gradient(ellipse at 20% 0%, rgba(46, 160, 67, 0.15) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 0%, rgba(196, 30, 58, 0.12) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 100%, rgba(26, 77, 46, 0.2) 0%, transparent 40%),
            linear-gradient(to bottom, #050810 0%, #0d1117 100%)
          `,
        }}
      />
      
      {/* Twinkling stars - behind content */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: -9 }}>
        {stars.map(star => (
          <div
            key={star.id}
            className="absolute rounded-full bg-white"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              opacity: star.opacity,
              animation: `twinkle ${star.twinkleSpeed}s ease-in-out infinite`,
              boxShadow: '0 0 4px rgba(255, 255, 255, 0.8)',
            }}
          />
        ))}
      </div>
      
      
      {/* Falling snowflakes - Canvas for GPU-accelerated rendering, no React re-renders */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 9999 }}
      />
      
      {/* Santa's Sleigh with Reindeer - flies over everything! */}
      {sleighPosition.visible && sleighEnabled && (
        <div
          className="fixed pointer-events-none"
          style={{
            zIndex: 10000,
            left: `${sleighPosition.x}px`,
            top: `${sleighPosition.y}px`,
            transform: 'translateY(-50%)',
            animation: 'sleighBob 1s ease-in-out infinite',
          }}
        >
          {/* Reindeer Team (4 reindeer) */}
          <svg 
            width="200" 
            height="60" 
            viewBox="0 0 200 60"
            style={{ 
              position: 'absolute', 
              right: '100%',
              top: '50%',
              transform: 'translateY(-50%)',
              marginRight: '-20px',
            }}
          >
            {/* Reindeer silhouettes */}
            {[0, 50, 100, 150].map((offset, i) => (
              <g key={i} transform={`translate(${offset}, ${i % 2 ? 5 : 0})`}>
                {/* Body */}
                <ellipse cx="25" cy="35" rx="15" ry="8" fill="#8B4513" />
                {/* Head */}
                <circle cx="38" cy="28" r="6" fill="#8B4513" />
                {/* Antlers */}
                <path d="M36 22 L34 12 L30 15 M36 22 L38 12 L42 15" stroke="#654321" strokeWidth="2" fill="none" />
                {/* Nose (Rudolph for lead reindeer) */}
                <circle cx="42" cy="28" r="2" fill={i === 3 ? '#ff0000' : '#000'} />
                {/* Legs */}
                <line x1="18" y1="42" x2="16" y2="55" stroke="#654321" strokeWidth="2" />
                <line x1="25" y1="42" x2="27" y2="55" stroke="#654321" strokeWidth="2" />
                <line x1="32" y1="42" x2="30" y2="55" stroke="#654321" strokeWidth="2" />
              </g>
            ))}
            {/* Harness lines */}
            <path d="M45 30 L95 32 L145 30 L195 32" stroke="#8B0000" strokeWidth="1.5" fill="none" />
          </svg>
          
          {/* Sleigh */}
          <svg width="120" height="80" viewBox="0 0 120 80">
            {/* Sleigh body */}
            <path 
              d="M10 30 Q0 30 5 50 L15 65 Q20 70 30 70 L100 70 Q110 70 110 60 L110 35 Q110 25 100 25 L30 25 Q20 25 10 30" 
              fill="#8B0000" 
              stroke="#5a0000"
              strokeWidth="2"
            />
            {/* Sleigh runners */}
            <path 
              d="M5 65 Q0 75 10 75 L115 75 Q125 75 120 65" 
              fill="none" 
              stroke="#C0C0C0" 
              strokeWidth="3"
            />
            {/* Decorative trim */}
            <path d="M25 25 L25 70" stroke="#FFD700" strokeWidth="2" />
            <path d="M100 25 L100 70" stroke="#FFD700" strokeWidth="2" />
            
            {/* Santa silhouette */}
            <circle cx="60" cy="15" r="12" fill="#8B0000" /> {/* Hat */}
            <circle cx="60" cy="28" r="10" fill="#FFE4C4" /> {/* Face */}
            <ellipse cx="60" cy="50" rx="20" ry="18" fill="#8B0000" /> {/* Body */}
            {/* White trim on hat */}
            <rect x="45" y="22" width="30" height="5" rx="2" fill="white" />
            <circle cx="72" cy="8" r="4" fill="white" /> {/* Pom pom */}
            {/* Belt */}
            <rect x="45" y="45" width="30" height="6" fill="black" />
            <rect x="55" y="43" width="10" height="10" rx="1" fill="#FFD700" />
            
            {/* Gift bag */}
            <ellipse cx="95" cy="45" rx="12" ry="18" fill="#228B22" />
            <path d="M88 32 Q95 25 102 32" stroke="#FFD700" strokeWidth="2" fill="none" />
          </svg>
        </div>
      )}
      
      {/* Christmas controls button - always on top */}
      <div 
        className="fixed bottom-4 right-4"
        style={{ zIndex: 10001 }}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
      >
        {showControls && (
          <div className="mb-2 p-2.5 bg-plm-bg-lighter rounded-lg border border-plm-border shadow-lg text-xs min-w-[160px]">
            <div className="text-plm-fg-muted mb-2">🎄 Christmas Effects</div>
            
            {/* Snow opacity slider */}
            <div className="mb-2 px-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-plm-fg">✨ Opacity</span>
                <span className="text-plm-fg-muted">{snowOpacity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={snowOpacity}
                onChange={(e) => setSnowOpacity(Number(e.target.value))}
                className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#c41e3a] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/30"
              />
            </div>
            
            {/* Snow density slider */}
            <div className="mb-2 px-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-plm-fg">❄️ Density</span>
                <span className="text-plm-fg-muted">{snowDensity}</span>
              </div>
              <input
                type="range"
                min="10"
                max="200"
                value={snowDensity}
                onChange={(e) => setSnowDensity(Number(e.target.value))}
                className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#c41e3a] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/30"
              />
            </div>
            
            {/* Snow size slider */}
            <div className="mb-2 px-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-plm-fg">📏 Size</span>
                <span className="text-plm-fg-muted">{snowSize}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="200"
                value={snowSize}
                onChange={(e) => setSnowSize(Number(e.target.value))}
                className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#c41e3a] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/30"
              />
            </div>
            
            {/* Wind slider */}
            <div className={`mb-2 px-1 ${useLocalWeather ? 'opacity-40' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-plm-fg">💨 Wind</span>
                <span className="text-plm-fg-muted">
                  {useLocalWeather ? 'auto' : `${blusteryness}%`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={blusteryness}
                onChange={(e) => setBlusteryness(Number(e.target.value))}
                disabled={useLocalWeather}
                className={`w-full h-1.5 bg-plm-border rounded-full appearance-none ${useLocalWeather ? 'cursor-not-allowed' : 'cursor-pointer'} [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#c41e3a] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/30`}
              />
            </div>
            
            {/* Local weather toggle */}
            <div className="px-1 mb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-plm-fg">🌍 Local Wind</span>
                  {useLocalWeather && (
                    <span className={`text-[10px] px-1 rounded ${
                      weatherStatus === 'success' ? 'bg-[#2ea043]/30 text-[#4ade80]' :
                      weatherStatus === 'loading' ? 'bg-[#d4a72c]/30 text-[#fbbf24]' :
                      weatherStatus === 'error' ? 'bg-[#c41e3a]/30 text-[#f87171]' :
                      'bg-plm-border text-plm-fg-muted'
                    }`}>
                      {weatherStatus === 'success' && displayWindSpeed !== null 
                        ? `${displayWindSpeed} km/h` 
                        : weatherStatus === 'loading' ? '...' 
                        : weatherStatus === 'error' ? '✗' : '–'}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setUseLocalWeather(!useLocalWeather)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    useLocalWeather ? 'bg-[#c41e3a]' : 'bg-plm-border'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      useLocalWeather ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              {/* Updated time and refresh button */}
              {useLocalWeather && weatherStatus === 'success' && (
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-plm-fg-muted">
                    {minutesAgo === 0 ? 'just now' : `${minutesAgo} min ago`}
                  </span>
                  <button
                    onClick={() => {
                      clearWeatherCache() // Force fresh fetch
                      weatherFetchRef.current?.()
                    }}
                    className="p-1 rounded hover:bg-plm-border/50 text-plm-fg-muted hover:text-plm-fg transition-colors"
                    title="Refresh weather"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
              )}
            </div>
            
            {/* Sleigh toggle */}
            <div className="flex items-center justify-between px-1">
              <span className="text-plm-fg">🛷 Sleigh</span>
              <button
                onClick={() => setSleighEnabled(!sleighEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  sleighEnabled ? 'bg-[#c41e3a]' : 'bg-plm-border'
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    sleighEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        )}
        <button
          onClick={() => setShowControls(s => !s)}
          className="w-10 h-10 rounded-full bg-plm-accent/20 hover:bg-plm-accent/30 border border-plm-accent/50 flex items-center justify-center text-xl transition-colors"
          title="Christmas Settings"
        >
          🎄
        </button>
      </div>
      
      {/* CSS animations */}
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        
        @keyframes sleighBob {
          0%, 100% { transform: translateY(-50%) rotate(-2deg); }
          50% { transform: translateY(calc(-50% - 5px)) rotate(2deg); }
        }
      `}</style>
    </>
  )
}

export default ChristmasEffects
