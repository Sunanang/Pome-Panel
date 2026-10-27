import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";
import "./controls.css";
import "./localization.css";
import { LanguageProvider } from './i18n/context.jsx';

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LanguageProvider><App /></LanguageProvider>
  </React.StrictMode>,
);
