import { useState } from "react";
import { getDailyStats, getLists } from "../../db/repo";
import { localDay } from "../../domain/time";
import type { CefrLevel, SessionConfig } from "../../domain/types";
import { CEFR_LEVELS } from "../../domain/types";
import { useAsync } from "../hooks";
import { navigate } from "../router";
import { useStore } from "../store";

export const SETUP_KEY = "wortschatz.sessionConfig";

export function loadSetup(defaultNewLimit: number): SessionConfig {
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (raw) {
      const cfg = JSON.parse(raw) as SessionConfig;
      if (!["de_en", "en_de", "mixed"].includes(cfg.direction)) cfg.direction = "mixed";
      return cfg;
    }
  } catch {
    /* ignore */
  }
  return { direction: "mixed", levels: ["A1"], cardCount: 20, newWordLimit: defaultNewLimit, filter: "all" };
}

export function SessionSetup() {
  const { db, settings, words } = useStore();
  const [cfg, setCfg] = useState<SessionConfig>(() => loadSetup(settings.dailyNewWordLimit));
  const { data: today } = useAsync(() => getDailyStats(db, localDay()), [db]);
  const { data: lists } = useAsync(() => getLists(db), [db]);
  const remaining = Math.max(0, settings.dailyNewWordLimit - (today?.newWords ?? 0));
  const overLimit = cfg.newWordLimit > remaining;
  const available = new Set(words.map((w) => w.cefrLevel));
  const set = (patch: Partial<SessionConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const toggleLevel = (l: CefrLevel) =>
    set({ levels: cfg.levels.includes(l) ? cfg.levels.filter((x) => x !== l) : [...cfg.levels, l] });

  const start = () => {
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(cfg));
    } catch {
      /* ignore */
    }
    navigate("session");
  };

  return (
    <div className="stack">
      <h1>Session setup</h1>
      <div className="card stack">
        <div className="field">
          <label>Direction</label>
          <div className="segmented" role="radiogroup" aria-label="Direction">
            {(
              [
                ["de_en", "German → English"],
                ["en_de", "English → German"],
                ["mixed", "Mixed"]
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={cfg.direction === v}
                className={`btn ${cfg.direction === v ? "selected" : ""}`}
                onClick={() => set({ direction: v })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="small muted">Typed translation with contextual feedback and audio for every word.</p>
        </div>

        <div className="field">
          <label>Levels</label>
          <div className="segmented">
            {CEFR_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                role="checkbox"
                aria-checked={cfg.levels.includes(l)}
                disabled={!available.has(l)}
                className={`btn ${cfg.levels.includes(l) ? "selected" : ""}`}
                onClick={() => toggleLevel(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Cards</label>
          <div className="segmented">
            {[10, 20, 40, 80].map((n) => (
              <button key={n} type="button" className={`btn ${cfg.cardCount === n ? "selected" : ""}`} onClick={() => set({ cardCount: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>

        {lists && lists.length > 0 && (
          <div className="field">
            <label htmlFor="list">Personal list</label>
            <select id="list" value={cfg.listId ?? ""} onChange={(e) => set({ listId: e.target.value || undefined })}>
              <option value="">All words</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.senseIds.length})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="new-limit">New words this session</label>
          <input
            id="new-limit"
            type="number"
            min={0}
            max={200}
            value={cfg.newWordLimit}
            onChange={(e) => set({ newWordLimit: Math.max(0, Number(e.target.value) || 0) })}
          />
          <span className="small muted">
            {today ? `${remaining} of ${settings.dailyNewWordLimit} new words left today` : `Daily limit ${settings.dailyNewWordLimit}`} · change the limit in Settings
          </span>
          {overLimit && (
            <label className="row small">
              <input type="checkbox" checked={!!cfg.ignoreDailyLimit} onChange={(e) => set({ ignoreDailyLimit: e.target.checked })} />
              Go beyond today's limit for this session ({cfg.newWordLimit} new words)
            </label>
          )}
        </div>

        <div className="field">
          <label htmlFor="filter">Filter</label>
          <select id="filter" value={cfg.filter} onChange={(e) => set({ filter: e.target.value as SessionConfig["filter"] })}>
            <option value="all">Due reviews + new words</option>
            <option value="due">Due reviews only</option>
            <option value="new">New words only</option>
            <option value="weak">Weak words (due, previously failed)</option>
            <option value="nouns">Nouns only (with articles)</option>
            <option value="verbs">Verbs only</option>
          </select>
        </div>
      </div>
      <button type="button" className="btn primary block" disabled={cfg.levels.length === 0} onClick={start}>
        Start
      </button>
    </div>
  );
}
