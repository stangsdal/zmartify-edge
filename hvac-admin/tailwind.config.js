/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#301E96',
          secondary: '#67FBFF',
          accent: '#7D85FF',
          neutral: '#F1F2F2',
          surface: '#FFFFFF',
          darkBg: '#121212',
          darkCard: '#1E1E1E',
        },
        alert: {
          critical: '#b42318',
          warning: '#b54708',
          info: '#175cd3',
        },
      },
      fontFamily: {
        poppins: ['Poppins', 'ui-sans-serif', 'system-ui'],
      },
      borderRadius: {
        xl2: '1.1rem',
      },
      boxShadow: {
        soft: '0 10px 30px rgba(48, 30, 150, 0.14)',
      },
    },
  },
  plugins: [],
}

