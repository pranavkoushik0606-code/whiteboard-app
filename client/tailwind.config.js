/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    screens: { xs: '475px', sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    extend: {
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#fdf2ff', 100: '#fae8ff', 200: '#f5d0fe', 300: '#f0abfc', 400: '#e879f9',
          500: '#d946ef', 600: '#a855f7', 700: '#7e22ce', 800: '#6b21a8', 900: '#581c87',
        },
        coral: { 100: '#ffe4e6', 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48' },
        amber: { 100: '#fef3c7', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
        lime: { 100: '#ecfccb', 300: '#bef264', 400: '#a3e635', 500: '#84cc16', 600: '#65a30d' },
        sky: { 100: '#e0f2fe', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' },
        accent: {
          50: '#fdf4ff', 100: '#fae8ff', 300: '#f0abfc', 400: '#e879f9',
          500: '#d946ef', 600: '#c026d3', 700: '#a21caf',
        },
        aqua: {
          100: '#cffafe', 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2',
        },
      },
      borderRadius: { xl: '1rem', '2xl': '1.5rem', '3xl': '2rem' },
      boxShadow: {
        glow: '0 0 0 1px rgba(99,102,241,.18), 0 10px 30px -8px rgba(99,102,241,.45)',
        'glow-lg': '0 0 0 1px rgba(99,102,241,.22), 0 24px 60px -14px rgba(168,85,247,.55)',
        soft: '0 1px 2px rgba(16,24,40,.04), 0 12px 32px -12px rgba(16,24,40,.22)',
      },
      keyframes: {
        drift: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(3%,-4%,0) scale(1.08)' },
          '66%': { transform: 'translate3d(-3%,3%,0) scale(.95)' },
        },
        shimmer: { '0%': { backgroundPosition: '0% 50%' }, '100%': { backgroundPosition: '200% 50%' } },
        'pop-in': {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(28px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'drop-in': {
          '0%': { opacity: '0', transform: 'translate(-50%,-14px) scale(.94)' },
          '100%': { opacity: '1', transform: 'translate(-50%,0) scale(1)' },
        },
        wiggle: {
          '0%,100%': { transform: 'rotate(-2deg)' },
          '50%': { transform: 'rotate(2deg)' },
        },
        aurora: {
          '0%,100%': { filter: 'hue-rotate(0deg)' },
          '50%': { filter: 'hue-rotate(35deg)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(99,102,241,.45)' },
          '70%': { boxShadow: '0 0 0 12px rgba(99,102,241,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(99,102,241,0)' },
        },
      },
      animation: {
        drift: 'drift 22s ease-in-out infinite',
        shimmer: 'shimmer 3.5s linear infinite',
        'pop-in': 'pop-in .45s cubic-bezier(.21,1.02,.73,1) both',
        float: 'float 4s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite',
        'slide-in-right': 'slide-in-right .35s cubic-bezier(.21,1.02,.73,1) both',
        'drop-in': 'drop-in .35s cubic-bezier(.21,1.02,.73,1) both',
        wiggle: 'wiggle .4s ease-in-out',
        aurora: 'aurora 14s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
