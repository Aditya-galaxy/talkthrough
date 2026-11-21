/**
 * The faithfulness guard. A model (on-device or cloud) may only tidy up what the person said: its content words
 * must mostly come from the spoken text, and anything quoted (an error message) must survive word for word.
 * The same check runs whichever model answered, so the result never depends on where inference happened.
 */

const STOP = new Set(
  ("the a an and or but to of in on at for with from this that these those it its is are was were be been " +
    "i you we they he she my your our their then now so just here there into onto up down out over")
    .split(" "),
);

/** Lower-cased content words with simple suffixes stripped, so "clicking" and "click" count as the same word. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .map((w) => w.replace(/'s$/, "").replace(/(ing|ed|es|s)$/, ""))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: "empty" | "too-long" | "new-words" | "lost-quote"; detail?: string };

/** Words the instruction style is allowed to add even though nobody says them ("Click", "Open", "Done"). */
const STYLE = new Set(contentWords("click open go select choose type enter press start guide show done result step"));

export function checkRewrite(rewrite: string, said: string, minKept = 0.6): GuardResult {
  const out = rewrite.replace(/\s+/g, " ").trim();
  if (!out) return { ok: false, reason: "empty" };
  if (out.length > said.length * 2.5 + 60) return { ok: false, reason: "too-long" };

  const quotes = [...said.matchAll(/["“]([^"”]{3,})["”]/g)].map((m) => m[1].toLowerCase().replace(/[.!?]+$/, ""));
  const lost = quotes.find((q) => !out.toLowerCase().includes(q));
  if (lost) return { ok: false, reason: "lost-quote", detail: lost };

  const src = new Set(contentWords(said));
  const words = contentWords(out).filter((w) => !STYLE.has(w));
  if (words.length === 0) return { ok: true };
  const added = words.filter((w) => !src.has(w));
  const kept = (words.length - added.length) / words.length;
  if (kept < minKept) return { ok: false, reason: "new-words", detail: [...new Set(added)].slice(0, 5).join(", ") };
  return { ok: true };
}

export function guardMessage(r: GuardResult): string {
  if (r.ok) return "";
  switch (r.reason) {
    case "empty":
      return "The model returned nothing, so your own words were kept.";
    case "too-long":
      return "The rewrite was much longer than what you said, so your own words were kept.";
    case "lost-quote":
      return `The rewrite dropped the exact text "${r.detail}", so your own words were kept.`;
    case "new-words":
      return `The rewrite added words you didn't say (${r.detail}), so your own words were kept.`;
  }
}
