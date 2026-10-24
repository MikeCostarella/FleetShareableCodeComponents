import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles/tokens.css";
import "./styles/global.css";
import "./vendor/a11y/a11y.css";

// Register the service worker. autoUpdate fetches new versions in the background;
// this callback applies them on the next load without prompting.
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
