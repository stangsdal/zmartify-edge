import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Route } from 'react-router-dom';
import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonRouterOutlet, } from '@ionic/react';
import { homeOutline, folderOutline, gridOutline, phonePortraitOutline, wifiOutline, settingsOutline, logOutOutline, } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DomainsPage } from './pages/DomainsPage';
import { SitesPage } from './pages/SitesPage';
import { DevicesPage } from './pages/DevicesPage';
import { MqttClientsPage } from './pages/MqttClientsPage';
import { SystemPage } from './pages/SystemPage';
export function App() {
    const history = useHistory();
    const handleLogout = () => {
        localStorage.removeItem('admin_api_token');
        localStorage.removeItem('api_base_url');
        history.push('/login');
    };
    return (_jsxs(IonTabs, { children: [_jsxs(IonRouterOutlet, { children: [_jsx(Route, { exact: true, path: "/login", component: LoginPage }), _jsx(Route, { exact: true, path: "/dashboard", component: DashboardPage }), _jsx(Route, { exact: true, path: "/domains", component: DomainsPage }), _jsx(Route, { exact: true, path: "/sites", component: SitesPage }), _jsx(Route, { exact: true, path: "/devices", component: DevicesPage }), _jsx(Route, { exact: true, path: "/mqtt-clients", component: MqttClientsPage }), _jsx(Route, { exact: true, path: "/system", component: SystemPage }), _jsx(Route, { path: "*", render: () => _jsx(DashboardPage, {}) })] }), _jsxs(IonTabBar, { slot: "bottom", children: [_jsxs(IonTabButton, { tab: "dashboard", href: "/dashboard", children: [_jsx(IonIcon, { icon: homeOutline }), "Dashboard"] }), _jsxs(IonTabButton, { tab: "domains", href: "/domains", children: [_jsx(IonIcon, { icon: folderOutline }), "Domains"] }), _jsxs(IonTabButton, { tab: "sites", href: "/sites", children: [_jsx(IonIcon, { icon: gridOutline }), "Sites"] }), _jsxs(IonTabButton, { tab: "devices", href: "/devices", children: [_jsx(IonIcon, { icon: phonePortraitOutline }), "Devices"] }), _jsxs(IonTabButton, { tab: "mqtt", href: "/mqtt-clients", children: [_jsx(IonIcon, { icon: wifiOutline }), "MQTT"] }), _jsxs(IonTabButton, { tab: "system", href: "/system", children: [_jsx(IonIcon, { icon: settingsOutline }), "System"] }), _jsxs(IonTabButton, { onClick: handleLogout, children: [_jsx(IonIcon, { icon: logOutOutline }), "Logout"] })] })] }));
}
export default App;
