import type { Segment } from "./steps";

/**
 * A short recorded walkthrough of a made-up admin console ("Fernhill Admin"), for trying Talkthrough without a
 * microphone. The lines are what someone actually says while doing the task, filler included; the screenshots
 * were rendered from tools/mock-admin.html.
 */
const LINES: [string, string][] = [
  ["Okay so today I'm gonna show you how to reset someone's password in the admin console.", "home"],
  ["First you go to the users page, it's on the left here.", "users"],
  ["Then search for the person, I'll just type maria.", "search"],
  ["Click on her name to open her profile.", "profile"],
  ["And there's this reset password button, um, you click that.", "dialog"],
  ['It says "send reset link" so you hit that and it emails her.', "done"],
  ["And that's it.", "done"],
];

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Screenshots become data URLs, like real captures, so exports and share links carry them. */
export async function loadSample(): Promise<Segment[]> {
  const shots = new Map<string, string>();
  for (const name of new Set(LINES.map(([, s]) => s))) shots.set(name, await toDataUrl(`/sample/${name}.jpg`));
  const t0 = Date.now();
  return LINES.map(([text, s], i) => ({ text, at: t0 + i * 4000, shot: shots.get(s) }));
}

export const SAMPLE_TITLE = "How to reset a user's password";
