import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { SectionHeader } from "../components/SectionHeader";

export function MqttClientsPage() {
  const [clients, setClients] = useState([]);
  const [domains, setDomains] = useState([]);
  const [domainId, setDomainId] = useState("");
  const [latestPassword, setLatestPassword] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const [cs, ds] = await Promise.all([apiFetch("/mqtt/clients"), apiFetch("/domains")]);
      setClients(cs);
      setDomains(ds);
      setError("");
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="card">
      <SectionHeader title="MQTT Clients" subtitle="Homey-first client lifecycle and ACL preview." />
      {error ? <p className="err">{error}</p> : null}

      <div className="row">
        <select value={domainId} onChange={(e) => setDomainId(e.target.value)}>
          <option value="">Select domain for Homey client</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.slug}
            </option>
          ))}
        </select>
        <button
          onClick={async () => {
            const created = await apiFetch("/mqtt/clients", {
              method: "POST",
              body: JSON.stringify({
                client_type: "homey",
                domain_id: Number(domainId),
                username: `homey_${domains.find((d) => d.id === Number(domainId))?.slug || "domain"}`,
              }),
            });
            setLatestPassword(`${created.username}: ${created.password}`);
            await load();
          }}
        >
          Create Homey client
        </button>
        <button
          className="secondary"
          onClick={async () => {
            await apiFetch("/admin/acl/regenerate", { method: "POST" });
            await load();
          }}
        >
          Regenerate ACL
        </button>
      </div>

      {latestPassword ? <p className="ok">One-time credential: {latestPassword}</p> : null}

      <ul>
        {clients.map((c) => (
          <li key={c.id} className="stack item">
            <div className="row between">
              <span>
                #{c.id} {c.username} ({c.client_type}) {c.enabled ? "enabled" : "disabled"}
              </span>
              <span className="row">
                <button
                  onClick={async () => {
                    const rotated = await apiFetch(`/mqtt/clients/${c.id}/rotate-password`, { method: "POST" });
                    setLatestPassword(`${rotated.username}: ${rotated.password}`);
                    await load();
                  }}
                >
                  Rotate
                </button>
                <button
                  className="secondary"
                  onClick={async () => {
                    await apiFetch(`/mqtt/clients/${c.id}/${c.enabled ? "disable" : "enable"}`, { method: "POST" });
                    await load();
                  }}
                >
                  {c.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  className="secondary"
                  onClick={async () => {
                    setPreview(await apiFetch(`/admin/acl/preview/${c.id}`));
                  }}
                >
                  Preview ACL
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    await apiFetch(`/mqtt/clients/${c.id}`, { method: "DELETE" });
                    await load();
                  }}
                >
                  Delete
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>

      {preview ? (
        <div className="card soft">
          <h3>ACL Preview: {preview.client.username}</h3>
          <pre>{preview.topics.join("\n") || "(no topics)"}</pre>
        </div>
      ) : null}
    </section>
  );
}
