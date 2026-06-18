import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getToken } from "./api";
import { DashboardPage } from "./pages/DashboardPage";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetailPage } from "./pages/DeviceDetailPage";
import { DomainDetailPage } from "./pages/DomainDetailPage";
import { DomainsPage } from "./pages/DomainsPage";
import { LoginPage } from "./pages/LoginPage";
import { MqttClientsPage } from "./pages/MqttClientsPage";
import { SiteDetailPage } from "./pages/SiteDetailPage";
import { SystemPage } from "./pages/SystemPage";

function RequireAuth({ children }) {
  const location = useLocation();
  const token = getToken();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

function LoginRoute() {
  const token = getToken();
  if (token) {
    return <Navigate to="/dashboard" replace />;
  }
  return <LoginPage />;
}

export function App() {
  const hasToken = Boolean(getToken());

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>HVAC Edge</h1>
        <nav>
          <Link to="/login">Login</Link>
          {hasToken && <Link to="/dashboard">Dashboard</Link>}
          {hasToken && <Link to="/domains">Domains</Link>}
          {hasToken && <Link to="/sites/1">Site Detail</Link>}
          {hasToken && <Link to="/devices">Devices</Link>}
          {hasToken && <Link to="/mqtt-clients">MQTT Clients</Link>}
          {hasToken && <Link to="/system">System</Link>}
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/domains"
            element={
              <RequireAuth>
                <DomainsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/domains/:id"
            element={
              <RequireAuth>
                <DomainDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/sites/:id"
            element={
              <RequireAuth>
                <SiteDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/devices"
            element={
              <RequireAuth>
                <DevicesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/devices/:id"
            element={
              <RequireAuth>
                <DeviceDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/mqtt-clients"
            element={
              <RequireAuth>
                <MqttClientsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/system"
            element={
              <RequireAuth>
                <SystemPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
