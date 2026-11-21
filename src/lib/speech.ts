/**
 * Speech to text with Chrome's Web Speech API. On-device recognition (`processLocally`, Chrome on desktop) keeps
 * the voice on this computer; Chrome's cloud recogniser is used only when the person allows cloud processing.
 */

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
};
type RecCtor = (new () => Rec) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

const Ctor = (): RecCtor | undefined =>
  (globalThis as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }).SpeechRecognition ??
  (globalThis as unknown as { webkitSpeechRecognition?: RecCtor }).webkitSpeechRecognition;

export type SpeechMode = "on_device" | "in_cloud" | "none";

/** Which recogniser can run here: on-device if its language pack is (or can be) installed, else the cloud one. */
export async function speechSupport(lang = "en-US"): Promise<{ local: Awaited<ReturnType<NonNullable<RecCtor["available"]>>> | "unsupported"; cloud: boolean }> {
  const C = Ctor();
  if (!C) return { local: "unsupported", cloud: false };
  const local = C.available ? await C.available({ langs: [lang], processLocally: true }).catch(() => "unavailable" as const) : "unsupported";
  return { local, cloud: true };
}

/** Downloads the on-device language pack. Must be called from a click. */
export async function installLocalSpeech(lang = "en-US"): Promise<boolean> {
  const C = Ctor();
  return C?.install ? C.install({ langs: [lang], processLocally: true }).catch(() => false) : false;
}

export class Listener {
  private rec?: Rec;
  private wanted = false;
  mode: SpeechMode = "none";
  onFinal?: (text: string) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;

  /** Starts listening; `local` asks for on-device recognition. Restarts itself after Chrome's silence timeouts. */
  start(local: boolean, lang = "en-US") {
    const C = Ctor();
    if (!C) throw new Error("This browser has no speech recognition. Use Chrome on a desktop computer.");
    this.wanted = true;
    this.mode = local ? "on_device" : "in_cloud";
    const rec = new C();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    if (local) rec.processLocally = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript;
        if (r.isFinal) this.onFinal?.(t.trim());
        else interim += t;
      }
      this.onInterim?.(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.wanted = false;
      this.onError?.(
        e.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in the address bar and try again."
          : e.error === "language-not-supported" && local
            ? "On-device speech isn't ready for English yet. Install it, or allow cloud processing."
            : `Speech recognition stopped (${e.error}).`,
      );
    };
    rec.onend = () => {
      if (this.wanted) rec.start();
    };
    this.rec = rec;
    rec.start();
  }

  stop() {
    this.wanted = false;
    this.rec?.stop();
  }
}
