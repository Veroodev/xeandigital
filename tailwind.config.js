/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './lib/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        cream: '#F4F0EA',
        lemon: '#FFE600',
        neon: '#A3FF2E',
        aqua: '#00F0FF',
        blaze: '#FF5C00',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // Hard drop shadow tanpa blur
      boxShadow: {
        'brutal-sm': '3px 3px 0px 0px #000',
        brutal: '5px 5px 0px 0px #000',
        'brutal-lg': '8px 8px 0px 0px #000',
      },
      keyframes: {
        blink: { '0%, 49%': { opacity: '1' }, '50%, 100%': { opacity: '0' } },
        hop: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        blink: 'blink 1s steps(1, end) infinite',
        hop: 'hop 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
