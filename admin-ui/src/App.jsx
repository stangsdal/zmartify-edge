import { Link, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetailPage } from "./pages/DeviceDetailPage";
import { DomainDetailPage } from "./pages/DomainDetailPage";
import { DomainsPage } from "./pages/DomainsPage";
import { LoginPage } from "./pages/LoginPage";
import { MqttClientsPage } from "./pages/MqttClientsPage";
import { SiteDetailPage } from "./pages/SiteDetailPage";
import { SystemPage } from "./pages/SystemPage";

export function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>HVAC Edge</h1>
        <nav>
          <Link to="/login">Login</Link>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/domains">Domains</Link>
          <Link to="/sites/1">Site Detail</Link>
          <Link to="/devices">Devices</Link>
          <Link to="/mqtt-clients">MQTT Clients</Link>
          <Link to="/system">System</Link>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/domains" element={<DomainsPage />} />
          <Route path="/domains/:id" element={<DomainDetailPage />} />
          <Route path="/sites/:id" element={<SiteDetailPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
          <Route path="/mqtt-clients" element={<MqttClientsPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </main>
    </div>
  );
}
