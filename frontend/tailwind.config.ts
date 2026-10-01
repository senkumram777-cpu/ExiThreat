import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          900: '#0d0d1a',
          800: '#1a1a2e',
          700: '#16213e',
          600: '#0f3460',
        },
        accent: {
          red: '#e94560',
          teal: '#00b4d8',
        },
      },
      fontFamily: {
        mono: ['Courier New', 'Courier', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
