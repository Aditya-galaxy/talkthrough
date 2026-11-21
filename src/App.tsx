import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { deviceAvailability, polishStep, polishTitle, prepareDevice } from "./lib/ai";
import { ScreenGrabber } from "./lib/capture";
import { firebase, firebaseConfigured, settings } from "./lib/firebase";
import { installLocalSpeech, Listener, speechSupport } from "./lib/speech";
import { buildSteps, toHtml, toMarkdown, type Segment, type Step } from "./lib/steps";

type Phase = "idle" | "recording" | "editing";

const pref = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === "1";
  } catch {
    return d;
  }
};
const savePref = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? "1" : "0");
  } catch {
    /* private mode: the choice just isn't remembered */
  }
};

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "guide";

export default function App() {
  const [allowCloud, setAllowCloud] = useState(() => pref("tt.cloud", false));
  const [speech, setSpeech] = useState<string>("checking");
  const [nano, setNano] = useState<{ status: string; progress: number }>({ status: "checking", progress: 0 });
  const [phase, setPhase] = useState<Phase>("idle");
  const [interim, setInterim] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [title, setTitle] = useState("How to …");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listener = useRef<Listener | null>(null);
  const grabber = useRef<ScreenGrabber | null>(null);

  useEffect(() => {
    // Start App Check (and Remote Config) at load, so the first AI call doesn't wait on attestation.
    if (firebaseConfigured) {
      try {
        firebase();
        settings();
      } catch (e) {
        setError((e as Error).message);
      }
    }
    speechSupport().then((s) => setSpeech(s.local === "unsupported" ? (s.cloud ? "cloud-only" : "unsupported") : s.local));
    deviceAvailability().then((a) => setNano({ status: a, progress: 0 }));
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (steps.length || segments.length) e.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [steps.length, segments.length]);

  const toggleCloud = (v: boolean) => {
    setAllowCloud(v);
    savePref("tt.cloud", v);
  };

  const installSpeech = async () => {
    setSpeech("downloading");
    const ok = await installLocalSpeech();
    const s = await speechSupport();
    setSpeech(ok ? String(s.local) : "unavailable");
  };

  const prepareNano = async () => {
    setError("");
    setNano({ status: "downloading", progress: 0 });
    try {
      await prepareDevice(allowCloud, (p) => setNano({ status: "downloading", progress: p }));
      setNano({ status: await deviceAvailability(), progress: 1 });
    } catch (e) {
      setNano({ status: "unavailable", progress: 0 });
      setError(`Gemini Nano couldn't start: ${(e as Error).message}`);
    }
  };

  const stopRecording = useCallback(() => {
    listener.current?.stop();
    grabber.current?.stop();
    setInterim("");
    setPhase("editing");
  }, []);

  useEffect(() => {
    if (phase === "editing" && segments.length && !steps.length) setSteps(buildSteps(segments));
  }, [phase, segments, steps.length]);

  const startRecording = async () => {
    setError("");
    const local = speech === "available";
    if (!local && !allowCloud) {
      setError("On-device speech isn't installed yet. Install it, or allow cloud processing.");
      return;
    }
    const g = new ScreenGrabber();
    try {
      await g.start();
    } catch {
      setError("Screen sharing was cancelled. Talkthrough needs it for the step screenshots.");
      return;
    }
    g.onEnded = stopRecording;
    grabber.current = g;
    const l = new Listener();
    l.onInterim = setInterim;
    l.onFinal = (text) => setSegments((s) => [...s, { text, at: Date.now(), shot: g.grab() }]);
    l.onError = (m) => {
      setError(m);
      stopRecording();
    };
    listener.current = l;
    setSegments([]);
    setSteps([]);
    setTitle("How to …");
    try {
      l.start(local);
      setPhase("recording");
    } catch (e) {
      g.stop();
      setError((e as Error).message);
    }
  };

  const polishAll = async () => {
    if (!firebaseConfigured) {
      setError("AI rewriting needs a Firebase project. See the README.");
      return;
    }
    setBusy(true);
    setError("");
    let current = steps;
    for (const st of steps) {
      if (st.status === "edited" || st.status === "polished") continue;
      setSteps((all) => all.map((x) => (x.id === st.id ? { ...x, status: "polishing" } : x)));
      try {
        const r = await polishStep(st, allowCloud);
        current = current.map((x) => (x.id === st.id ? { ...x, ...r } : x));
      } catch (e) {
        const msg = (e as Error).message;
        const note = !allowCloud && /device|unavailable|ONLY_ON_DEVICE/i.test(msg)
          ? "Gemini Nano isn't ready on this computer, and cloud is off, so your own words were kept."
          : `Couldn't rewrite this step: ${msg}`;
        current = current.map((x) => (x.id === st.id ? { ...x, status: "error", note } : x));
      }
      setSteps(current);
    }
    try {
      const t = await polishTitle(current, title, allowCloud);
      setTitle(t.title);
    } catch {
      /* the title is optional: keep the current one */
    }
    setBusy(false);
  };

  const edit = (id: string, text: string) =>
    setSteps((all) => all.map((x) => (x.id === id ? { ...x, text, status: "edited", note: undefined } : x)));
  const remove = (id: string) => setSteps((all) => all.filter((x) => x.id !== id));
  const move = (id: string, d: -1 | 1) =>
    setSteps((all) => {
      const i = all.findIndex((x) => x.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const onDevice = steps.filter((s) => s.source === "on_device").length;
  const inCloud = steps.filter((s) => s.source === "in_cloud").length;

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M4 12h16M4 18h7" /></svg>
          Talkthrough
        </div>
        <label className="cloud">
          <input type="checkbox" checked={allowCloud} onChange={(e) => toggleCloud(e.target.checked)} />
          <span>Allow cloud when this computer can't</span>
        </label>
      </header>

      <section className="status" aria-label="Where your data is processed">
        <Chip label="Speech" state={speech} onFix={speech === "downloadable" ? installSpeech : undefined} fixLabel="Install on-device speech" />
        <Chip
          label="Gemini Nano"
          state={nano.status}
          progress={nano.progress}
          onFix={nano.status === "downloadable" || nano.status === "unknown" ? prepareNano : undefined}
          fixLabel="Prepare Gemini Nano"
        />
        {!firebaseConfigured && <span className="chip warn">Firebase not configured</span>}
      </section>
      {(nano.status === "unavailable" || nano.status === "unsupported") && (
        <p className="hint">
          Gemini Nano needs Chrome on a desktop computer (version 139 or later) with about 22 GB of free disk, and{" "}
          <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code> enabled.{" "}
          {allowCloud ? "Until then, steps are written in the cloud." : "Turn on “Allow cloud” to write steps in the cloud meanwhile."}
        </p>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      {phase === "idle" && (
        <section className="hero">
          <h1>Talk through a task.<br />Get a written guide.</h1>
          <p className="lead">
            Share your screen and say what you're doing. Talkthrough writes each step as a short instruction with a
            screenshot, using Gemini Nano on this computer. Nothing leaves it unless you allow the cloud.
          </p>
          <button className="primary" onClick={startRecording}>Start recording</button>
        </section>
      )}

      {phase === "recording" && (
        <section className="recording">
          <div className="rec-head">
            <span className="dot" aria-hidden="true" /> Recording · {segments.length} {segments.length === 1 ? "line" : "lines"}
            <button className="primary" onClick={stopRecording}>Stop and build the guide</button>
          </div>
          <p className="interim" aria-live="polite">{interim || "Listening…"}</p>
          <ol className="lines">
            {segments.slice(-6).map((s) => <li key={s.at}>{s.text}</li>)}
          </ol>
        </section>
      )}

      {phase === "editing" && (
        <section className="guide">
          <div className="guide-head">
            <input className="title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Guide title" />
            <div className="actions">
              <button className="primary" onClick={polishAll} disabled={busy || !steps.length}>
                {busy ? "Writing…" : "Write the steps with AI"}
              </button>
              <button onClick={() => download(`${slug(title)}.md`, toMarkdown(title, steps), "text/markdown")} disabled={!steps.length}>Markdown</button>
              <button onClick={() => download(`${slug(title)}.html`, toHtml(title, steps), "text/html")} disabled={!steps.length}>HTML</button>
              <button onClick={() => { setPhase("idle"); setSegments([]); setSteps([]); }}>New</button>
            </div>
          </div>
          {(onDevice > 0 || inCloud > 0) && (
            <p className="summary">
              {onDevice} {onDevice === 1 ? "step" : "steps"} written on this computer · {inCloud} in the cloud
            </p>
          )}
          {!steps.length && <p className="empty">Nothing was heard. Check the microphone and record again.</p>}
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.id} className={`step ${s.status}`}>
                <div className="step-text">
                  <span className="num">{i + 1}</span>
                  <textarea value={s.text} rows={2} onChange={(e) => edit(s.id, e.target.value)} aria-label={`Step ${i + 1}`} />
                  <div className="meta">
                    {s.source && <span className={`badge ${s.source}`}>{s.source === "on_device" ? "On this computer" : "Cloud"}</span>}
                    {s.status === "polishing" && <span className="badge">Writing…</span>}
                    {s.status === "edited" && <span className="badge">Edited</span>}
                    <span className="said">You said: “{s.said}”</span>
                    {s.note && <span className="note">{s.note}</span>}
                  </div>
                  <div className="step-tools">
                    <button onClick={() => move(s.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button onClick={() => move(s.id, 1)} disabled={i === steps.length - 1} aria-label="Move down">↓</button>
                    <button onClick={() => remove(s.id)} aria-label="Delete step">Delete</button>
                  </div>
                </div>
                {s.shot && <img src={s.shot} alt={`Screen at step ${i + 1}`} />}
              </li>
            ))}
          </ol>
        </section>
      )}
      <footer className="foot">Speech, screenshots and rewriting stay in this browser unless “Allow cloud” is on.</footer>
    </div>
  );
}

const LABEL: Record<string, string> = {
  checking: "checking…",
  available: "on this computer",
  readily: "on this computer",
  downloadable: "not installed",
  downloading: "downloading…",
  "after-download": "not installed",
  unavailable: "not available here",
  unsupported: "not supported in this browser",
  "cloud-only": "cloud only",
  unknown: "not checked",
};

function Chip({ label, state, progress, onFix, fixLabel }: { label: string; state: string; progress?: number; onFix?: () => void; fixLabel: string }) {
  const good = state === "available" || state === "readily";
  const text = state === "downloading" && progress ? `downloading ${Math.round(progress * 100)}%` : LABEL[state] ?? state;
  return (
    <span className={`chip ${good ? "good" : ""}`}>
      <b>{label}</b> {text}
      {onFix && <button className="link" onClick={onFix}>{fixLabel}</button>}
    </span>
  );
}
