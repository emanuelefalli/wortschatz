import { useMemo, useState } from "react";
import { getAllStates, putState } from "../../db/repo";
import { makeScheduler, markKnown, newLearningState } from "../../domain/scheduler";
import type { CefrLevel, Word } from "../../domain/types";
import { PHASE1_SKILLS, stateKey } from "../../domain/types";
import { useAsync } from "../hooks";
import { navigate } from "../router";
import { useStore } from "../store";

const BATCH = 24;

/** "Mark as already known" flow for experienced learners (spec §9). */
export function Placement() {
  const { db, words, toast } = useStore();
  const levels = useMemo(() => [...new Set(words.map((w) => w.cefrLevel))].sort() as CefrLevel[], [words]);
  const [level, setLevel] = useState<CefrLevel>(levels[0] ?? "A1");
  const [offset, setOffset] = useState(0);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { data: states, refresh } = useAsync(() => getAllStates(db), [db]);

  const pool = useMemo(() => {
    if (!states) return [] as Word[];
    return words.filter((w) => w.cefrLevel === level && !PHASE1_SKILLS.some((sk) => (states.get(stateKey(w.senses[0].id, sk))?.repetitions ?? 0) > 0));
  }, [words, level, states]);
  const batch = pool.slice(offset, offset + BATCH);
  const scheduler = useMemo(() => makeScheduler(), []);

  const commit = async () => {
    setBusy(true);
    try {
      const now = new Date();
      let n = 0;
      for (const w of batch) {
        if (unchecked.has(w.id)) continue;
        for (const s of w.senses) {
          for (const sk of PHASE1_SKILLS) {
            const st = states?.get(stateKey(s.id, sk)) ?? newLearningState(w.id, s.id, sk, now);
            await putState(db, markKnown(scheduler, st, now));
          }
        }
        n++;
      }
      toast(`${n} words marked as known`);
      setUnchecked(new Set());
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h1>Placement</h1>
      <p className="small muted">Tick off the words you already know; they will be scheduled as mature reviews instead of new cards. Untick the ones you want to learn from scratch.</p>
      <div className="row">
        <select aria-label="Level" value={level} onChange={(e) => { setLevel(e.target.value as CefrLevel); setOffset(0); setUnchecked(new Set()); }}>
          {levels.map((l) => (
            <option key={l} value={l}>
              {l} · {words.filter((w) => w.cefrLevel === l).length} words
            </option>
          ))}
        </select>
        <span className="small muted">{pool.length} not started at this level</span>
      </div>
      {batch.length === 0 ? (
        <p className="muted">Every word at this level has been started.</p>
      ) : (
        <>
          <div className="list">
            {batch.map((w) => {
              const known = !unchecked.has(w.id);
              return (
                <label key={w.id} className="list-item" style={{ cursor: "pointer" }}>
                  <span className="row">
                    <input
                      type="checkbox"
                      checked={known}
                      onChange={() =>
                        setUnchecked((u) => {
                          const n = new Set(u);
                          if (n.has(w.id)) n.delete(w.id);
                          else n.add(w.id);
                          return n;
                        })
                      }
                    />
                    <span>
                      <span className="lemma" lang="de">
                        {w.article ? `${w.article} ` : ""}
                        {w.lemma}
                      </span>
                      <span className="meta"> · {w.senses[0].englishAnswers[0]}</span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={commit}>
              Mark {batch.length - [...unchecked].filter((id) => batch.some((w) => w.id === id)).length} as known
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setOffset((o) => o + BATCH); setUnchecked(new Set()); }}>
              Skip these
            </button>
            <button type="button" className="btn ghost" onClick={() => navigate("")}>
              Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}
