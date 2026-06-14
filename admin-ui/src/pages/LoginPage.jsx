import { useState } from "react";
import { clearToken, setToken } from "../api";
import { SectionHeader } from "../components/SectionHeader";

export function LoginPage() {
  const [token, setLocalToken] = useState("");
  const [message, setMessage] = useState("");

  return (
    <section className="card">
      <SectionHeader title="Login" subtitle="Set ADMIN_API_TOKEN for protected API routes." />
      <div className="stack">
        <input
          placeholder="Bearer token"
          value={token}
          onChange={(e) => setLocalToken(e.target.value)}
        />
        <div className="row">
          <button
            onClick={() => {
              setToken(token.trim());
              setMessage("Token saved");
            }}
          >
            Save token
          </button>
          <button
            className="secondary"
            onClick={() => {
              clearToken();
              setLocalToken("");
              setMessage("Token cleared");
            }}
          >
            Clear token
          </button>
        </div>
        {message ? <p className="ok">{message}</p> : null}
      </div>
    </section>
  );
}
