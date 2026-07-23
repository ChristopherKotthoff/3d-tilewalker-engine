import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Reload the page whenever the runtime game config changes (it's fetched, not imported).
const reloadGameJson = {
  name: "reload-game-json",
  handleHotUpdate({ file, server }: { file: string; server: any }) {
    if (file.endsWith("game.json")) {
      server.ws.send({ type: "full-reload" });
      return [];
    }
  },
};

export default defineConfig({
  plugins: [react(), reloadGameJson],
  server: {
    host: true,
    port: 5173,
    // Poll-based watching so HMR works from inside a Docker bind mount.
    watch: { usePolling: true },
  },
});
