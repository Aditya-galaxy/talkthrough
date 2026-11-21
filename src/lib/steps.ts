/** A finished stretch of speech, with the screen as it looked when the person finished saying it. */
export type Segment = { text: string; at: number; shot?: string };

export type Source = "on_device" | "in_cloud";

export type Step = {
  id: string;
  said: string;
  shot?: string;
  /** The text shown in the guide: the accepted rewrite, the person's own words, or their manual edit. */
  text: string;
  status: "spoken" | "polishing" | "polished" | "kept" | "edited" | "error";
  source?: Source;
  note?: string;
};

const FILLER = /^(um+|uh+|er+|okay|ok|so|right|alright|and)[,.!?\s]*$/i;

/**
 * Speech recognisers end a result at every short pause, which splits one instruction into fragments.
 * Fragments are joined until a step reads as a sentence; a fragment that is only filler is dropped.
 */
export function buildSteps(segments: Segment[], minChars = 18): Step[] {
  const steps: Step[] = [];
  let buf: Segment[] = [];
  const flush = () => {
    if (!buf.length) return;
    const said = buf.map((s) => s.text.trim()).join(" ").replace(/\s+/g, " ").trim();
    // The last fragment's screenshot shows the screen after the action was described.
    const shot = [...buf].reverse().find((s) => s.shot)?.shot;
    if (said) steps.push({ id: crypto.randomUUID(), said, shot, text: said, status: "spoken" });
    buf = [];
  };
  for (const s of segments) {
    if (!s.text.trim() || FILLER.test(s.text.trim())) continue;
    buf.push(s);
    const joined = buf.map((b) => b.text).join(" ");
    if (joined.length >= minChars) flush();
  }
  flush();
  return steps;
}

export function toMarkdown(title: string, steps: Step[]): string {
  const lines = [`# ${title}`, ""];
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.text}`);
    if (s.shot) lines.push("", `   ![Step ${i + 1}](${s.shot})`);
    lines.push("");
  });
  return lines.join("\n");
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One self-contained HTML file: screenshots are embedded, so it opens offline and can be emailed. */
export function toHtml(title: string, steps: Step[]): string {
  const items = steps
    .map((s, i) =>
      `<li><p>${esc(s.text)}</p>${s.shot ? `<img alt="Step ${i + 1}" src="${s.shot}">` : ""}</li>`)
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font:17px/1.55 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1b1d22;background:#fff}
h1{font-size:30px;margin-bottom:24px}ol{padding-left:22px}li{margin:0 0 28px}li p{margin:0 0 10px;font-weight:550}
img{max-width:100%;border:1px solid #e3e3e8;border-radius:10px}footer{color:#777;font-size:13px;margin-top:40px}
@media (prefers-color-scheme:dark){body{background:#15161a;color:#ececf1}img{border-color:#333}}
</style></head><body><h1>${esc(title)}</h1><ol>
${items}
</ol><footer>Made with Talkthrough</footer></body></html>`;
}
