import { getAuth, signInAnonymously } from "firebase/auth";
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";
import { shrink } from "./capture";
import { firebase } from "./firebase";
import type { Step } from "./steps";

/**
 * Read-only share links. Only what the person chose to share is uploaded: the title, the final step text and a
 * small copy of each screenshot. What they said and which model wrote each step stay on their computer.
 */

export type SharedGuide = { title: string; steps: { text: string; shot?: string }[] };

const MAX_DOC = 950_000; // Firestore's limit is 1 MiB per document; keep a margin for field names.

export async function shareGuide(title: string, steps: Step[]): Promise<string> {
  const app = firebase();
  const auth = getAuth(app);
  const user = auth.currentUser ?? (await signInAnonymously(auth)).user;

  // Screenshots are shrunk until the whole guide fits in one document.
  let width = 960;
  let out: SharedGuide["steps"] = [];
  for (;;) {
    out = await Promise.all(
      steps.slice(0, 40).map(async (s) => ({ text: s.text.slice(0, 600), ...(s.shot ? { shot: await shrink(s.shot, width, 0.6) } : {}) })),
    );
    const size = JSON.stringify(out).length + title.length;
    if (size < MAX_DOC || width <= 320) break;
    width = Math.round(width * 0.75);
  }
  if (JSON.stringify(out).length >= MAX_DOC) out = out.map(({ text }) => ({ text }));

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  await setDoc(doc(getFirestore(app), "guides", id), {
    owner: user.uid,
    title: title.slice(0, 120),
    steps: out,
    created: serverTimestamp(),
  });
  return `${location.origin}/g/${id}`;
}

export async function loadShared(id: string): Promise<SharedGuide | null> {
  const snap = await getDoc(doc(getFirestore(firebase()), "guides", id));
  if (!snap.exists()) return null;
  const d = snap.data() as SharedGuide;
  return { title: d.title, steps: d.steps ?? [] };
}
