/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#164C68',
          secondary: '#20B9D5',
          accent: '#0BB7AE',
          positive: '#22CF71',
          neutral: '#F5F8FA',
          surface: '#FFFFFF',
          darkBg: '#0E3449',
          darkCard: '#123E53',
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
        soft: '0 10px 30px rgba(14, 52, 73, 0.12)',
      },
    },
  },
  plugins: [],
}

