import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
import { SectionHeader } from "../components/SectionHeader";

export function DomainsPage() {
  const [domains, setDomains] = useState([]);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setDomains(await apiFetch("/domains"));
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
      <SectionHeader title="Domains" subtitle="Manage domains: house, summerhouse, office." />
      {error ? <p className="err">{error}</p> : null}
      <div className="row">
        <input placeholder="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
        <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          onClick={async () => {
            await apiFetch("/domains", {
              method: "POST",
              body: JSON.stringify({ slug, name }),
            });
            setSlug("");
            setName("");
            await load();
          }}
        >
          Create domain
        </button>
      </div>
      <ul>
        {domains.map((d) => (
          <li key={d.id} className="row between">
            <span>
              <strong>{d.slug}</strong> - {d.name}
            </span>
            <span className="row">
              <Link to={`/domains/${d.id}`}>Open</Link>
              <button
                className="danger"
                onClick={async () => {
                  await apiFetch(`/domains/${d.id}`, { method: "DELETE" });
                  await load();
                }}
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
