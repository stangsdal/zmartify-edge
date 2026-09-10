# Zmartify Web and Mobile App

The Ionic React application is shared by the Zmartify web experience and the
Capacitor iOS and Android applications.

## Project Structure

```
src/
  api/           - TypeScript API clients for edge backend
  components/    - Reusable React components
  pages/         - App screens (Login, Dashboard, Domains, Devices, etc.)
  state/         - Global state management (ready for Zustand/Redux)
  types/         - TypeScript interfaces
  App.tsx        - Main app with routing
  main.tsx       - React entry point
```

## Development

```bash
npm install
npm run dev
```

Browse to `http://localhost:5173`

## Web Build

```bash
npm run build
```

Output goes to `dist/` folder, which will be served at `http://edge-host:8080/app/`

## iOS

Requirements:

- Node.js 24 or newer
- Full Xcode selected with `xcode-select`
- An Apple development team configured in Xcode for device or archive builds

Build the native web bundle, sync Capacitor, and open Xcode:

```bash
npm run cap:ios
```

Create a release archive after signing has been configured:

```bash
npm run ios:build
```

The native build uses relative asset paths and `https://api.zmartify.dk`. The
normal `npm run build` command remains the web deployment build and keeps the
`/app/` asset base.

## API Configuration

The web app reads from:
- `localStorage['api_base_url']` - defaults to the current HTTPS origin; set `VITE_API_BASE_URL` only for an explicit API host
- `localStorage['admin_api_token']` - Bearer token for protected endpoints

The web login screen allows configuring these values. Native builds use the
public API endpoint configured in `.env.native` and do not expose API setup in
the login screen.
