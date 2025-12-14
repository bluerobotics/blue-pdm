import { useState, useEffect, useRef } from 'react'
import { usePDMStore } from '../stores/pdmStore'

// 🎄 CHRISTMAS EFFECTS COMPONENT 🎅
// Adds festive magic when the Christmas theme is active

interface Snowflake {
  id: number
  x: number
  y: number
  size: number
  speed: number
  opacity: number
  wobble: number
  wobbleSpeed: number
}

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
  const sleighEnabled = usePDMStore(s => s.christmasSleighEnabled)
  const setSnowOpacity = usePDMStore(s => s.setChristmasSnowOpacity)
  const setSleighEnabled = usePDMStore(s => s.setChristmasSleighEnabled)
  
  const [snowflakes, setSnowflakes] = useState<Snowflake[]>([])
  const [stars, setStars] = useState<Star[]>([])
  const [sleighPosition, setSleighPosition] = useState({ x: -300, y: 80, visible: false })
  const [showControls, setShowControls] = useState(false)
  const animationRef = useRef<number>(0)
  const sleighTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const sleighAnimationRef = useRef<number | null>(null)
  const sleighEnabledRef = useRef(sleighEnabled) // Ref to track current value in callbacks
  
  // Keep ref in sync with state
  useEffect(() => {
    sleighEnabledRef.current = sleighEnabled
  }, [sleighEnabled])
  
  // Only render if Christmas theme is active
  const isChristmas = theme === 'christmas'
  
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
  
  // Initialize snowflakes
  useEffect(() => {
    if (!isChristmas) {
      setSnowflakes([])
      return
    }
    
    // Create initial snowflakes
    const initialFlakes: Snowflake[] = []
    for (let i = 0; i < 100; i++) {
      initialFlakes.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 4 + 2,
        speed: Math.random() * 1.5 + 0.5,
        opacity: Math.random() * 0.6 + 0.4,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: Math.random() * 0.05 + 0.02,
      })
    }
    setSnowflakes(initialFlakes)
    
    // Animate snowflakes
    const animate = () => {
      setSnowflakes(prev => prev.map(flake => {
        let newY = flake.y + flake.speed * 0.1
        let newWobble = flake.wobble + flake.wobbleSpeed
        let newX = flake.x + Math.sin(newWobble) * 0.1
        
        // Reset if off screen
        if (newY > 105) {
          newY = -5
          newX = Math.random() * 100
        }
        if (newX > 100) newX = 0
        if (newX < 0) newX = 100
        
        return {
          ...flake,
          y: newY,
          x: newX,
          wobble: newWobble,
        }
      }))
      animationRef.current = requestAnimationFrame(animate)
    }
    
    animationRef.current = requestAnimationFrame(animate)
    
    return () => {
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
      
      
      {/* Falling snowflakes - in front of background but behind UI (except they float over everything for magic!) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 9999 }}>
        {snowflakes.map(flake => (
          <div
            key={flake.id}
            className="absolute rounded-full"
            style={{
              left: `${flake.x}%`,
              top: `${flake.y}%`,
              width: `${flake.size}px`,
              height: `${flake.size}px`,
              backgroundColor: 'white',
              opacity: flake.opacity * (snowOpacity / 100), // Controlled by slider
              boxShadow: '0 0 3px rgba(255, 255, 255, 0.8)',
              filter: 'blur(0.5px)',
            }}
          />
        ))}
      </div>
      
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
                <span className="text-plm-fg">❄️ Snow</span>
                <span className="text-plm-fg-muted">{snowOpacity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={snowOpacity}
                onChange={(e) => setSnowOpacity(Number(e.target.value))}
                className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-white [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
              />
            </div>
            
            {/* Sleigh toggle */}
            <div className="flex items-center justify-between px-1">
              <span className="text-plm-fg">🛷 Sleigh</span>
              <button
                onClick={() => setSleighEnabled(!sleighEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  sleighEnabled ? 'bg-green-600' : 'bg-plm-border'
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
