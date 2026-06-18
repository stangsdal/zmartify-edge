# Ionic React PWA - HVAC Edge Admin

This is the Phase 1 Ionic React PWA for HVAC Edge Gateway administration.

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

## Build for Edge Deployment

```bash
npm run build
```

Output goes to `dist/` folder, which will be served at `http://edge-host:8080/app/`

## Phase 2+ Roadmap

- Add remaining screens (Domains, Sites, Devices, MQTT Clients, System)
- PWA service worker + offline shell
- Add Capacitor iOS support (`npm install @capacitor/ios`)
- Cloud API abstraction layer

## API Configuration

The app reads from:
- `localStorage['api_base_url']` - defaults to `http://hvac-edge:443`
- `localStorage['admin_api_token']` - Bearer token for protected endpoints

Login screen allows configuring these values.
