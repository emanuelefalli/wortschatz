import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FlashcardDB } from "../db/schema";
import { getAllWords, getSettings, saveSettings } from "../db/repo";
import type { Settings, Word, WordSense } from "../domain/types";

export type AppStore = {
  db: FlashcardDB;
  words: Word[];
  wordById: Map<string, Word>;
  senseById: Map<string, { word: Word; sense: WordSense }>;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  reloadWords: () => Promise<void>;
  toast: (message: string) => void;
};

const Ctx = createContext<AppStore | null>(null);

export function useStore(): AppStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("store missing");
  return s;
}

export function StoreProvider({
  db,
  initialWords,
  initialSettings,
  children
}: {
  db: FlashcardDB;
  initialWords: Word[];
  initialSettings: Settings;
  children: ReactNode;
}) {
  const [words, setWords] = useState(initialWords);
  const [settings, setSettings] = useState(initialSettings);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const wordById = useMemo(() => new Map(words.map((w) => [w.id, w])), [words]);
  const senseById = useMemo(() => {
    const m = new Map<string, { word: Word; sense: WordSense }>();
    for (const w of words) for (const s of w.senses) m.set(s.id, { word: w, sense: s });
    return m;
  }, [words]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...settings, ...patch };
      await saveSettings(db, next);
      setSettings(next);
    },
    [db, settings]
  );

  const reloadWords = useCallback(async () => setWords(await getAllWords(db)), [db]);

  const toast = useCallback((message: string) => setToastMsg(message), []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2500);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    // Settings may be replaced by a backup import; re-read on demand.
    void getSettings(db).then(setSettings);
  }, [db]);

  const value = useMemo<AppStore>(
    () => ({ db, words, wordById, senseById, settings, updateSettings, reloadWords, toast }),
    [db, words, wordById, senseById, settings, updateSettings, reloadWords, toast]
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </Ctx.Provider>
  );
}
