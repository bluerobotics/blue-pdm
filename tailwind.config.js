/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'pdm': {
          // Deep ocean-inspired theme for Blue Robotics
          'bg': '#0a1929',
          'bg-light': '#0d2137',
          'bg-lighter': '#122a44',
          'sidebar': '#0d2137',
          'activitybar': '#071320',
          'panel': '#0a1929',
          'input': '#122a44',
          'border': '#1e3a5f',
          'border-light': '#2d4a6f',
          'fg': '#e3f2fd',
          'fg-dim': '#90caf9',
          'fg-muted': '#5c8abd',
          'accent': '#00b4d8',
          'accent-hover': '#0096c7',
          'accent-dim': '#0077b6',
          'selection': '#1565c0',
          'highlight': 'rgba(0, 180, 216, 0.15)',
          // Status colors
          'success': '#4ade80',
          'warning': '#fbbf24',
          'error': '#f87171',
          'info': '#60a5fa',
          // File state colors
          'wip': '#fbbf24',
          'released': '#4ade80',
          'inactive': '#6b7280',
          'locked': '#f87171',
        }
      },
      fontFamily: {
        'mono': ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'Monaco', 'monospace'],
        'sans': ['Inter', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      fontSize: {
        'xxs': '10px',
        'xs': '11px',
        'sm': '12px',
        'base': '13px',
        'lg': '14px',
        'xl': '16px',
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'pulse-subtle': 'pulse 3s ease-in-out infinite',
        'slide-in': 'slideIn 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(-10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
