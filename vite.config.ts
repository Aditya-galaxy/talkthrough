import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// All Firebase entry points are pre-bundled together. If Vite discovers one later (a new import), it re-bundles
// mid-session and the page ends up with two copies of @firebase/app, so services silently never attach.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "firebase/app",
      "firebase/app-check",
      "firebase/ai",
      "firebase/auth",
      "firebase/firestore",
      "firebase/remote-config",
    ],
  },
});
