import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import RecordingIndicator from "./RecordingIndicator";

const params = new URLSearchParams(window.location.search);
const view = params.get("view");

let root: React.ReactNode;
if (view === "indicator") {
  document.documentElement.classList.add("is-indicator");
  document.body.classList.add("is-indicator");
  root = <RecordingIndicator />;
} else {
  root = <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{root}</React.StrictMode>,
);
