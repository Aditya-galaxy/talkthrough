# Talkthrough

**Say it once. It writes the guide.**

Share your screen and talk through a task. Talkthrough turns what you say into short written steps, each with a
screenshot, using **Gemini Nano on your own computer** through **Firebase AI Logic hybrid inference**. When Nano
can't run, and only if you allow it, the same request goes to Gemini in the cloud.

**Live demo:** https://talkthrough-hybrid.web.app. Press **Try a sample recording**; no microphone is needed.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/), Web (Chrome) track.

---

## Why it exists

Support, IT and ops people write the same how-to guides again and again: "how to reset a password in X", "how to
export last month's invoices". Recording a video is quick, but nobody wants to scrub through one. Writing the guide
takes an hour of screenshots and copy-editing.

Those guides are usually about **internal tools**, with customer names, invoices and admin screens in every
screenshot. Sending all of that to a cloud model by default is the wrong choice. Talkthrough does the work on the
device and treats the cloud as a fallback that you switch on.

## What it does

1. **Records.** Share a screen and talk. Each time you finish a sentence, Talkthrough grabs a screenshot. Speech is
   transcribed by Chrome's **on-device** recogniser (`SpeechRecognition.processLocally`); Chrome's cloud recogniser is
   used only with "Allow cloud" on.
2. **Builds steps.** Speech fragments are joined into steps; filler ("um", "okay") is dropped.
3. **Writes each step with Gemini**, sending what you said **plus that step's screenshot**, so button names are spelled
   the way they appear on screen.
4. **Checks every answer** against what you said (the *faithfulness guard*, below). A rewrite that adds words you
   didn't say is thrown out, and the step keeps your own words with a note explaining why.
5. **Shows where each step was written**: "on this computer" or "cloud", from the SDK's own `inferenceSource`.
6. **Exports** Markdown or one self-contained HTML file (screenshots embedded), or shares a read-only link.

## How hybrid inference is used

| | On this computer | In the cloud |
|---|---|---|
| Model | Gemini Nano (Chrome Prompt API) | Gemini 3.5 Flash Lite (changeable with Remote Config) |
| When | Chrome on desktop with Nano downloaded | Nano unavailable **and** "Allow cloud" on |
| Firebase mode | `InferenceMode.PREFER_ON_DEVICE` (cloud allowed) or `ONLY_ON_DEVICE` (cloud off) | same call, chosen by the SDK |
| Input | step text + JPEG screenshot (multimodal) | same |
| Output | JSON via `responseConstraint` | JSON via `responseJsonSchema` |

The code is in [`src/lib/ai.ts`](src/lib/ai.ts):

- **One model object serves both paths.** `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })` carries
  the same system instruction and JSON schema for both, so a step reads the same wherever it was written.
- **Nano is prepared after a click.** `initializeDeviceModel()` runs from the "prepare" link, as Chrome requires, and
  shows download progress.
- **Each step records its source.** `response.inferenceSource` (`on_device` / `in_cloud`) is stored per step and
  shown in the guide.
- **Turning the cloud off really turns it off.** The app switches to `ONLY_ON_DEVICE`: no request leaves the browser,
  and a step that Nano can't write keeps the speaker's words.

### The faithfulness guard

Small on-device models are fluent and sometimes inventive. [`src/lib/guard.ts`](src/lib/guard.ts) accepts a rewrite
only if:
- its content words mostly come from what was said;
- any quoted text, such as an error message, survives word for word;
- it isn't empty or runaway-long.

It runs on **every** answer, on-device or cloud, so quality doesn't depend on where inference happened. In the sample,
Gemini reads "Maria Okafor" off the screenshot. The speaker only said "her", so that rewrite is rejected and the
speaker's words are kept. Nothing reaches the guide that you didn't say.

## Firebase products

- **AI Logic:** hybrid inference, on-device plus cloud.
- **App Check:** Fraud Defense (reCAPTCHA Enterprise) in production; the debug provider locally.
- **Remote Config:** the cloud model, the guard's strictness and the screenshot size.
- **Authentication:** anonymous, only when you share.
- **Firestore:** shared guides, write-once and readable by link. See [`firestore.rules`](firestore.rules).
- **Hosting:** the demo, with security headers.

## Privacy

- **Off by default:** with "Allow cloud" off, voice, screenshots and text stay in the browser.
- **Share is opt-in:** it uploads only the title, the final step text and shrunk screenshots. What you said, and which
  model wrote each step, stay on your computer.
- **Nothing tracks you:** no analytics or tracking scripts.

## Run it yourself

You need Node 20+ and a Firebase project.

```bash
git clone https://github.com/Aditya-galaxy/talkthrough && cd talkthrough
npm install
cp .env.example .env.local      # fill in your Firebase web config
npm run dev                     # http://localhost:5173
npm test                        # guard and step-building tests
```

Set up the Firebase project in the console:
1. Add a **Web app**, and copy its config into `.env.local`.
2. Go to **AI Logic → Get started**. Choose the Gemini Developer API (free, no billing), or the Agent Platform Gemini
   API if the project has billing. Set `VITE_AI_BACKEND` to match (`google` or `agent-platform`).
3. In **App Check**, register the web app with reCAPTCHA Enterprise for production. For localhost, add a debug token
   and put it in `VITE_APPCHECK_DEBUG_TOKEN`; never commit it.
4. Create **Firestore** (Standard edition) and publish `firestore.rules`.
5. Turn on **Authentication → Anonymous**.

For on-device inference in Chrome:
1. Use desktop Chrome 139 or later with about 22 GB of free disk.
2. Set `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` to **Enabled**, and restart Chrome.
3. Open the app and click **prepare** next to "Gemini Nano". The first download takes a few minutes.
4. Optional, for on-device speech: click **install** next to "Speech".

## Testing it as a judge

1. Open the live demo in **desktop Chrome**.
2. Press **Try a sample recording**. It loads a real narrated walkthrough of a made-up admin console, with filler words
   and screenshots.
3. Without Nano, turn on **Allow cloud** and press **Write the steps**: each step gets a "cloud" tag. With Nano
   prepared, steps are tagged "on this computer", and turning the cloud off keeps everything local.
4. Export HTML, or **Share link** to open the read-only page.

## Built during the hackathon

All of Talkthrough was written for #BuildHybridAI, from 21 Nov 2026. The guard's approach and the worked-example
prompts are adapted from my earlier app, Recap, a local screen recorder that polishes guides with a llama.cpp model.
Nothing else is reused. The sample screenshots are from a made-up app ([`tools/mock-admin.html`](tools/mock-admin.html)).

## License

MIT
