/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#04060f',
          800: '#070a1a',
          700: '#0a0e27',
          600: '#10153a',
          500: '#161c4a',
        },
        neon: {
          cyan: '#00ffff',
          magenta: '#ff00aa',
          green: '#00ff88',
          purple: '#a855f7',
          amber: '#ffb800',
          red: '#ff3860',
        },
        glass: {
          DEFAULT: 'rgba(8, 12, 32, 0.55)',
          border: 'rgba(0, 255, 255, 0.18)',
        },
      },
      fontFamily: {
        display: ['Orbitron', 'system-ui', 'sans-serif'],
        sans: ['"HarmonyOS Sans"', '"PingFang SC"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'neon-cyan': '0 0 12px rgba(0,255,255,0.45), 0 0 32px rgba(0,255,255,0.18)',
        'neon-magenta': '0 0 12px rgba(255,0,170,0.45), 0 0 32px rgba(255,0,170,0.18)',
        'neon-green': '0 0 12px rgba(0,255,136,0.45), 0 0 32px rgba(0,255,136,0.18)',
        'panel': '0 4px 24px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,255,255,0.12)',
      },
      backgroundImage: {
        'grid-cyan': 'linear-gradient(rgba(0,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,255,0.07) 1px, transparent 1px)',
        'scanline': 'repeating-linear-gradient(180deg, rgba(0,255,255,0.04) 0px, rgba(0,255,255,0.04) 1px, transparent 1px, transparent 3px)',
        'radial-glow': 'radial-gradient(ellipse at center, rgba(0,255,255,0.18), transparent 70%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'flicker': 'flicker 4s linear infinite',
        'scan': 'scan 6s linear infinite',
        'spin-slow': 'spin 12s linear infinite',
        'breathe': 'breathe 2.4s ease-in-out infinite',
        'data-flow': 'data-flow 2.6s linear infinite',
      },
      keyframes: {
        flicker: {
          '0%, 19%, 21%, 23%, 25%, 54%, 56%, 100%': { opacity: '1' },
          '20%, 22%, 24%, 55%': { opacity: '0.65' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        breathe: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,56,96,0.6)' },
          '50%': { boxShadow: '0 0 0 14px rgba(255,56,96,0)' },
        },
        'data-flow': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '0 -120px' },
        },
      },
    },
  },
  plugins: [],
};
