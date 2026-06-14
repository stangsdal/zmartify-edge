import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
import { SectionHeader } from "../components/SectionHeader";

export function DevicesPage() {
  const [devices, setDevices] = useState([]);
  const [payload, setPayload] = useState({
    device_id: "",
    display_name: "",
    mac: "",
    firmware_version: "",
  });
  const [error, setError] = useState("");

  async function load() {
    try {
      setDevices(await apiFetch("/devices"));
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
      <SectionHeader title="Devices" subtitle="Register and inspect devices." />
      {error ? <p className="err">{error}</p> : null}
      <div className="stack">
        <input
          placeholder="device_id"
          value={payload.device_id}
          onChange={(e) => setPayload({ ...payload, device_id: e.target.value })}
        />
        <input
          placeholder="display_name"
          value={payload.display_name}
          onChange={(e) => setPayload({ ...payload, display_name: e.target.value })}
        />
        <input
          placeholder="mac"
          value={payload.mac}
          onChange={(e) => setPayload({ ...payload, mac: e.target.value })}
        />
        <input
          placeholder="firmware_version"
          value={payload.firmware_version}
          onChange={(e) => setPayload({ ...payload, firmware_version: e.target.value })}
        />
        <button
          onClick={async () => {
            await apiFetch("/devices", { method: "POST", body: JSON.stringify(payload) });
            setPayload({ device_id: "", display_name: "", mac: "", firmware_version: "" });
            await load();
          }}
        >
          Register device
        </button>
      </div>
      <ul>
        {devices.map((d) => (
          <li key={d.device_id} className="row between">
            <span>{d.device_id} - {d.display_name}</span>
            <Link to={`/devices/${d.device_id}`}>Open</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
