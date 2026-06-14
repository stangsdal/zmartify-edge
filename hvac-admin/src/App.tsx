import { Route } from 'react-router-dom';
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
import { MqttClientsPage } from './pages/MqttClientsPage';
import { SystemPage } from './pages/SystemPage';
import { UsersPage } from './pages/UsersPage';
import { RolesPage } from './pages/RolesPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { ProfilePage } from './pages/ProfilePage';
import { OfflineIndicator } from './components/OfflineIndicator';

export function App() {
  const history = useHistory();

  const handleLogout = () => {
    localStorage.removeItem('admin_api_token');
    localStorage.removeItem('api_base_url');
    history.push('/login');
  };

  return (
    <>
      <OfflineIndicator />
      <IonTabs>
      <IonRouterOutlet>
        <Route exact path="/login" component={LoginPage} />
        <Route exact path="/dashboard" component={DashboardPage} />
        <Route exact path="/domains" component={DomainsPage} />
        <Route exact path="/sites" component={SitesPage} />
        <Route exact path="/devices" component={DevicesPage} />
        <Route exact path="/mqtt-clients" component={MqttClientsPage} />
        <Route exact path="/system" component={SystemPage} />
        <Route exact path="/users" component={UsersPage} />
        <Route exact path="/roles" component={RolesPage} />
        <Route exact path="/audit-log" component={AuditLogPage} />
        <Route exact path="/profile" component={ProfilePage} />
        <Route path="*" render={() => <DashboardPage />} />
      </IonRouterOutlet>

      <IonTabBar slot="bottom">
        <IonTabButton tab="dashboard" href="/dashboard">
          <IonIcon icon={homeOutline} />
          Dashboard
        </IonTabButton>

        <IonTabButton tab="domains" href="/domains">
          <IonIcon icon={folderOutline} />
          Domains
        </IonTabButton>

        <IonTabButton tab="sites" href="/sites">
          <IonIcon icon={gridOutline} />
          Sites
        </IonTabButton>

        <IonTabButton tab="devices" href="/devices">
          <IonIcon icon={phonePortraitOutline} />
          Devices
        </IonTabButton>

        <IonTabButton tab="mqtt" href="/mqtt-clients">
          <IonIcon icon={wifiOutline} />
          MQTT
        </IonTabButton>

        <IonTabButton tab="system" href="/system">
          <IonIcon icon={settingsOutline} />
          System
        </IonTabButton>

        <IonTabButton tab="users" href="/users">
          <IonIcon icon={peopleOutline} />
          Users
        </IonTabButton>

        <IonTabButton tab="roles" href="/roles">
          <IonIcon icon={keyOutline} />
          Roles
        </IonTabButton>

        <IonTabButton tab="audit" href="/audit-log">
          <IonIcon icon={documentTextOutline} />
          Audit
        </IonTabButton>

        <IonTabButton tab="profile" href="/profile">
          <IonIcon icon={personCircleOutline} />
          Profile
        </IonTabButton>

        <IonTabButton onClick={handleLogout}>
          <IonIcon icon={logOutOutline} />
          Logout
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
    </>
  );
}

export default App;
