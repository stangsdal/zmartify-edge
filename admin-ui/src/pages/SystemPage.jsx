import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { SectionHeader } from "../components/SectionHeader";

export function SystemPage() {
  const [health, setHealth] = useState(null);
  const [acl, setAcl] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [h, a] = await Promise.all([apiFetch("/health"), apiFetch("/admin/acl/status")]);
        setHealth(h);
        setAcl(a);
        setError("");
      } catch (e) {
        setError(String(e.message || e));
      }
    })();
  }, []);

  return (
    <section className="card">
      <SectionHeader title="System" subtitle="Broker and ACL diagnostics." />
      {error ? <p className="err">{error}</p> : null}
      {health ? <p>Service: {health.service} ({health.ok ? "ok" : "fail"})</p> : null}
      {acl ? (
        <div className="stack">
          <p>ACL path: {acl.acl_file.path}</p>
          <p>ACL exists: {String(acl.acl_file.exists)}</p>
          <p>ACL checksum: {acl.acl_file.sha256 || "n/a"}</p>
          <p>Last ACL generation: {acl.generation_logs[0]?.generated_at || "n/a"}</p>
        </div>
      ) : null}
    </section>
  );
}
