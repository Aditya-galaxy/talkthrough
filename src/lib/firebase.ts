import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { fetchAndActivate, getRemoteConfig, getValue, type RemoteConfig } from "firebase/remote-config";

/** The web config is public by design (App Check, not secrecy, protects the backend). It comes from .env.local. */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY as string | undefined;

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | undefined;
let rc: RemoteConfig | undefined;

/** Defaults used until Remote Config answers (or when it can't be reached, e.g. offline). */
export const DEFAULTS = {
  cloud_model: "gemini-3.5-flash-lite",
  guard_min_kept: 0.6,
  screenshot_width: 768,
};

export function firebase(): FirebaseApp {
  if (!firebaseConfigured) throw new Error("Firebase isn't configured. Copy .env.example to .env.local and fill it in.");
  if (app) return app;
  app = initializeApp(config);
  // Local development uses App Check's debug provider; the token it prints must be registered in the console.
  if (import.meta.env.DEV) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
  if (siteKey || import.meta.env.DEV)
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey ?? "debug"), isTokenAutoRefreshEnabled: true });
  return app;
}

/** Remote Config lets the cloud model and the guard's strictness change without a redeploy. */
export async function settings(): Promise<typeof DEFAULTS> {
  if (!firebaseConfigured) return DEFAULTS;
  try {
    rc ??= getRemoteConfig(firebase());
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 3_600_000;
    rc.defaultConfig = DEFAULTS;
    await fetchAndActivate(rc);
    return {
      cloud_model: getValue(rc, "cloud_model").asString() || DEFAULTS.cloud_model,
      guard_min_kept: getValue(rc, "guard_min_kept").asNumber() || DEFAULTS.guard_min_kept,
      screenshot_width: getValue(rc, "screenshot_width").asNumber() || DEFAULTS.screenshot_width,
    };
  } catch {
    return DEFAULTS;
  }
}
