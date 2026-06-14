import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { SectionHeader } from "../components/SectionHeader";

export function DeviceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setDevice(await apiFetch(`/mobile/devices/${id}`));
        setError("");
      } catch (e) {
        setError(String(e.message || e));
      }
    })();
  }, [id]);

  return (
    <section className="card">
      <SectionHeader title="Device Detail" subtitle="Zones and health view for app-facing device data." />
      {error ? <p className="err">{error}</p> : null}
      {!device ? <p>Loading...</p> : null}
      {device ? (
        <>
          <div className="row">
            {confirmDelete ? (
              <>
                <button
                  className="danger"
                  onClick={async () => {
                    await apiFetch(`/devices/${device.device_id}`, { method: "DELETE" });
                    navigate("/devices");
                  }}
                >
                  Confirm Delete Device
                </button>
                <button className="secondary" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="danger" onClick={() => setConfirmDelete(true)}>
                Delete Device
              </button>
            )}
          </div>
          <p><strong>{device.display_name}</strong> ({device.device_id})</p>
          <p>Firmware: {device.firmware_version || "n/a"}</p>
          <p>Online: {device.online ? "yes" : "no"}</p>
          <h3>Zones</h3>
          <ul>
            {device.zones.map((z) => (
              <li key={z.zone_id}>
                {z.name} | target: {z.target_temperature_c ?? "n/a"} | current: {z.current_temperature_c ?? "n/a"}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
