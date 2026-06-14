import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { SectionHeader } from "../components/SectionHeader";

export function DomainDetailPage() {
  const { id } = useParams();
  const [domain, setDomain] = useState(null);
  const [sites, setSites] = useState([]);
  const [name, setName] = useState("");
  const [siteSlug, setSiteSlug] = useState("");
  const [siteName, setSiteName] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const d = await apiFetch(`/domains/${id}`);
      setDomain(d);
      setName(d.name);
      setSites(await apiFetch(`/domains/${id}/sites`));
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
      <SectionHeader title="Domain Detail" subtitle="Rename domain and manage sites." />
      {error ? <p className="err">{error}</p> : null}
      {domain ? (
        <>
          <div className="row">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button
              onClick={async () => {
                await apiFetch(`/domains/${id}/rename`, {
                  method: "POST",
                  body: JSON.stringify({ name }),
                });
                await load();
              }}
            >
              Rename domain
            </button>
          </div>

          <h3>Sites</h3>
          <div className="row">
            <input placeholder="site slug" value={siteSlug} onChange={(e) => setSiteSlug(e.target.value)} />
            <input placeholder="site name" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
            <button
              onClick={async () => {
                await apiFetch(`/domains/${id}/sites`, {
                  method: "POST",
                  body: JSON.stringify({ slug: siteSlug, name: siteName }),
                });
                setSiteSlug("");
                setSiteName("");
                await load();
              }}
            >
              Create site
            </button>
          </div>
          <ul>
            {sites.map((s) => (
              <li key={s.id}>
                <Link to={`/sites/${s.id}`}>{s.slug} - {s.name}</Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
