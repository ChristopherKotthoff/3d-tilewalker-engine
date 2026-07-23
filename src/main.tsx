import ReactDOM from "react-dom/client";
import { App } from "./App";

// NB: no <React.StrictMode>. Its dev-only mount→unmount→remount double-invoke
// double-registers 3d-tiles-renderer plugins, whose init/dispose isn't
// idempotent — it corrupts the TilesRenderer and freezes the frame loop.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
