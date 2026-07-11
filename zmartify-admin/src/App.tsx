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
import { InvitesPage } from './pages/InvitesPage';
import { RolesPage } from './pages/RolesPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { SystemPage } from './pages/SystemPage';
import { MqttClientsPage } from './pages/MqttClientsPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotificationsPage } from './pages/NotificationsPage';
import { IrrigationOverviewPage } from './pages/IrrigationOverviewPage';
import { IrrigationProgramsPage } from './pages/IrrigationProgramsPage';
import { IrrigationHydraulicsPage } from './pages/IrrigationHydraulicsPage';
import { IrrigationManualPage } from './pages/IrrigationManualPage';
import { IrrigationWeatherPage } from './pages/IrrigationWeatherPage';
import { IrrigationZoneDetailPage } from './pages/IrrigationZoneDetailPage';
import { MorePage } from './pages/MorePage';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ResponsiveNavigation } from './components/ResponsiveNavigation';

export function App() {
  const location = useLocation();
  const [roles, setRoles] = useState<string[]>([]);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const appBase = '/app';
  const publicRoutePrefixes = [`${appBase}/login`, `${appBase}/setup`];
  const isPublicRoute = publicRoutePrefixes.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`)
  );
  const isAdmin = roles.includes('admin') || roles.includes('owner');
  const authLoadingView = <div style={{ padding: '16px' }}>Spinning up...</div>;

  const requireAuth = (view: JSX.Element) => {
    if (!authChecked) {
      return authLoadingView;
    }
    if (!isAuthenticated) {
      return <Redirect to={`${appBase}/login`} />;
    }
    return view;
  };

  const requireAdmin = (view: JSX.Element, nonAdminRedirect: string = `${appBase}/home`) => {
    if (!authChecked) {
      return authLoadingView;
    }
    if (!isAuthenticated) {
      return <Redirect to={`${appBase}/login`} />;
    }
    if (!isAdmin) {
      return <Redirect to={nonAdminRedirect} />;
    }
    return view;
  };

  useEffect(() => {
    let canceled = false;

    const loadMe = async () => {
      const token = localStorage.getItem('admin_api_token');
      if (!token) {
        setRoles([]);
        setIsAuthenticated(false);
        setAuthChecked(true);
        return;
      }

      setAuthChecked(false);
      try {
        const me = await authApi.me();
        if (!canceled) {
          setRoles(me.roles || []);
          setIsAuthenticated(true);
          setAuthChecked(true);
        }
      } catch {
        if (!canceled) {
          localStorage.removeItem('admin_api_token');
          setRoles([]);
          setIsAuthenticated(false);
          setAuthChecked(true);
        }
      }
    };

    loadMe();

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'admin_api_token') {
        void loadMe();
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      canceled = true;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <>
      <OfflineIndicator />
      <IonTabs className="app-layout-tabs">
        <IonRouterOutlet className="app-router-outlet">
        <Route exact path={`${appBase}/login`} component={LoginPage} />
          <Route
            exact
            path={`${appBase}/home`}
              render={() => requireAuth(<HomePage />)}
          />
          <Route
            exact
            path={`${appBase}/overview`}
              render={() => requireAuth(<HomePage />)}
          />
          <Route
            exact
            path={`${appBase}/rooms`}
              render={() => requireAuth(<RoomsPage />)}
          />
          <Route
            exact
            path={`${appBase}/rooms/:zoneRef`}
              render={() => requireAuth(<RoomDetailPage />)}
          />
          <Route
            exact
            path={`${appBase}/history`}
              render={() => requireAuth(<HistoryPage />)}
          />
          <Route
            exact
            path={`${appBase}/insights/hvac`}
              render={() => requireAuth(<HistoryPage />)}
          />
          <Route
            exact
            path={`${appBase}/alerts`}
              render={() => requireAuth(<AlertsPage />)}
          />
          <Route
            exact
            path={`${appBase}/settings`}
              render={() => requireAuth(<SettingsPage />)}
          />
          <Route
            exact
            path={`${appBase}/more/settings`}
              render={() => requireAuth(<SettingsPage />)}
          />
          <Route
            exact
            path={`${appBase}/control`}
              render={() => <Redirect to={`${appBase}/control/hvac/overview`} />}
          />
          <Route
            exact
            path={`${appBase}/control/hvac/overview`}
              render={() => requireAuth(<RoomsPage />)}
          />
          <Route
            exact
            path={`${appBase}/control/hvac/zones`}
              render={() => requireAuth(<RoomsPage />)}
          />
          <Route
            exact
            path={`${appBase}/control/hvac/zones/:zoneRef`}
              render={() => requireAuth(<RoomDetailPage />)}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/overview`}
              render={() => requireAuth(<IrrigationOverviewPage />)}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/zones`}
              render={() => requireAuth(<IrrigationOverviewPage />)}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/zones/:zoneRef`}
              render={() => requireAuth(<IrrigationZoneDetailPage />)}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/programs`}
              render={() => requireAuth(<IrrigationProgramsPage />)}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/manual`}
              render={() => requireAuth(<IrrigationManualPage />)}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/hydraulics`}
              render={() => requireAuth(<IrrigationHydraulicsPage />)}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/weather`}
              render={() => requireAuth(<IrrigationWeatherPage />)}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/power`}
              render={() => requireAuth(<IrrigationHydraulicsPage />)}
          />
          <Route
            exact
            path={`${appBase}/insights`}
              render={() => <Redirect to={`${appBase}/insights/hvac`} />}
          />
          <Route
            exact
            path={`${appBase}/more`}
              render={() => requireAuth(<MorePage />)}
          />
          <Route
            exact
            path={`${appBase}/more/profile`}
              render={() => requireAuth(<ProfilePage />)}
          />
          <Route
            exact
            path={`${appBase}/more/notifications`}
              render={() => requireAuth(<NotificationsPage />)}
          />
          <Route
            exact
            path={`${appBase}/more/devices`}
              render={() => requireAuth(isAdmin ? <DevicesPage /> : <HomePage />)}
          />
          <Route
            exact
            path={`${appBase}/more/users`}
              render={() => requireAuth(isAdmin ? <UsersPage /> : <HomePage />)}
          />
          <Route
            exact
            path={`${appBase}/more/integrations`}
              render={() => requireAuth(isAdmin ? <MqttClientsPage /> : <HomePage />)}
          />
          <Route
            exact
            path={`${appBase}/more/system`}
              render={() => requireAuth(isAdmin ? <SystemPage /> : <SettingsPage />)}
          />

          <Route
            exact
            path={`${appBase}/dashboard`}
              render={() => requireAdmin(<DashboardPage />)}
          />
          <Route
            exact
            path={`${appBase}/domains`}
              render={() => requireAdmin(<DomainsPage />)}
          />
          <Route
            exact
            path={`${appBase}/sites`}
              render={() => requireAdmin(<SitesPage />)}
          />
          <Route
            exact
            path={`${appBase}/devices`}
              render={() => requireAdmin(<DevicesPage />)}
          />
          <Route
            exact
            path={`${appBase}/systems`}
              render={() => requireAdmin(<DevicesPage />)}
          />
          <Route
            exact
            path={`${appBase}/devices/add`}
              render={() => requireAdmin(<AddDevicePage />)}
          />
          <Route
            exact
            path={`${appBase}/devices/:id/history`}
              render={() => requireAdmin(<DeviceHistoryPage />, `${appBase}/history`)}
          />
          <Route
            exact
            path={`${appBase}/users`}
              render={() => requireAdmin(<UsersPage />)}
          />
          <Route
            exact
            path={`${appBase}/invites`}
              render={() => requireAdmin(<InvitesPage />)}
          />
          <Route
            exact
            path={`${appBase}/roles`}
              render={() => requireAdmin(<RolesPage />)}
          />
          <Route
            exact
            path={`${appBase}/admin/audit-log`}
              render={() => requireAdmin(<AuditLogPage />)}
          />
          <Route
            exact
            path={`${appBase}/system`}
              render={() => requireAdmin(<SystemPage />)}
          />
          <Route
            exact
            path={`${appBase}/mqtt-clients`}
              render={() => requireAdmin(<MqttClientsPage />)}
          />
          <Route
            exact
            path={`${appBase}/integrations`}
              render={() => requireAdmin(<MqttClientsPage />)}
          />
          <Route
            exact
            path={`${appBase}/profile`}
              render={() => requireAuth(<ProfilePage />)}
          />
          <Route
            exact
            path={`${appBase}/notifications`}
              render={() => requireAuth(<NotificationsPage />)}
          />

          <Route exact path="/" render={() => <Redirect to={`${appBase}/home`} />} />
          <Route exact path={appBase} render={() => <Redirect to={`${appBase}/home`} />} />
      </IonRouterOutlet>

      {!isPublicRoute && <ResponsiveNavigation appBase={appBase} isAdmin={isAdmin} />}
    </IonTabs>
    </>
  );
}

export default App;
