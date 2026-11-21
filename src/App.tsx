import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { deviceAvailability, polishStep, polishTitle, prepareDevice } from "./lib/ai";
import { ScreenGrabber } from "./lib/capture";
import { firebase, firebaseConfigured, settings } from "./lib/firebase";
import { installLocalSpeech, Listener, speechSupport } from "./lib/speech";
import { loadSample, SAMPLE_TITLE } from "./lib/sample";
import { shareGuide } from "./lib/share";
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
  const [link, setLink] = useState("");
  const [sharing, setSharing] = useState(false);
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

  const trySample = async () => {
    setError("");
    try {
      const segs = await loadSample();
      setSegments(segs);
      setSteps(buildSteps(segs));
      setTitle(SAMPLE_TITLE);
      setLink("");
      setPhase("editing");
    } catch (e) {
      setError(`Couldn't load the sample: ${(e as Error).message}`);
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

  const share = async () => {
    if (!confirm("Upload this guide's title, steps and screenshots so anyone with the link can read it?")) return;
    setSharing(true);
    setError("");
    try {
      setLink(await shareGuide(title, steps));
    } catch (e) {
      setError(`Couldn't share: ${(e as Error).message}`);
    }
    setSharing(false);
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

  const nanoReady = nano.status === "available" || nano.status === "readily";
  const canWrite = nanoReady || allowCloud;
  const reset = () => { setPhase("idle"); setSegments([]); setSteps([]); setLink(""); };

  return (
    <div className="page">
      <header className="top">
        <button className="wordmark" onClick={phase === "editing" ? reset : undefined} aria-label="Talkthrough home">
          <span className="rec" aria-hidden="true" />Talkthrough
        </button>
        <label className="toggle">
          <input type="checkbox" checked={allowCloud} onChange={(e) => toggleCloud(e.target.checked)} />
          <span className="track" aria-hidden="true" />
          <span>Allow cloud</span>
        </label>
      </header>

      <p className="where" aria-label="Where your data is processed">
        <Status label="Speech" state={speech} onFix={speech === "downloadable" ? installSpeech : undefined} fixLabel="install" />
        <Status
          label="Gemini Nano"
          state={nano.status}
          progress={nano.progress}
          onFix={nano.status === "downloadable" || nano.status === "unknown" ? prepareNano : undefined}
          fixLabel="prepare"
        />
        <span className="cloud-state">{allowCloud ? "Cloud allowed as a fallback" : "Cloud off: nothing leaves this computer"}</span>
      </p>

      {error && <p className="error" role="alert">{error}</p>}

      {phase === "idle" && (
        <main className="hero">
          <h1>Say it once.<br /><em>It writes the guide.</em></h1>
          <p className="lead">
            Share your screen and talk through a task. Talkthrough turns what you say into short written steps, each
            with a screenshot, using Gemini Nano on your own computer.
          </p>
          <div className="cta">
            <button className="primary" onClick={startRecording}><span className="rec" aria-hidden="true" />Start recording</button>
            <button className="quiet" onClick={trySample}>Try a sample recording</button>
          </div>
          <ol className="how">
            <li><b>Talk</b>while you share your screen. A screenshot is taken each time you finish a sentence.</li>
            <li><b>Write</b>with Gemini Nano in Chrome. If it can't run here and you allow it, Gemini in the cloud takes over.</li>
            <li><b>Check</b>every rewrite against what you said. Anything you didn't say is thrown out, not shown.</li>
          </ol>
          {!nanoReady && nano.status !== "checking" && (
            <p className="hint">
              Gemini Nano needs desktop Chrome 139+, about 22 GB of free disk, and{" "}
              <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code> enabled.
            </p>
          )}
        </main>
      )}

      {phase === "recording" && (
        <main className="recording">
          <p className="rec-line"><span className="rec live" aria-hidden="true" />Recording · {segments.length} {segments.length === 1 ? "line" : "lines"}</p>
          <p className="interim" aria-live="polite">{interim || "Listening…"}</p>
          <ol className="lines">{segments.slice(-5).map((s) => <li key={s.at}>{s.text}</li>)}</ol>
          <button className="primary" onClick={stopRecording}>Stop and build the guide</button>
        </main>
      )}

      {phase === "editing" && (
        <main className="guide">
          <textarea className="title" rows={1} value={title} onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))} aria-label="Guide title" />
          <div className="toolbar">
            <button className="primary" onClick={polishAll} disabled={busy || !steps.length || !canWrite}>
              {busy ? "Writing…" : "Write the steps"}
            </button>
            <span className="sep" />
            <button className="quiet" onClick={() => download(`${slug(title)}.md`, toMarkdown(title, steps), "text/markdown")} disabled={!steps.length}>Markdown</button>
            <button className="quiet" onClick={() => download(`${slug(title)}.html`, toHtml(title, steps), "text/html")} disabled={!steps.length}>HTML</button>
            <button className="quiet" onClick={share} disabled={!steps.length || sharing || !firebaseConfigured}>{sharing ? "Sharing…" : "Share link"}</button>
            <button className="quiet" onClick={reset}>New</button>
          </div>
          {!canWrite && <p className="hint">Gemini Nano isn't ready in this browser. Turn on “Allow cloud” to write the steps with Gemini in the cloud.</p>}
          {link && (
            <p className="link-out">
              Read-only link: <a href={link} target="_blank" rel="noreferrer">{link}</a>{" "}
              <button className="text" onClick={() => navigator.clipboard.writeText(link)}>copy</button>
            </p>
          )}
          {(onDevice > 0 || inCloud > 0) && (
            <p className="tally"><span className="dot device" />{onDevice} written on this computer <span className="dot cloud" />{inCloud} in the cloud</p>
          )}
          {!steps.length && <p className="hint">Nothing was heard. Check the microphone and record again.</p>}
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.id} className={`step ${s.status}`}>
                <span className="num">{String(i + 1).padStart(2, "0")}</span>
                <div className="body">
                  <textarea value={s.text} rows={2} onChange={(e) => edit(s.id, e.target.value)} aria-label={`Step ${i + 1}`} />
                  <p className="meta">
                    {s.source && <span className={`tag ${s.source}`}>{s.source === "on_device" ? "on this computer" : "cloud"}</span>}
                    {s.status === "polishing" && <span className="tag">writing…</span>}
                    {s.status === "edited" && <span className="tag">edited</span>}
                    <span className="said">“{s.said}”</span>
                  </p>
                  {s.note && <p className="note">{s.note}</p>}
                  {s.shot && <img src={s.shot} alt={`Screen at step ${i + 1}`} />}
                  <p className="tools">
                    <button className="text" onClick={() => move(s.id, -1)} disabled={i === 0}>up</button>
                    <button className="text" onClick={() => move(s.id, 1)} disabled={i === steps.length - 1}>down</button>
                    <button className="text" onClick={() => remove(s.id)}>delete</button>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </main>
      )}
      <footer className="foot">Built on Firebase AI Logic hybrid inference · Gemini Nano first, cloud only with your say-so.</footer>
    </div>
  );
}

const LABEL: Record<string, string> = {
  checking: "checking",
  available: "on this computer",
  readily: "on this computer",
  downloadable: "not installed",
  downloading: "downloading",
  "after-download": "not installed",
  unavailable: "unavailable here",
  unsupported: "unsupported here",
  "cloud-only": "cloud only",
  unknown: "not checked",
};

function Status({ label, state, progress, onFix, fixLabel }: { label: string; state: string; progress?: number; onFix?: () => void; fixLabel: string }) {
  const good = state === "available" || state === "readily";
  const text = state === "downloading" && progress ? `downloading ${Math.round(progress * 100)}%` : LABEL[state] ?? state;
  return (
    <span className={`status ${good ? "good" : ""}`}>
      <span className="dot" aria-hidden="true" />{label}: {text}
      {onFix && <> · <button className="text" onClick={onFix}>{fixLabel}</button></>}
    </span>
  );
}
