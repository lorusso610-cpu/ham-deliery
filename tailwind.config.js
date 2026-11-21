/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        ham: {
          gold: '#F59E0B',
          goldBright: '#FBBF24',
          ink: '#09090B',
          surface: '#111114',
          card: '#18181B',
          border: '#27272A',
        },
      },
    },
  },
  plugins: [],
}
