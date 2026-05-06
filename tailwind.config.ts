import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: [
          '"Hiragino Mincho ProN"',
          '"Yu Mincho"',
          '"游明朝"',
          '"Noto Serif JP"',
          'Georgia',
          'serif',
        ],
        sans: [
          '"Hiragino Sans"',
          '"Yu Gothic UI"',
          '"游ゴシック"',
          '"Noto Sans JP"',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          '"JetBrains Mono"',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        surface: 'hsl(var(--surface) / <alpha-value>)',
      },
      letterSpacing: {
        tighter: '-0.02em',
        wider: '0.14em',
        widest: '0.22em',
      },
      transitionTimingFunction: {
        'out-strong': 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
