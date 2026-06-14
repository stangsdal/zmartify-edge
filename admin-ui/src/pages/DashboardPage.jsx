import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { SectionHeader } from "../components/SectionHeader";

export function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [health, registry, acl, domains, sites, devices, clients] = await Promise.all([
          apiFetch("/health"),
          apiFetch("/registry/status"),
          apiFetch("/admin/acl/status"),
          apiFetch("/domains"),
          apiFetch("/domains").then(async (ds) => {
            const all = await Promise.all(ds.map((d) => apiFetch(`/domains/${d.id}/sites`)));
            return all.flat();
          }),
          apiFetch("/devices"),
          apiFetch("/mqtt/clients"),
        ]);
        setData({ health, registry, acl, domains, sites, devices, clients });
      } catch (e) {
        setError(String(e.message || e));
      }
    })();
  }, []);

  return (
    <section className="card">
      <SectionHeader title="Dashboard" subtitle="System and registry overview." />
      {error ? <p className="err">{error}</p> : null}
      {!data ? <p>Loading...</p> : null}
      {data ? (
        <div className="grid">
          <div className="card soft"><strong>Health</strong><p>{data.health.ok ? "OK" : "Fail"}</p></div>
          <div className="card soft"><strong>Registry</strong><p>{data.registry.status}</p></div>
          <div className="card soft"><strong>ACL File</strong><p>{data.acl.acl_file.exists ? "Present" : "Missing"}</p></div>
          <div className="card soft"><strong>Domains</strong><p>{data.domains.length}</p></div>
          <div className="card soft"><strong>Sites</strong><p>{data.sites.length}</p></div>
          <div className="card soft"><strong>Devices</strong><p>{data.devices.length}</p></div>
          <div className="card soft"><strong>MQTT Clients</strong><p>{data.clients.length}</p></div>
          <div className="card soft"><strong>Last ACL Generation</strong><p>{data.acl.generation_logs[0]?.generated_at || "n/a"}</p></div>
        </div>
      ) : null}
    </section>
  );
}
