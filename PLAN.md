# Talkthrough: entry for #BuildHybridAI 2026

**Due:** Mon 30 Nov 2026, 14:00 PT (1 Dec 03:30 IST). Submit by 29 Nov. Judging 10–16 Dec.
**Track:** Web (Chrome), with Firebase AI Logic hybrid inference. App Check is required (debug tokens are accepted).

## The product

You talk through a task while sharing your screen. Talkthrough turns it into a written step-by-step guide, with a screenshot for each step. Everything stays on your computer when Chrome can do it:
- **Speech:** Web Speech with `processLocally` (an on-device language pack). The cloud recogniser is used only if you allow it.
- **Rewriting:** Gemini Nano through Firebase AI Logic, with `PREFER_ON_DEVICE`. Each step's prompt gets **what you said + that step's screenshot**, so button names are spelled the way they appear on screen.
- **Fallback:** when Nano isn't available (another browser, too little disk, model still downloading), the same call goes to Gemini in the cloud, but only if "Allow cloud" is on. Each step shows which one answered (`inferenceSource`).
- **Faithfulness guard** (adapted from my Recap app): a rewrite is accepted only if its content words come from what was said and any quoted text survives word for word. Otherwise the step keeps your own words and says why. The same check runs on on-device and cloud answers.
- **Output:** edit the steps, then export Markdown or a single HTML file. Optionally share a read-only link (Firestore + anonymous Auth). Nothing is uploaded unless you press Share.

## Who it's for

Support, ops and IT people who write the same how-to guides again and again ("how to reset a password in X"), often for internal tools with sensitive screens. On-device by default is the point: screenshots of internal tools shouldn't go to a cloud model unless you allow it.

## Firebase products used

AI Logic (hybrid), App Check (reCAPTCHA Enterprise; debug provider locally), Remote Config (cloud model name, guard threshold, prompts version), Firestore + Auth (anonymous) for shared links, Hosting (the demo).

## Prior work to disclose

Recap (my private app) has a local llama.cpp polish feature. The guard idea and the prompt wording are adapted from it. All Talkthrough code is new, written from 21 Nov.

## Needs from the user

1. **Free about 25 GB of disk.** Chrome won't download Gemini Nano with less than about 22 GB free. This Mac had 3–4 GB on 21 Nov.
2. **Create the Firebase project:**
   - In console.firebase.google.com, create a project (for example `talkthrough-hybrid`) and add a Web app.
   - Go to AI Logic → Get started, and choose the Gemini Developer API (free).
   - Set up App Check with reCAPTCHA Enterprise (site key) and register a debug token.
   - Turn on Firestore and anonymous Auth.
   - Send me the web config (it's public) and the reCAPTCHA site key.
3. **Chrome:** set `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` to Enabled, then restart.
4. **Devpost:** sign in, register for #BuildHybridAI and start the project page. Optionally request the account (Sprint 3 closes Wed 25 Nov 10:00 PT).

## Milestones

| By | Milestone |
|---|---|
| 22 Nov | Speech + screenshot capture + step building working locally (no Firebase needed) |
| 24 Nov | Hybrid polish wired to Firebase, guard, badges, cloud-consent toggle |
| 26 Nov | Export, share links, Remote Config, Hosting deploy |
| 28 Nov | Public repo, README, video |
| 29 Nov | Devpost submission |
