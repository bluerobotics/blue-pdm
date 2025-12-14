import { useState, useEffect, useRef } from 'react'
import { usePDMStore } from '../stores/pdmStore'

// 🎃 HALLOWEEN EFFECTS COMPONENT 👻
// Adds spooky magic when the Halloween theme is active

interface Spark {
  id: number
  x: number
  y: number
  size: number
  speed: number
  baseOpacity: number // Original opacity (doesn't change)
  wobble: number
  wobbleSpeed: number
  color: string // orange to red gradient
}

interface Ghost {
  id: number
  x: number
  y: number
  size: number
  opacity: number
  floatSpeed: number
  floatOffset: number
}

interface Pumpkin {
  id: number
  x: number
  y: number
  size: number
  glowIntensity: number
  glowSpeed: number
}

export function HalloweenEffects() {
  const theme = usePDMStore(s => s.theme)
  const ghostsOpacity = usePDMStore(s => s.halloweenGhostsOpacity)
  const sparksOpacity = usePDMStore(s => s.halloweenSparksOpacity)
  const setGhostsOpacity = usePDMStore(s => s.setHalloweenGhostsOpacity)
  const setSparksOpacity = usePDMStore(s => s.setHalloweenSparksOpacity)
  
  const [sparks, setSparks] = useState<Spark[]>([])
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [pumpkins, setPumpkins] = useState<Pumpkin[]>([])
  const [showControls, setShowControls] = useState(false)
  const animationRef = useRef<number>(0)
  
  // Only render if Halloween theme is active
  const isHalloween = theme === 'halloween'
  
  // Spark colors - orange to red gradient
  const sparkColors = ['#ff6b2b', '#ff5500', '#ff4400', '#ff3300', '#ff8844', '#ffaa55', '#ff7733']
  
  // Initialize pumpkins (static decorations)
  useEffect(() => {
    if (!isHalloween) return
    
    const newPumpkins: Pumpkin[] = []
    for (let i = 0; i < 5; i++) {
      newPumpkins.push({
        id: i,
        x: Math.random() * 90 + 5,
        y: 95, // Near bottom
        size: Math.random() * 15 + 20,
        glowIntensity: Math.random() * 0.3 + 0.5,
        glowSpeed: Math.random() * 1 + 0.5,
      })
    }
    setPumpkins(newPumpkins)
  }, [isHalloween])
  
  // Initialize ghosts
  useEffect(() => {
    if (!isHalloween) {
      setGhosts([])
      return
    }
    
    const newGhosts: Ghost[] = []
    for (let i = 0; i < 8; i++) {
      newGhosts.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 60 + 10,
        size: Math.random() * 30 + 20,
        opacity: Math.random() * 0.3 + 0.1,
        floatSpeed: Math.random() * 0.02 + 0.01,
        floatOffset: Math.random() * Math.PI * 2,
      })
    }
    setGhosts(newGhosts)
  }, [isHalloween])
  
  // Initialize sparks and animate
  useEffect(() => {
    if (!isHalloween) {
      setSparks([])
      return
    }
    
    // Create initial sparks - spread them throughout the screen so some are visible immediately
    const initialSparks: Spark[] = []
    for (let i = 0; i < 80; i++) {
      initialSparks.push({
        id: i,
        x: Math.random() * 100, // Spread across screen
        y: Math.random() * 120, // Spread from top to below screen (some visible immediately)
        size: Math.random() * 4 + 2,
        speed: Math.random() * 2 + 1, // Faster speed (1-3)
        baseOpacity: Math.random() * 0.8 + 0.2,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: Math.random() * 0.05 + 0.02,
        color: sparkColors[Math.floor(Math.random() * sparkColors.length)],
      })
    }
    setSparks(initialSparks)
    
    // Animate sparks floating upward
    const animate = () => {
      setSparks(prev => prev.map(spark => {
        let newY = spark.y - spark.speed * 0.3 // Float upward (faster!)
        let newWobble = spark.wobble + spark.wobbleSpeed
        let newX = spark.x + Math.sin(newWobble) * 0.1 // Gentle side-to-side
        let newBaseOpacity = spark.baseOpacity
        
        // Reset if off screen top
        if (newY < -5) {
          newY = 105 + Math.random() * 10
          newX = Math.random() * 100
          newBaseOpacity = Math.random() * 0.8 + 0.2
          return {
            ...spark,
            x: newX,
            y: newY,
            wobble: newWobble,
            baseOpacity: newBaseOpacity,
            color: sparkColors[Math.floor(Math.random() * sparkColors.length)],
            size: Math.random() * 4 + 2,
            speed: Math.random() * 2 + 1,
          }
        }
        
        return {
          ...spark,
          x: newX,
          y: newY,
          wobble: newWobble,
        }
      }))
      
      // Animate ghosts floating
      setGhosts(prev => prev.map(ghost => ({
        ...ghost,
        floatOffset: ghost.floatOffset + ghost.floatSpeed,
      })))
      
      animationRef.current = requestAnimationFrame(animate)
    }
    
    animationRef.current = requestAnimationFrame(animate)
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isHalloween])
  
  if (!isHalloween) return null
  
  return (
    <>
      {/* Background gradient with spooky atmosphere - z-index negative to go behind everything */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: -10,
          background: `
            radial-gradient(ellipse at 30% 20%, rgba(139, 0, 0, 0.15) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 30%, rgba(189, 147, 249, 0.1) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 100%, rgba(255, 107, 43, 0.25) 0%, transparent 50%),
            linear-gradient(to bottom, #050505 0%, #0d0d0d 100%)
          `,
        }}
      />
      
      {/* Bonfire glow at the bottom */}
      <div 
        className="fixed inset-x-0 bottom-0 pointer-events-none"
        style={{ 
          zIndex: -9,
          height: '40%',
          background: `
            radial-gradient(ellipse 120% 60% at 50% 100%, rgba(255, 107, 43, 0.35) 0%, rgba(255, 85, 0, 0.2) 30%, transparent 70%),
            radial-gradient(ellipse 80% 40% at 50% 100%, rgba(255, 68, 0, 0.25) 0%, transparent 60%)
          `,
          animation: 'bonfireGlow 3s ease-in-out infinite',
        }}
      />
      
      {/* Secondary ambient glow - pulsing */}
      <div 
        className="fixed inset-x-0 bottom-0 pointer-events-none"
        style={{ 
          zIndex: -9,
          height: '25%',
          background: `
            radial-gradient(ellipse 100% 50% at 50% 100%, rgba(255, 140, 0, 0.2) 0%, transparent 70%)
          `,
          animation: 'bonfireGlow 2s ease-in-out infinite 0.5s',
        }}
      />
      
      {/* Moon - behind content */}
      <div 
        className="fixed pointer-events-none"
        style={{ 
          zIndex: -8,
          top: '8%',
          right: '12%',
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 40%, #fffacd 0%, #ffd700 60%, #daa520 100%)',
          boxShadow: '0 0 60px rgba(255, 215, 0, 0.4), 0 0 100px rgba(255, 215, 0, 0.2)',
          opacity: 0.9,
        }}
      >
        {/* Moon craters */}
        <div 
          style={{
            position: 'absolute',
            top: '25%',
            left: '30%',
            width: '15px',
            height: '15px',
            borderRadius: '50%',
            background: 'rgba(139, 119, 42, 0.3)',
          }}
        />
        <div 
          style={{
            position: 'absolute',
            top: '50%',
            left: '55%',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: 'rgba(139, 119, 42, 0.25)',
          }}
        />
      </div>
      
      {/* Floating ghosts - behind content but visible */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: -7 }}>
        {ghosts.map(ghost => (
          <div
            key={ghost.id}
            style={{
              position: 'absolute',
              left: `${ghost.x}%`,
              top: `${ghost.y + Math.sin(ghost.floatOffset) * 3}%`,
              width: `${ghost.size}px`,
              height: `${ghost.size * 1.3}px`,
              opacity: ghost.opacity * (ghostsOpacity / 100),
              filter: 'blur(1px)',
            }}
          >
            {/* Ghost SVG */}
            <svg viewBox="0 0 40 52" fill="white" style={{ width: '100%', height: '100%' }}>
              <path d="M20 0 C8 0 0 10 0 22 L0 42 L8 35 L16 42 L24 35 L32 42 L40 35 L40 22 C40 10 32 0 20 0 Z" 
                    fillOpacity="0.6" />
              <circle cx="12" cy="18" r="4" fill="#0d0d0d" fillOpacity="0.8" />
              <circle cx="28" cy="18" r="4" fill="#0d0d0d" fillOpacity="0.8" />
              <ellipse cx="20" cy="28" rx="5" ry="6" fill="#0d0d0d" fillOpacity="0.6" />
            </svg>
          </div>
        ))}
      </div>
      
      {/* Bonfire sparks floating upward - in front of everything! */}
      {sparksOpacity > 0 && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 9999 }}>
          {sparks.map(spark => {
            // Calculate display opacity - fade out in top 30% of screen
            let displayOpacity = spark.baseOpacity
            if (spark.y < 30) {
              displayOpacity = spark.baseOpacity * (spark.y / 30)
            }
            
            return (
              <div
                key={spark.id}
                style={{
                  position: 'absolute',
                  left: `${spark.x}%`,
                  top: `${spark.y}%`,
                  width: `${spark.size}px`,
                  height: `${spark.size}px`,
                  borderRadius: '50%',
                  backgroundColor: spark.color,
                  opacity: displayOpacity * (sparksOpacity / 100),
                  boxShadow: `0 0 ${spark.size * 2}px ${spark.color}, 0 0 ${spark.size}px ${spark.color}`,
                  filter: 'blur(0.5px)',
                }}
              />
            )
          })}
        </div>
      )}
      
      {/* Glowing pumpkins at bottom */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: -6 }}>
        {pumpkins.map(pumpkin => (
          <div
            key={pumpkin.id}
            style={{
              position: 'absolute',
              left: `${pumpkin.x}%`,
              bottom: '2%',
              width: `${pumpkin.size}px`,
              height: `${pumpkin.size * 0.9}px`,
              animation: `pumpkinGlow ${pumpkin.glowSpeed}s ease-in-out infinite`,
            }}
          >
            {/* Pumpkin SVG */}
            <svg viewBox="0 0 50 45" style={{ width: '100%', height: '100%' }}>
              {/* Stem */}
              <path d="M23 5 Q25 0 27 5 L26 10 L24 10 Z" fill="#228B22" />
              {/* Main pumpkin body */}
              <ellipse cx="25" cy="27" rx="24" ry="17" fill="#ff6b2b" />
              {/* Ridges */}
              <ellipse cx="12" cy="27" rx="8" ry="17" fill="#e85a20" />
              <ellipse cx="25" cy="27" rx="7" ry="17" fill="#ff7a40" />
              <ellipse cx="38" cy="27" rx="8" ry="17" fill="#e85a20" />
              {/* Glowing face */}
              <polygon points="15,22 20,22 17.5,28" fill="#ffb347" style={{ filter: 'drop-shadow(0 0 5px #ff6b2b)' }} />
              <polygon points="30,22 35,22 32.5,28" fill="#ffb347" style={{ filter: 'drop-shadow(0 0 5px #ff6b2b)' }} />
              <path d="M18 32 Q25 40 32 32 L30 34 Q25 38 20 34 Z" fill="#ffb347" style={{ filter: 'drop-shadow(0 0 5px #ff6b2b)' }} />
            </svg>
          </div>
        ))}
      </div>
      
      {/* Halloween controls button - always on top */}
      <div 
        className="fixed bottom-4 right-4"
        style={{ zIndex: 10001 }}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
      >
        {showControls && (
          <div className="mb-2 p-2.5 bg-plm-bg-lighter rounded-lg border border-plm-border shadow-lg text-xs min-w-[160px]">
            <div className="text-plm-fg-muted mb-2">🎃 Halloween Effects</div>
            
            {/* Ghost opacity slider */}
            <div className="mb-2 px-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-plm-fg">👻 Ghosts</span>
                <span className="text-plm-fg-muted">{ghostsOpacity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={ghostsOpacity}
                onChange={(e) => setGhostsOpacity(Number(e.target.value))}
                className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-orange-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
              />
            </div>
            
            {/* Sparks opacity slider */}
            <div className="mb-2 px-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-plm-fg">🔥 Sparks</span>
                <span className="text-plm-fg-muted">{sparksOpacity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={sparksOpacity}
                onChange={(e) => setSparksOpacity(Number(e.target.value))}
                className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-orange-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
              />
            </div>
          </div>
        )}
        <button
          onClick={() => setShowControls(s => !s)}
          className="w-10 h-10 rounded-full bg-plm-accent/20 hover:bg-plm-accent/30 border border-plm-accent/50 flex items-center justify-center text-xl transition-colors"
          title="Halloween Settings"
        >
          🎃
        </button>
      </div>
      
      {/* CSS animations */}
      <style>{`
        @keyframes pumpkinGlow {
          0%, 100% { filter: drop-shadow(0 0 8px rgba(255, 107, 43, 0.6)); }
          50% { filter: drop-shadow(0 0 15px rgba(255, 107, 43, 0.9)); }
        }
        
        @keyframes bonfireGlow {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  )
}

export default HalloweenEffects
