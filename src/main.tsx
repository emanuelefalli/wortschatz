import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { getDB } from "./db/schema";
import { getAllWords, getDatasetTag, getSettings, importWords, pruneBundledWords } from "./db/repo";
import { BUNDLED_DATASET_TAG, BUNDLED_SOURCES, loadBundledWords } from "./data/loader";
import { App } from "./ui/App";
import { StoreProvider } from "./ui/store";
import { autoSync } from "./sync/client";
import "./ui/app.css";

registerSW({ immediate: true });

async function bootstrap() {
  const db = getDB();
  // Seed / refresh the bundled dataset (idempotent, keyed by dataset tag).
  if ((await getDatasetTag(db)) !== BUNDLED_DATASET_TAG) {
    const bundled = loadBundledWords();
    await importWords(db, bundled, BUNDLED_DATASET_TAG);
    await pruneBundledWords(db, new Set(bundled.map((w) => w.id)), BUNDLED_SOURCES);
  }
  // Pull the latest progress from the cloud before the first screen renders (skipped when not configured/offline).
  await autoSync(db, (m) => console.warn("Auto-sync failed:", m));
  const [words, settings] = await Promise.all([getAllWords(db), getSettings(db)]);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <StoreProvider db={db} initialWords={words} initialSettings={settings}>
        <App />
      </StoreProvider>
    </StrictMode>
  );
}

bootstrap().catch((e) => {
  document.getElementById("root")!.innerHTML = `<pre style="padding:16px;white-space:pre-wrap">Failed to start: ${String(e)}</pre>`;
});
