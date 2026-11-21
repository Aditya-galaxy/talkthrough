import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import Shared from "./Shared.tsx";

const shared = location.pathname.match(/^\/g\/([A-Za-z0-9]{8,40})$/);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{shared ? <Shared id={shared[1]} /> : <App />}</StrictMode>,
);
