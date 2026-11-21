import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type GenerativeModel, type Part } from "firebase/ai";
import { shrink } from "./capture";
import { firebase, settings } from "./firebase";
import { checkRewrite, guardMessage } from "./guard";
import type { Source, Step } from "./steps";

/**
 * Hybrid rewriting through Firebase AI Logic. With cloud allowed, `PREFER_ON_DEVICE` runs Gemini Nano in Chrome
 * when it's ready and falls back to Gemini in the cloud otherwise. With cloud not allowed, `ONLY_ON_DEVICE`
 * either runs locally or fails, and the step keeps the person's own words.
 */

const STEP_SYSTEM =
  "You turn one spoken step of a screen recording into a written how-to instruction. " +
  "Start with a verb. Keep it short. Drop filler and chit-chat. " +
  "Use only what the step says: never add buttons, names, numbers or details that weren't said. " +
  "The screenshot shows the screen at that moment: use it only to spell and capitalize the names the person said " +
  "the way they appear on screen. Keep quoted text exactly. " +
  'If the step only introduces the task, write "Start here." and what the guide shows. ' +
  'If it only wraps up ("that\'s it"), state the result if one was said, otherwise write "Done."';

// Worked examples: small on-device models follow examples far better than rules alone.
const SHOTS: [string, string][] = [
  ["Okay so first you, um, go to the settings page up here.", "Go to the Settings page."],
  ["Then click on billing.", "Click Billing."],
  ["There's this export button, you click that and pick CSV.", "Click Export and choose CSV."],
  ["So today I'm gonna show you how to reset a password.", "Start here. This guide shows how to reset a password."],
  ['It says "invalid token" so you hit retry.', 'If it says "invalid token", click Retry.'],
  ["And that's it.", "Done."],
];

const STEP_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { text: { type: "string", maxLength: 220 } },
  required: ["text"],
};

type Models = { step: GenerativeModel; title: GenerativeModel };
const cache = new Map<string, Models>();

async function models(allowCloud: boolean): Promise<Models> {
  const s = await settings();
  const key = `${allowCloud}:${s.cloud_model}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ai = getAI(firebase(), { backend: new GoogleAIBackend() });
  const mode = allowCloud ? InferenceMode.PREFER_ON_DEVICE : InferenceMode.ONLY_ON_DEVICE;
  const make = (system: string, schema: Record<string, unknown>, maxOut: number, withImage: boolean) =>
    getGenerativeModel(ai, {
      mode,
      inCloudParams: {
        model: s.cloud_model,
        systemInstruction: system,
        generationConfig: { temperature: 0.1, maxOutputTokens: maxOut, responseMimeType: "application/json", responseJsonSchema: schema },
      },
      onDeviceParams: {
        createOptions: {
          expectedInputs: withImage ? [{ type: "text", languages: ["en"] }, { type: "image" }] : [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
          initialPrompts: [{ role: "system", content: [{ type: "text", value: system }] }],
        },
        promptOptions: { responseConstraint: schema },
      },
    });
  const m = {
    step: make(STEP_SYSTEM, STEP_SCHEMA, 120, true),
    title: make(
      'Write a short title for a how-to guide, under 8 words, starting with "How to". Use only what the steps say.',
      { type: "object", properties: { title: { type: "string", maxLength: 80 } }, required: ["title"] },
      40,
      false,
    ),
  };
  cache.set(key, m);
  return m;
}

export type DeviceState = { status: "unknown" | "downloading" | "ready" | "unavailable"; progress: number; error?: string };

/**
 * Prepares Gemini Nano. Chrome requires this to start from a click; the first call downloads the model
 * (several minutes, and Chrome needs about 22 GB of free disk).
 */
export async function prepareDevice(allowCloud: boolean, onProgress: (p: number) => void): Promise<void> {
  const { step, title } = await models(allowCloud);
  await step.initializeDeviceModel(onProgress);
  await title.initializeDeviceModel();
}

/** Whether Chrome's Prompt API exists and what it says about the model, without starting a download. */
export async function deviceAvailability(): Promise<string> {
  const LM = (globalThis as unknown as { LanguageModel?: { availability(o?: object): Promise<string> } }).LanguageModel;
  if (!LM) return "unsupported";
  try {
    return await LM.availability({ expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }] });
  } catch {
    return "unavailable";
  }
}

function fewShot(said: string) {
  const ex = SHOTS.map(([a, b]) => `Step: ${JSON.stringify(a)}\nAnswer: ${JSON.stringify({ text: b })}`).join("\n\n");
  return `${ex}\n\nStep: ${JSON.stringify(said)}\nAnswer:`;
}

function parse<T>(raw: string): T | undefined {
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  try {
    return JSON.parse(raw.slice(a, b + 1)) as T;
  } catch {
    return undefined;
  }
}

/** Rewrites one step, grounded in its screenshot, and runs the guard on the answer. */
export async function polishStep(step: Step, allowCloud: boolean): Promise<Pick<Step, "text" | "status" | "source" | "note">> {
  const s = await settings();
  const { step: model } = await models(allowCloud);
  const parts: (string | Part)[] = [fewShot(step.said)];
  if (step.shot) {
    const small = await shrink(step.shot, s.screenshot_width);
    parts.push({ type: "inlineData", inlineData: { data: small.split(",")[1], mimeType: "image/jpeg" } });
  }
  const res = await model.generateContent(parts);
  const source = (res.response.inferenceSource ?? (allowCloud ? "in_cloud" : "on_device")) as Source;
  const out = parse<{ text: string }>(res.response.text())?.text ?? "";
  const verdict = checkRewrite(out, step.said, s.guard_min_kept);
  if (!verdict.ok) return { text: step.said, status: "kept", source, note: guardMessage(verdict) };
  return { text: out.replace(/\s+/g, " ").trim(), status: "polished", source };
}

export async function polishTitle(steps: Step[], current: string, allowCloud: boolean): Promise<{ title: string; source: Source }> {
  const s = await settings();
  const { title: model } = await models(allowCloud);
  const lines = steps.map((x) => x.text).join("\n");
  const res = await model.generateContent(lines);
  const source = (res.response.inferenceSource ?? "in_cloud") as Source;
  const t = (parse<{ title: string }>(res.response.text())?.title ?? "").split(/[:–—|]| - /)[0].trim().replace(/\.$/, "");
  const said = steps.map((x) => x.said).join(" ");
  const ok = /^how to\b/i.test(t) && t.length >= 8 && checkRewrite(t.replace(/^how to\s+/i, ""), said, s.guard_min_kept).ok;
  return { title: ok ? t : current, source };
}
