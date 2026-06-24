import React from 'react';
import ReactDOM from 'react-dom/client';
import { IonApp, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';
import './main.css';
import './mobile-ui.css';
import App from './App';

setupIonicReact();

const storedTheme = localStorage.getItem('theme_mode');
if (storedTheme === 'dark') {
  document.body.classList.add('dark-mode');
} else if (storedTheme === 'light') {
  document.body.classList.remove('dark-mode');
} else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.body.classList.add('dark-mode');
}

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swVersion = '20260624-3';
    const swUrl = `/app/sw.js?v=${swVersion}`;
    fetch(swUrl, { cache: 'no-store' })
      .then((res) => {
        const mime = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok || !mime.includes('javascript')) {
          throw new Error(`unsupported service worker response (status=${res.status}, mime=${mime || 'unknown'})`);
        }
        return navigator.serviceWorker.register(swUrl, { scope: '/app/' });
      })
      .then((registration) => {
        console.log('[App] Service Worker registered:', registration.scope);

        // Check for updates periodically
        setInterval(() => {
          registration.update();
        }, 60000); // Check every minute
      })
      .catch((error) => {
        console.warn('[App] Service Worker registration skipped:', error);
      });

    // Listen for controller change (new SW activated)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <IonApp>
      <IonReactRouter>
        <App />
      </IonReactRouter>
    </IonApp>
  </React.StrictMode>
);
