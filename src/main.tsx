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

// The webview's own right-click menu (Back, Refresh, Save as, Print…)
// has nothing to do with Glattice and looks out of place. Turn it off
// everywhere except text fields, where Cut / Copy / Paste are useful.
// Views that want a menu of their own (the Frames grid) open theirs from
// their own handlers.
window.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName?.toLowerCase();
  const isTextField =
    tag === "textarea" ||
    target?.isContentEditable === true ||
    (tag === "input" &&
      ["text", "search", "url", "email", "password", "number"].includes(
        (target as HTMLInputElement).type,
      ));
  if (!isTextField) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{root}</React.StrictMode>,
);
