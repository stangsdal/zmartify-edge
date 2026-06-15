import { useEffect, useState } from 'react';
import { Redirect, Route, useLocation } from 'react-router-dom';
import { IonTabs, IonRouterOutlet } from '@ionic/react';
import { authApi } from './api/auth';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { RoomsPage } from './pages/RoomsPage';
import { RoomDetailPage } from './pages/RoomDetailPage';
import { HistoryPage } from './pages/HistoryPage';
import { AlertsPage } from './pages/AlertsPage';
import { SettingsPage } from './pages/SettingsPage';
import { DashboardPage } from './pages/DashboardPage';
import { DomainsPage } from './pages/DomainsPage';
import { SitesPage } from './pages/SitesPage';
import { DevicesPage } from './pages/DevicesPage';
import { DeviceHistoryPage } from './pages/DeviceHistoryPage';
import { AddDevicePage } from './pages/AddDevicePage';
import { UsersPage } from './pages/UsersPage';
import { RolesPage } from './pages/RolesPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { SystemPage } from './pages/SystemPage';
import { MqttClientsPage } from './pages/MqttClientsPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OfflineIndicator } from './components/OfflineIndicator';
import { BottomNavigation } from './components/BottomNavigation';

export function App() {
  const location = useLocation();
  const [roles, setRoles] = useState<string[]>([]);
  const appBase = '/app';
  const publicRoutePrefixes = [`${appBase}/login`, `${appBase}/setup`];
  const isPublicRoute = publicRoutePrefixes.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`)
  );
  const isAdmin = roles.includes('admin');

  useEffect(() => {
    let canceled = false;
    const token = localStorage.getItem('admin_api_token');
    if (!token) {
      setRoles([]);
      return () => {
        canceled = true;
      };
    }

    const loadMe = async () => {
      try {
        const me = await authApi.me();
        if (!canceled) {
          setRoles(me.roles || []);
        }
      } catch {
        if (!canceled) {
          setRoles([]);
        }
      }
    };

    loadMe();
    return () => {
      canceled = true;
    };
  }, [location.pathname]);

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

        <Route exact path={`${appBase}/dashboard`} render={() => (isAdmin ? <DashboardPage /> : <Redirect to={`${appBase}/home`} />)} />
        <Route exact path={`${appBase}/domains`} render={() => (isAdmin ? <DomainsPage /> : <Redirect to={`${appBase}/home`} />)} />
        <Route exact path={`${appBase}/sites`} render={() => (isAdmin ? <SitesPage /> : <Redirect to={`${appBase}/home`} />)} />
        <Route exact path={`${appBase}/devices`} render={() => (isAdmin ? <DevicesPage /> : <Redirect to={`${appBase}/home`} />)} />
        <Route exact path={`${appBase}/devices/add`} render={() => (isAdmin ? <AddDevicePage /> : <Redirect to={`${appBase}/home`} />)} />
        <Route exact path={`${appBase}/devices/:id/history`} render={() => (isAdmin ? <DeviceHistoryPage /> : <Redirect to={`${appBase}/history`} />)} />
        <Route exact path={`${appBase}/users`} render={() => (isAdmin ? <UsersPage /> : <Redirect to={`${appBase}/home`} />)} />
        <Route exact path={`${appBase}/roles`} render={() => (isAdmin ? <RolesPage /> : <Redirect to={`${appBase}/home`} />)} />
        <Route exact path={`${appBase}/admin/audit-log`} render={() => (isAdmin ? <AuditLogPage /> : <Redirect to={`${appBase}/home`} />)} />
        <Route exact path={`${appBase}/system`} render={() => (isAdmin ? <SystemPage /> : <Redirect to={`${appBase}/home`} />)} />
        <Route exact path={`${appBase}/mqtt-clients`} render={() => (isAdmin ? <MqttClientsPage /> : <Redirect to={`${appBase}/home`} />)} />
        <Route exact path={`${appBase}/profile`} component={ProfilePage} />
        <Route exact path={`${appBase}/notifications`} component={NotificationsPage} />

        <Route exact path="/" render={() => <Redirect to={`${appBase}/home`} />} />
        <Route exact path={appBase} render={() => <Redirect to={`${appBase}/home`} />} />
      </IonRouterOutlet>

      {!isPublicRoute && <BottomNavigation appBase={appBase} isAdmin={isAdmin} />}
    </IonTabs>
    </>
  );
}

export default App;
