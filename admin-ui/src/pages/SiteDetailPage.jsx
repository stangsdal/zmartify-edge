import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { SectionHeader } from "../components/SectionHeader";

export function SiteDetailPage() {
  const { id } = useParams();
  const [site, setSite] = useState(null);
  const [devices, setDevices] = useState([]);
  const [allDevices, setAllDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const s = await apiFetch(`/sites/${id}`);
      setSite(s);
      const domainSites = await apiFetch(`/domains/${s.domain_id}/sites`);
      const ds = await apiFetch("/devices");
      setAllDevices(ds);
      setDevices(ds.filter((d) => domainSites.some((siteRow) => siteRow.id === d.site_id)));
      setError("");
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  return (
    <section className="card">
      <SectionHeader title="Site Detail" subtitle="Assign devices and inspect status." />
      {error ? <p className="err">{error}</p> : null}
      {site ? (
        <>
          <p>
            <strong>{site.name}</strong> ({site.slug})
          </p>
          <div className="row">
            <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}>
              <option value="">Select device</option>
              {allDevices.map((d) => (
                <option value={d.device_id} key={d.device_id}>
                  {d.device_id}
                </option>
              ))}
            </select>
            <button
              onClick={async () => {
                if (!selectedDevice) return;
                await apiFetch(`/devices/${selectedDevice}/assign-site`, {
                  method: "POST",
                  body: JSON.stringify({ site_id: Number(id) }),
                });
                await load();
              }}
            >
              Assign device
            </button>
          </div>
          <h3>Site devices</h3>
          <ul>
            {devices.filter((d) => d.site_id === Number(id)).map((d) => (
              <li key={d.device_id}>{d.device_id} - {d.display_name}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
