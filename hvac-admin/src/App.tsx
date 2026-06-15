import { Redirect, Route, useLocation } from 'react-router-dom';
import {
  IonTabs,
  IonTabBar,
  IonTabButton,
  IonIcon,
  IonRouterOutlet,
} from '@ionic/react';
import {
  homeOutline,
  folderOutline,
  gridOutline,
  phonePortraitOutline,
  wifiOutline,
  settingsOutline,
  peopleOutline,
  keyOutline,
  documentTextOutline,
  personCircleOutline,
  logOutOutline,
} from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DomainsPage } from './pages/DomainsPage';
import { SitesPage } from './pages/SitesPage';
import { DevicesPage } from './pages/DevicesPage';
import { AddDevicePage } from './pages/AddDevicePage';
import { MqttClientsPage } from './pages/MqttClientsPage';
import { SystemPage } from './pages/SystemPage';
import { UsersPage } from './pages/UsersPage';
import { RolesPage } from './pages/RolesPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { ProfilePage } from './pages/ProfilePage';
import { OfflineIndicator } from './components/OfflineIndicator';
import { authApi } from './api/auth';

export function App() {
  const history = useHistory();
  const location = useLocation();
  const appBase = '/app';
  const publicRoutePrefixes = [`${appBase}/login`, `${appBase}/setup`];
  const isPublicRoute = publicRoutePrefixes.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`)
  );

  const handleLogout = async () => {
    try {
      // Best effort server-side session/token cleanup.
      await authApi.logout();
    } catch {
      // Ignore logout API failures (expired/missing token). Local logout still applies.
    }
    localStorage.removeItem('admin_api_token');
    history.replace(`${appBase}/login`);
  };

  return (
    <>
      <OfflineIndicator />
      <IonTabs>
      <IonRouterOutlet>
        <Route exact path={`${appBase}/login`} component={LoginPage} />
        <Route exact path={`${appBase}/dashboard`} component={DashboardPage} />
        <Route exact path={`${appBase}/domains`} component={DomainsPage} />
        <Route exact path={`${appBase}/sites`} component={SitesPage} />
        <Route exact path={`${appBase}/devices`} component={DevicesPage} />
        <Route exact path={`${appBase}/devices/add`} component={AddDevicePage} />
        <Route exact path={`${appBase}/mqtt-clients`} component={MqttClientsPage} />
        <Route exact path={`${appBase}/system`} component={SystemPage} />
        <Route exact path={`${appBase}/users`} component={UsersPage} />
        <Route exact path={`${appBase}/roles`} component={RolesPage} />
        <Route exact path={`${appBase}/audit-log`} component={AuditLogPage} />
        <Route exact path={`${appBase}/profile`} component={ProfilePage} />
        <Route exact path="/" render={() => <Redirect to={`${appBase}/dashboard`} />} />
        <Route exact path={appBase} render={() => <Redirect to={`${appBase}/dashboard`} />} />
      </IonRouterOutlet>

      {!isPublicRoute && <IonTabBar slot="bottom">
        <IonTabButton tab="dashboard" href={`${appBase}/dashboard`}>
          <IonIcon icon={homeOutline} />
          Dashboard
        </IonTabButton>

        <IonTabButton tab="domains" href={`${appBase}/domains`}>
          <IonIcon icon={folderOutline} />
          Domains
        </IonTabButton>

        <IonTabButton tab="sites" href={`${appBase}/sites`}>
          <IonIcon icon={gridOutline} />
          Sites
        </IonTabButton>

        <IonTabButton tab="devices" href={`${appBase}/devices`}>
          <IonIcon icon={phonePortraitOutline} />
          Devices
        </IonTabButton>

        <IonTabButton tab="mqtt" href={`${appBase}/mqtt-clients`}>
          <IonIcon icon={wifiOutline} />
          MQTT
        </IonTabButton>

        <IonTabButton tab="system" href={`${appBase}/system`}>
          <IonIcon icon={settingsOutline} />
          System
        </IonTabButton>

        <IonTabButton tab="users" href={`${appBase}/users`}>
          <IonIcon icon={peopleOutline} />
          Users
        </IonTabButton>

        <IonTabButton tab="roles" href={`${appBase}/roles`}>
          <IonIcon icon={keyOutline} />
          Roles
        </IonTabButton>

        <IonTabButton tab="audit" href={`${appBase}/audit-log`}>
          <IonIcon icon={documentTextOutline} />
          Audit
        </IonTabButton>

        <IonTabButton tab="profile" href={`${appBase}/profile`}>
          <IonIcon icon={personCircleOutline} />
          Profile
        </IonTabButton>

        <IonTabButton tab="logout" href={`${appBase}/login`} onClick={handleLogout}>
          <IonIcon icon={logOutOutline} />
          Logout
        </IonTabButton>
      </IonTabBar>}
    </IonTabs>
    </>
  );
}

export default App;
