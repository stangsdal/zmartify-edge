import { Redirect, Route, useLocation } from 'react-router-dom';
import { IonTabs, IonRouterOutlet } from '@ionic/react';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { RoomsPage } from './pages/RoomsPage';
import { RoomDetailPage } from './pages/RoomDetailPage';
import { HistoryPage } from './pages/HistoryPage';
import { AlertsPage } from './pages/AlertsPage';
import { SettingsPage } from './pages/SettingsPage';
import { OfflineIndicator } from './components/OfflineIndicator';
import { BottomNavigation } from './components/BottomNavigation';

export function App() {
  const location = useLocation();
  const appBase = '/app';
  const publicRoutePrefixes = [`${appBase}/login`, `${appBase}/setup`];
  const isPublicRoute = publicRoutePrefixes.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`)
  );

  return (
    <>
      <OfflineIndicator />
      <IonTabs>
      <IonRouterOutlet>
        <Route exact path={`${appBase}/login`} component={LoginPage} />
        <Route exact path={`${appBase}/home`} component={HomePage} />
        <Route exact path={`${appBase}/rooms`} component={RoomsPage} />
        <Route exact path={`${appBase}/rooms/:zoneRef`} component={RoomDetailPage} />
        <Route exact path={`${appBase}/history`} component={HistoryPage} />
        <Route exact path={`${appBase}/alerts`} component={AlertsPage} />
        <Route exact path={`${appBase}/settings`} component={SettingsPage} />

        <Route exact path={`${appBase}/dashboard`} render={() => <Redirect to={`${appBase}/home`} />} />
        <Route exact path={`${appBase}/domains`} render={() => <Redirect to={`${appBase}/settings`} />} />
        <Route exact path={`${appBase}/sites`} render={() => <Redirect to={`${appBase}/settings`} />} />
        <Route exact path={`${appBase}/devices`} render={() => <Redirect to={`${appBase}/rooms`} />} />
        <Route exact path={`${appBase}/devices/:id/history`} render={() => <Redirect to={`${appBase}/history`} />} />
        <Route exact path={`${appBase}/notifications`} render={() => <Redirect to={`${appBase}/alerts`} />} />

        <Route exact path="/" render={() => <Redirect to={`${appBase}/home`} />} />
        <Route exact path={appBase} render={() => <Redirect to={`${appBase}/home`} />} />
      </IonRouterOutlet>

      {!isPublicRoute && <BottomNavigation appBase={appBase} />}
    </IonTabs>
    </>
  );
}

export default App;
