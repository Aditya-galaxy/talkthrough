import { useEffect, useState } from "react";
import { loadShared, type SharedGuide } from "./lib/share";

/** The read-only page a share link opens. */
export default function Shared({ id }: { id: string }) {
  const [guide, setGuide] = useState<SharedGuide | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    loadShared(id).then(setGuide, (e) => setError(String(e.message ?? e)));
  }, [id]);

  useEffect(() => {
    if (guide) document.title = `${guide.title} · Talkthrough`;
  }, [guide]);

  return (
    <div className="page shared">
      <header className="top">
        <a className="brand" href="/">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M4 12h16M4 18h7" /></svg>
          Talkthrough
        </a>
      </header>
      {error && <p className="error" role="alert">Couldn't open this guide: {error}</p>}
      {guide === undefined && !error && <p className="summary">Loading…</p>}
      {guide === null && <p className="error">This guide doesn't exist, or the link is wrong.</p>}
      {guide && (
        <article>
          <h1 className="shared-title">{guide.title}</h1>
          <ol className="steps">
            {guide.steps.map((s, i) => (
              <li key={i} className="step">
                <div className="step-text">
                  <span className="num">{i + 1}</span>
                  <p className="shared-text">{s.text}</p>
                </div>
                {s.shot && <img src={s.shot} alt={`Step ${i + 1}`} />}
              </li>
            ))}
          </ol>
        </article>
      )}
      <footer className="foot">Made with Talkthrough: written on the author's computer with Gemini Nano where possible.</footer>
    </div>
  );
}
