import { useMemo, useState } from "react";
import { addReport, deleteCustomAnswer, getAllStates, getCustomAnswersForSense, getLists, getLogForSense, putState, saveList, toggleInList } from "../../db/repo";
import { makeScheduler, markKnown, maturity, newLearningState } from "../../domain/scheduler";
import { formatRelativeDue } from "../../domain/time";
import type { LearningState, Skill, Word, WordSense } from "../../domain/types";
import { PHASE1_SKILLS, stateKey } from "../../domain/types";
import { ExampleSentence, GrammarForms, Headword, Notes, SpeakButton } from "../components/WordInfo";
import { ReportDialog } from "../components/ReportDialog";
import { useAsync } from "../hooks";
import { useStore } from "../store";

const SKILL_LABEL: Record<Skill, string> = { de_en: "DE→EN", en_de: "EN→DE", spelling: "Spelling", pronunciation: "Pronunciation" };

export function Browser({ initialWordId }: { initialWordId?: string }) {
  const { db, words, settings, toast } = useStore();
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("all");
  const [pos, setPos] = useState("all");
  const [bucket, setBucket] = useState("all");
  const [openId, setOpenId] = useState<string | undefined>(initialWordId);
  const { data: states, refresh } = useAsync(() => getAllStates(db), [db]);

  const rows = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("de-DE");
    return words.filter((w) => {
      if (level !== "all" && w.cefrLevel !== level) return false;
      if (pos !== "all" && w.partOfSpeech !== pos) return false;
      if (needle) {
        const hay = [w.lemma, ...w.senses.flatMap((s) => s.englishAnswers)].join(" ").toLocaleLowerCase("de-DE");
        if (!hay.includes(needle)) return false;
      }
      if (bucket !== "all" && states) {
        const buckets = w.senses.flatMap((s) => PHASE1_SKILLS.map((sk) => bucketOf(states.get(stateKey(s.id, sk)))));
        if (bucket === "due") {
          const now = Date.now();
          return w.senses.some((s) => PHASE1_SKILLS.some((sk) => {
            const st = states.get(stateKey(s.id, sk));
            return st && st.repetitions > 0 && !st.suspended && new Date(st.dueAt).getTime() <= now;
          }));
        }
        if (!buckets.includes(bucket as ReturnType<typeof bucketOf>)) return false;
      }
      return true;
    });
  }, [words, q, level, pos, bucket, states]);

  const open = openId ? words.find((w) => w.id === openId) : undefined;

  return (
    <div className="stack">
      <h1>Vocabulary</h1>
      <input type="search" placeholder="Search German or English" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      <div className="row">
        <select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="all">All levels</option>
          {[...new Set(words.map((w) => w.cefrLevel))].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Part of speech" value={pos} onChange={(e) => setPos(e.target.value)}>
          <option value="all">All types</option>
          {[...new Set(words.map((w) => w.partOfSpeech))].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select aria-label="Learning state" value={bucket} onChange={(e) => setBucket(e.target.value)}>
          <option value="all">Any state</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="mature">Mature</option>
          <option value="due">Due now</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      <p className="small muted">{rows.length} words</p>
      <div className="list">
        {rows.map((w) => (
          <button key={w.id} type="button" className="list-item" onClick={() => setOpenId(w.id)}>
            <div>
              <div className="lemma" lang="de">
                {w.article ? `${w.article} ` : ""}
                {w.lemma}
              </div>
              <div className="meta">
                {w.senses[0].englishAnswers[0]} · {w.partOfSpeech} · {w.cefrLevel}
              </div>
            </div>
            <div className="meta">
              {PHASE1_SKILLS.map((sk) => (
                <span key={sk} title={SKILL_LABEL[sk]}>
                  <span className={`dot ${bucketOf(states?.get(stateKey(w.senses[0].id, sk)))}`} />
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      {open && states && (
        <WordDetail
          word={open}
          states={states}
          audio={settings.audioEnabled}
          onClose={() => setOpenId(undefined)}
          onChanged={() => {
            refresh();
          }}
          onReport={async (r) => {
            await addReport(db, r);
            toast("Report saved");
          }}
          db={db}
        />
      )}
    </div>
  );
}

function bucketOf(st: LearningState | undefined) {
  return st ? maturity(st) : "new";
}

function WordDetail({
  word,
  states,
  audio,
  onClose,
  onChanged,
  onReport,
  db
}: {
  word: Word;
  states: Map<string, LearningState>;
  audio: boolean;
  onClose: () => void;
  onChanged: () => void;
  onReport: (r: Parameters<typeof addReport>[1]) => Promise<void>;
  db: Parameters<typeof putState>[0];
}) {
  const [report, setReport] = useState<{ senseId: string; sentenceId?: string } | null>(null);
  const scheduler = useMemo(() => makeScheduler(), []);
  const { data: history } = useAsync(async () => {
    const all = await Promise.all(word.senses.map((s) => getLogForSense(db, s.id)));
    return all.flat().sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1)).slice(0, 10);
  }, [db, word.id]);

  const setAll = async (fn: (st: LearningState) => LearningState) => {
    const now = new Date();
    for (const s of word.senses) {
      for (const sk of PHASE1_SKILLS) {
        const st = states.get(stateKey(s.id, sk)) ?? newLearningState(word.id, s.id, sk, now);
        await putState(db, fn(st));
      }
    }
    onChanged();
  };
  const anySuspended = word.senses.some((s) => PHASE1_SKILLS.some((sk) => states.get(stateKey(s.id, sk))?.suspended));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={word.lemma} onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <Headword word={word} sense={word.senses[0]} />
          <button type="button" className="btn small ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <GrammarForms word={word} />
        <div className="row">
          <SpeakButton text={word.article ? `${word.article} ${word.lemma}` : word.lemma} enabled={audio} />
          <span className="small muted">
            Source: {word.source}
            {word.license ? ` · ${word.license}` : ""} · rank {word.frequencyRank}
          </span>
        </div>

        {word.senses.map((s) => (
          <SenseBlock key={s.id} sense={s} states={states} db={db} onReport={(sentenceId) => setReport({ senseId: s.id, sentenceId })} />
        ))}

        <ListMembership db={db} senseId={word.senses[0].id} />

        <div className="row">
          <button type="button" className="btn small" onClick={() => setAll((st) => markKnown(scheduler, st, new Date()))}>
            Mark as already known
          </button>
          <button type="button" className="btn small" onClick={() => setAll((st) => ({ ...st, suspended: !anySuspended }))}>
            {anySuspended ? "Unsuspend" : "Suspend"}
          </button>
        </div>

        {history && history.length > 0 && (
          <div>
            <h3>Recent history</h3>
            <table className="simple">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Skill</th>
                  <th>Mode</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.reviewedAt).toLocaleString()}</td>
                    <td>{SKILL_LABEL[h.skill]}</td>
                    <td>{h.mode}</td>
                    <td>
                      {h.outcome}
                      {h.overridden ? " (overridden)" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report && <ReportDialog senseId={report.senseId} sentenceId={report.sentenceId} onClose={() => setReport(null)} onSubmit={onReport} />}
      </div>
    </div>
  );
}

function SenseBlock({
  sense,
  states,
  db,
  onReport
}: {
  sense: WordSense;
  states: Map<string, LearningState>;
  db: Parameters<typeof putState>[0];
  onReport: (sentenceId?: string) => void;
}) {
  const { data: custom, refresh } = useAsync(() => getCustomAnswersForSense(db, sense.id), [db, sense.id]);
  return (
    <div className="card stack" style={{ marginBottom: 0 }}>
      <div>
        <strong>
          {sense.order}. {sense.englishAnswers.join(", ")}
        </strong>
      </div>
      <Notes sense={sense} />
      {sense.sentences.map((x) => (
        <ExampleSentence key={x.id} sentence={x} />
      ))}
      <table className="simple">
        <thead>
          <tr>
            <th>Skill</th>
            <th>State</th>
            <th>Due</th>
            <th>Stability</th>
            <th>Lapses</th>
          </tr>
        </thead>
        <tbody>
          {PHASE1_SKILLS.map((sk) => {
            const st = states.get(stateKey(sense.id, sk));
            return (
              <tr key={sk}>
                <td>{SKILL_LABEL[sk]}</td>
                <td>
                  <span className={`dot ${bucketOf(st)}`} />
                  {bucketOf(st)}
                </td>
                <td>{st && st.repetitions > 0 ? formatRelativeDue(st.dueAt) : "–"}</td>
                <td>{st && st.repetitions > 0 ? `${st.stability.toFixed(1)} d` : "–"}</td>
                <td>{st?.lapses ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {custom && custom.length > 0 && (
        <div className="small">
          <strong>Your accepted answers:</strong>{" "}
          {custom.map((c) => (
            <span key={c.id} style={{ marginRight: 8 }}>
              {c.answer} ({SKILL_LABEL[c.skill]}){" "}
              <button
                type="button"
                className="btn small ghost"
                aria-label={`Remove ${c.answer}`}
                onClick={async () => {
                  await deleteCustomAnswer(db, c.id!);
                  refresh();
                }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div>
        <button type="button" className="btn small" onClick={() => onReport(sense.sentences[0]?.id)}>
          Report
        </button>
      </div>
    </div>
  );
}

function ListMembership({ db, senseId }: { db: Parameters<typeof putState>[0]; senseId: string }) {
  const { data: lists, refresh } = useAsync(() => getLists(db), [db]);
  const [name, setName] = useState("");
  return (
    <div className="stack" style={{ gap: 6 }}>
      <h3>Personal lists</h3>
      {lists && lists.length === 0 && <span className="small muted">No lists yet. Create one below to group words for a session.</span>}
      {lists?.map((l) => (
        <label key={l.id} className="row small">
          <input
            type="checkbox"
            checked={l.senseIds.includes(senseId)}
            onChange={async () => {
              await toggleInList(db, l.id, senseId);
              refresh();
            }}
          />
          {l.name} ({l.senseIds.length})
        </label>
      ))}
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          const now = new Date().toISOString();
          await saveList(db, { id: `list-${Date.now().toString(36)}`, name: n, senseIds: [senseId], createdAt: now, updatedAt: now });
          setName("");
          refresh();
        }}
      >
        <input type="text" placeholder="New list name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New list name" style={{ flex: 1 }} />
        <button type="submit" className="btn small" disabled={!name.trim()}>
          Add to new list
        </button>
      </form>
    </div>
  );
}
