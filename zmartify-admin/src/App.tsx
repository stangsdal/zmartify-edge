import { ReactNode, useEffect } from 'react';
import { Redirect, Route, useLocation } from 'react-router-dom';
import { IonTabs, IonRouterOutlet } from '@ionic/react';
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
import { IrrigationSetupPage } from './pages/IrrigationSetupPage';
import { IrrigationWeatherPage } from './pages/IrrigationWeatherPage';
import { IrrigationZoneDetailPage } from './pages/IrrigationZoneDetailPage';
import { InsightsWaterPage } from './pages/InsightsWaterPage';
import { InsightsEnergyPage } from './pages/InsightsEnergyPage';
import { MorePage } from './pages/MorePage';
import { SiteMembersPage } from './pages/SiteMembersPage';
import { OnboardingDiscoverPage } from './pages/OnboardingDiscoverPage';
import { OnboardingClaimPage } from './pages/OnboardingClaimPage';
import { OnboardingAssignSitePage } from './pages/OnboardingAssignSitePage';
import { OnboardingCompletePage } from './pages/OnboardingCompletePage';
import { SystemsPage } from './pages/SystemsPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ResponsiveNavigation } from './components/ResponsiveNavigation';
import { useAccess } from './auth/AccessContext';

function SiteRouteGuard({ siteRef, product, permission, children }: { siteRef: string; product?: 'hvac' | 'irrigation'; permission?: 'operate' | 'configure' | 'administer'; children: ReactNode }) {
  const { context, isAuthenticated, isLoading, selectSite, can } = useAccess();
  const site = context?.sites.find((candidate) => candidate.uuid === siteRef || String(candidate.id) === siteRef);

  useEffect(() => {
    if (site) {
      selectSite(site.id);
    }
  }, [site?.id]);

  if (isLoading) {
    return <div style={{ padding: '16px' }}>Spinning up...</div>;
  }
  if (!isAuthenticated) {
    return <Redirect to="/app/login" />;
  }
  if (!site) {
    return <Redirect to="/app/home" />;
  }
  if (product && !site.products.some((item) => item.type === product && item.allowed)) {
    return <Redirect to={`/app/sites/${site.uuid || site.id}`} />;
  }
  if (product && permission && !can(site.id, product, permission)) {
    return <Redirect to={`/app/sites/${site.uuid || site.id}/${product}`} />;
  }
  return <>{children}</>;
}

export function App() {
  const location = useLocation();
  const { context, isAdministrator, isAuthenticated, isLoading, selectedSiteId } = useAccess();
  const appBase = '/app';
  const publicRoutePrefixes = [`${appBase}/login`, `${appBase}/setup`];
  const isPublicRoute = publicRoutePrefixes.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`)
  );
  const isAdmin = isAdministrator;
  const canManageMembers = isAdministrator || context?.sites.some((site) => site.role === 'owner') === true;
  const selectedSite = context?.sites.find((site) => site.id === selectedSiteId);
  const selectedSiteBase = selectedSite ? `${appBase}/sites/${selectedSite.uuid || selectedSite.id}` : `${appBase}/home`;
  const selectedHasIrrigation = selectedSite?.products.some((product) => product.type === 'irrigation' && product.allowed) === true;
  const selectedHasHvac = selectedSite?.products.some((product) => product.type === 'hvac' && product.allowed) === true;
  const controlPath = selectedHasIrrigation ? `${selectedSiteBase}/irrigation` : selectedHasHvac ? `${selectedSiteBase}/hvac` : selectedSiteBase;
  const authChecked = !isLoading;
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

  const requireCapability = (view: JSX.Element, allowed: boolean) => {
    if (!authChecked) {
      return authLoadingView;
    }
    if (!isAuthenticated) {
      return <Redirect to={`${appBase}/login`} />;
    }
    return allowed ? view : <Redirect to={`${appBase}/home`} />;
  };

  return (
    <>
      <OfflineIndicator />
      <IonTabs className="app-layout-tabs">
        <IonRouterOutlet className="app-router-outlet">
        <Route exact path={`${appBase}/login`} component={LoginPage} />
          <Route
            exact
            path={`${appBase}/sites/:siteRef`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef}><HomePage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/hvac`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="hvac"><RoomsPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/hvac/zones`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="hvac"><RoomsPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/hvac/zones/:zoneRef`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="hvac"><RoomDetailPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/irrigation`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="irrigation"><IrrigationOverviewPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/irrigation/zones`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="irrigation"><Redirect to={`${appBase}/sites/${match.params.siteRef}/irrigation`} /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/irrigation/programs`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="irrigation"><IrrigationProgramsPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/irrigation/zones/:zoneRef`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="irrigation"><IrrigationZoneDetailPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/irrigation/manual`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="irrigation" permission="operate"><IrrigationManualPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/irrigation/setup`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="irrigation" permission="configure"><IrrigationSetupPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/irrigation/hydraulics`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="irrigation"><IrrigationHydraulicsPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/irrigation/weather`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="irrigation"><IrrigationWeatherPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/hvac/history`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef} product="hvac"><HistoryPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/alerts`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef}><AlertsPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/people`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef}><SiteMembersPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/sites/:siteRef/settings`}
            render={({ match }) => <SiteRouteGuard siteRef={match.params.siteRef}><SettingsPage /></SiteRouteGuard>}
          />
          <Route
            exact
            path={`${appBase}/home`}
              render={() => requireAuth(selectedSite ? <Redirect to={`${appBase}/sites/${selectedSite.uuid || selectedSite.id}`} /> : <HomePage />)}
          />
          <Route
            exact
            path={`${appBase}/overview`}
              render={() => <Redirect to={selectedSiteBase} />}
          />
          <Route
            exact
            path={`${appBase}/rooms`}
              render={() => <Redirect to={`${selectedSiteBase}/hvac/zones`} />}
          />
          <Route
            exact
            path={`${appBase}/rooms/:zoneRef`}
              render={({ match }) => <Redirect to={`${selectedSiteBase}/hvac/zones/${match.params.zoneRef}`} />}
          />
          <Route
            exact
            path={`${appBase}/history`}
              render={() => <Redirect to={`${selectedSiteBase}/hvac/history`} />}
          />
          <Route
            exact
            path={`${appBase}/insights/hvac`}
              render={() => requireAuth(<HistoryPage />)}
          />
          <Route
            exact
            path={`${appBase}/insights/water`}
              render={() => requireAuth(<InsightsWaterPage />)}
          />
          <Route
            exact
            path={`${appBase}/insights/energy`}
              render={() => requireAuth(<InsightsEnergyPage />)}
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
              render={() => <Redirect to={controlPath} />}
          />
          <Route
            exact
            path={`${appBase}/onboarding`}
              render={() => <Redirect to={`${appBase}/onboarding/discover`} />}
          />
          <Route
            exact
            path={`${appBase}/onboarding/discover`}
              render={() => requireAuth(<OnboardingDiscoverPage />)}
          />
          <Route
            exact
            path={`${appBase}/onboarding/claim`}
              render={() => requireAuth(<OnboardingClaimPage />)}
          />
          <Route
            exact
            path={`${appBase}/onboarding/assign-site`}
              render={() => requireAuth(<OnboardingAssignSitePage />)}
          />
          <Route
            exact
            path={`${appBase}/onboarding/complete`}
              render={() => requireAuth(<OnboardingCompletePage />)}
          />
          <Route
            exact
            path={`${appBase}/control/hvac/overview`}
              render={() => <Redirect to={`${selectedSiteBase}/hvac`} />}
          />
          <Route
            exact
            path={`${appBase}/control/hvac/zones`}
              render={() => <Redirect to={`${selectedSiteBase}/hvac/zones`} />}
          />
          <Route
            exact
            path={`${appBase}/control/hvac/zones/:zoneRef`}
              render={({ match }) => <Redirect to={`${selectedSiteBase}/hvac/zones/${match.params.zoneRef}`} />}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/overview`}
              render={() => <Redirect to={`${selectedSiteBase}/irrigation`} />}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/zones`}
              render={() => <Redirect to={`${selectedSiteBase}/irrigation`} />}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/zones/:zoneRef`}
              render={({ match }) => <Redirect to={`${selectedSiteBase}/irrigation/zones/${match.params.zoneRef}`} />}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/programs`}
              render={() => <Redirect to={`${selectedSiteBase}/irrigation/programs`} />}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/manual`}
              render={() => <Redirect to={`${selectedSiteBase}/irrigation/manual`} />}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/setup`}
              render={() => <Redirect to={`${selectedSiteBase}/irrigation/setup`} />}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/hydraulics`}
              render={() => <Redirect to={`${selectedSiteBase}/irrigation/hydraulics`} />}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/weather`}
              render={() => <Redirect to={`${selectedSiteBase}/irrigation/weather`} />}
          />
          <Route
            exact
            path={`${appBase}/control/irrigation/power`}
              render={() => <Redirect to={`${selectedSiteBase}/irrigation/hydraulics`} />}
          />
          <Route
            exact
            path={`${appBase}/insights`}
              render={() => <Redirect to={`${appBase}/insights/water`} />}
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
            path={`${appBase}/more/members`}
              render={() => requireCapability(<SiteMembersPage />, canManageMembers)}
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
              render={() => requireAdmin(<SystemsPage />)}
          />
          <Route
            exact
            path={`${appBase}/automations`}
              render={() => requireAdmin(<AutomationsPage />)}
          />
          <Route
            exact
            path={`${appBase}/devices/add`}
              render={() => <Redirect to={`${appBase}/onboarding/discover`} />}
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

      {!isPublicRoute && <ResponsiveNavigation appBase={appBase} />}
    </IonTabs>
    </>
  );
}

export default App;
