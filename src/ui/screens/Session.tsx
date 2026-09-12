import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addCustomAnswer, addReport, getActiveSession, getAllStates, getCustomAnswers, getDailyStats, getState, recordReview, saveSession } from "../../db/repo";
import { getLists } from "../../db/repo";
import { autoSync } from "../../sync/client";
import { buildCloze } from "../../domain/cloze";
import { expectedAnswer, gradeAnswer, gradeCloze, promptText, type GradeResult } from "../../domain/grader";
import { applyReview, makeScheduler, newLearningState } from "../../domain/scheduler";
import { applyAnswer, buildSession, currentItem, isFirstIntroduction, sessionSummary } from "../../domain/session";
import { formatInterval, formatRelativeDue, localDay } from "../../domain/time";
import type { LearningState, Outcome, ReviewLogEntry, SessionRecord } from "../../domain/types";
import { PHASE1_SKILLS } from "../../domain/types";
import { ExampleSentence, GrammarForms, Headword, Notes, SpeakButton } from "../components/WordInfo";
import { ReportDialog } from "../components/ReportDialog";
import { navigate } from "../router";
import { useStore } from "../store";
import { loadSetup } from "./SessionSetup";

type Phase = "prompt" | "feedback" | "done";

const OUTCOME_LABEL: Record<Outcome, string> = { correct: "Correct", almost: "Almost", wrong: "Wrong", unknown: "I don't know" };

export type SessionPreset = "weak" | undefined;

/** Weak-word sessions: only previously failed cards, no new words, both directions. */
export function presetConfig(preset: SessionPreset, base: ReturnType<typeof loadSetup>) {
  if (preset === "weak") return { ...base, direction: "mixed" as const, filter: "weak" as const, newWordLimit: 0, cardCount: 40 };
  return base;
}

export function Session({ resume, preset }: { resume?: boolean; preset?: SessionPreset }) {
  const { db, settings, words, toast } = useStore();
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const active = await getActiveSession(db);
      if (active && (resume || active.queue.length)) {
        if (!resume) {
          // A new session was requested while one is active: abandon the old one.
          await saveSession(db, { ...active, status: "abandoned", endedAt: new Date().toISOString() });
        } else {
          if (alive) setSession(active);
          return;
        }
      }
      const now = new Date();
      const config = presetConfig(preset, loadSetup(settings.dailyNewWordLimit));
      const [states, today, lists] = await Promise.all([getAllStates(db), getDailyStats(db, localDay(now)), config.listId ? getLists(db) : Promise.resolve([])]);
      const list = config.listId ? lists.find((l) => l.id === config.listId) : undefined;
      const built = buildSession({
        words,
        states,
        config,
        settings,
        now,
        listSenseIds: list ? new Set(list.senseIds) : undefined,
        newWordsToday: today.newWords,
        sessionId: `s-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      });
      await saveSession(db, built);
      if (alive) setSession(built);
    })().catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [db, resume, preset, words, settings]);

  if (error) return <p className="verdict wrong">{error}</p>;
  if (!session) return <p className="muted">Preparing session…</p>;
  if (session.status !== "active" || !currentItem(session)) return <Summary session={session} />;
  return <ActiveSession key={session.id} session={session} onSessionChange={setSession} toast={toast} />;
}

function ActiveSession({
  session,
  onSessionChange,
  toast
}: {
  session: SessionRecord;
  onSessionChange: (s: SessionRecord) => void;
  toast: (m: string) => void;
}) {
  const { db, settings, senseById } = useStore();
  const scheduler = useMemo(() => makeScheduler({ requestRetention: settings.requestRetention }), [settings.requestRetention]);
  const item = currentItem(session)!;
  const entry = senseById.get(item.senseId);
  const [phase, setPhase] = useState<Phase>("prompt");
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [chosen, setChosen] = useState<Outcome>("correct");
  const [clozeResult, setClozeResult] = useState<{ correct: boolean; reason?: string } | null>(null);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [preview, setPreview] = useState<Record<Outcome, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPhase("prompt");
    setAnswer("");
    setGrade(null);
    setClozeResult(null);
    setExampleIndex(0);
    setPreview(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [item.uid]);

  useEffect(() => {
    if (phase === "feedback") setTimeout(() => continueRef.current?.focus(), 0);
  }, [phase]);

  if (!entry) {
    return (
      <div className="card">
        <p>This card refers to a word that is no longer in the vocabulary.</p>
        <button type="button" className="btn" onClick={() => onSessionChange(applyAnswer(session, item, "correct"))}>
          Skip
        </button>
      </div>
    );
  }
  const { word, sense } = entry;
  const sentence = item.sentenceId ? sense.sentences.find((s) => s.id === item.sentenceId) ?? sense.sentences[0] : sense.sentences[0];
  const total = session.queue.length;
  const pct = Math.round((session.cursor / total) * 100);

  // ---------- Unaided card ----------
  const submitUnaided = async (unknown = false) => {
    const now = new Date();
    const extraAccepted = (await getCustomAnswers(db, sense.id, item.skill)).map((a) => a.answer);
    const opts = { ...settings, extraAccepted };
    const g = unknown ? gradeAnswer(word, sense, item.skill, "", opts) : gradeAnswer(word, sense, item.skill, answer, opts);
    setGrade(g);
    setChosen(g.outcome);
    const st = (await getState(db, sense.id, item.skill)) ?? newLearningState(word.id, sense.id, item.skill, now);
    const p = {} as Record<Outcome, string>;
    for (const o of ["correct", "almost", "wrong", "unknown"] as Outcome[]) p[o] = formatInterval(applyReview(scheduler, st, o, now).intervalMs);
    setPreview(p);
    setPhase("feedback");
  };

  const commitUnaided = async () => {
    if (!grade || saving) return;
    setSaving(true);
    try {
      const now = new Date();
      const prev = (await getState(db, sense.id, item.skill)) ?? newLearningState(word.id, sense.id, item.skill, now);
      // A word sense counts as "new today" only on its very first unaided review in any direction.
      const introducedNew = isFirstIntroduction(await Promise.all(PHASE1_SKILLS.map((sk) => getState(db, sense.id, sk))));
      const { next } = applyReview(scheduler, prev, chosen, now);
      const after = applyAnswer(session, item, chosen, sentence?.id);
      const log: ReviewLogEntry = {
        sessionId: session.id,
        wordId: word.id,
        senseId: sense.id,
        skill: item.skill,
        mode: "unaided",
        reviewedAt: now.toISOString(),
        outcome: chosen,
        proposedOutcome: grade.outcome,
        overridden: chosen !== grade.outcome,
        answerGiven: answer,
        reasons: grade.reasons,
        before: pick(prev),
        after: { ...pick(next), scheduledDays: next.scheduledDays },
        retry: item.retry
      };
      await recordReview(db, { session: after, nextState: next, log, introducedNew, outcome: chosen, now });
      onSessionChange(after);
    } finally {
      setSaving(false);
    }
  };

  // ---------- Cloze card ----------
  const submitCloze = () => {
    if (!sentence) return;
    setClozeResult(gradeCloze(sentence.targetText, answer));
    setPhase("feedback");
  };

  const commitCloze = async () => {
    if (!clozeResult || !sentence || saving) return;
    setSaving(true);
    try {
      const now = new Date();
      const outcome: Outcome = clozeResult.correct ? "correct" : "wrong";
      const after = applyAnswer(session, item, outcome, sentence.id);
      const log: ReviewLogEntry = {
        sessionId: session.id,
        wordId: word.id,
        senseId: sense.id,
        skill: item.skill,
        mode: "cloze",
        reviewedAt: now.toISOString(),
        outcome,
        proposedOutcome: outcome,
        overridden: false,
        answerGiven: answer,
        reasons: clozeResult.reason ? [clozeResult.reason] : []
      };
      // Cloze success is supportive evidence only: it is logged but does not touch the FSRS state.
      await recordReview(db, { session: after, log, introducedNew: false, outcome, now });
      onSessionChange(after);
    } finally {
      setSaving(false);
    }
  };

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (phase !== "feedback") return;
      if (e.key === "Enter") {
        e.preventDefault();
        void (item.mode === "cloze" ? commitCloze() : commitUnaided());
        return;
      }
      if (item.mode !== "unaided") return;
      const map: Record<string, Outcome> = { "1": "correct", "2": "almost", "3": "wrong", "4": "unknown" };
      if (map[e.key]) setChosen(map[e.key]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, item.mode, chosen, grade, clozeResult, saving, session]
  );
  const submitOnEnter = (fn: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fn();
    }
  };

  const abandon = async () => {
    await saveSession(db, { ...session, status: "abandoned", endedAt: new Date().toISOString() });
    navigate("");
  };

  const header = (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="small muted">
          {session.cursor + 1} / {total}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {item.isNew && <span className="badge new">new</span>}
          {item.retry && <span className="badge retry">retry</span>}
          {item.mode === "cloze" && <span className="badge cloze">cloze</span>}
          <button type="button" className="btn small ghost" onClick={abandon} aria-label="End session">
            End
          </button>
        </div>
      </div>
      <div className="progress" aria-label="Session progress">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );

  if (item.mode === "cloze" && sentence) {
    const cloze = buildCloze(sentence);
    const parts = cloze.text.split("_____");
    return (
      <div className="stack" onKeyDown={onKey}>
        {header}
        <div className="card prompt-card">
          <div className="direction">Fill in the gap</div>
          <div className="cloze-text" lang="de">
            {parts[0]}
            <span className="blank">{phase === "feedback" ? sentence.targetText : "    "}</span>
            {parts[1]}
          </div>
          <div className="hint">{sentence.englishText}</div>
          <div className="hint small">({sense.englishAnswers[0]})</div>
        </div>
        {phase === "prompt" ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              submitCloze();
            }}
          >
            <label className="sr-only" htmlFor="cloze-answer">
              Missing word
            </label>
            <input id="cloze-answer" ref={inputRef} className="answer-input" type="text" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} lang="de" value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={submitOnEnter(submitCloze)} />
            <button type="submit" className="btn primary block">
              Check
            </button>
          </form>
        ) : (
          <div className="stack">
            <div className={`verdict ${clozeResult?.correct ? "correct" : "wrong"}`}>
              <strong>{clozeResult?.correct ? "Correct" : "Not quite"}</strong>
              {clozeResult?.reason && <div>{clozeResult.reason}</div>}
              <div className="small">Cloze practice reinforces the word; the next unaided review still counts.</div>
            </div>
            <div className="card stack">
              <Headword word={word} sense={sense} />
              <ExampleSentence sentence={sentence} />
              <SpeakButton text={sentence.germanText} audioReference={sentence.audioReference} enabled={settings.audioEnabled} label="Play sentence" />
            </div>
            <button ref={continueRef} type="button" className="btn primary block" onClick={commitCloze} disabled={saving}>
              Continue
            </button>
          </div>
        )}
      </div>
    );
  }

  const prompt = promptText(word, sense, item.skill);
  const expected = expectedAnswer(word, sense, item.skill);
  const directionLabel = item.skill === "de_en" ? "German → English" : "English → German";
  const hint =
    item.skill === "en_de" && word.partOfSpeech === "noun"
      ? "Type the noun with its article, e.g. der Tisch"
      : item.skill === "en_de" && word.partOfSpeech === "verb"
        ? "Type the infinitive"
        : item.skill === "de_en"
          ? `${word.partOfSpeech}${word.plural ? ` · pl. ${word.plural}` : ""}`
          : word.partOfSpeech;
  const exampleForFeedback = sense.sentences[exampleIndex % Math.max(1, sense.sentences.length)];

  return (
    <div className="stack" onKeyDown={onKey}>
      {header}
      <div className="card prompt-card">
        <div className="direction">{directionLabel}</div>
        <div className="prompt" lang={item.skill === "de_en" ? "de" : "en"}>
          {prompt}
        </div>
        <div className="hint">{hint}</div>
        {item.skill === "de_en" && phase === "prompt" && <SpeakButton text={prompt} enabled={settings.audioEnabled} label="Listen" />}
      </div>

      {phase === "prompt" && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submitUnaided(false);
          }}
        >
          <label className="sr-only" htmlFor="answer">
            Your answer
          </label>
          <input id="answer" ref={inputRef} className="answer-input" type="text" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} lang={item.skill === "en_de" ? "de" : "en"} value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={submitOnEnter(() => answer.trim() !== "" && void submitUnaided(false))} placeholder="Type your answer" />
          <div className="grid-2">
            <button type="button" className="btn" onClick={() => void submitUnaided(true)}>
              I don't know
            </button>
            <button type="submit" className="btn primary" disabled={answer.trim() === ""}>
              Check
            </button>
          </div>
        </form>
      )}

      {phase === "feedback" && grade && (
        <div className="stack">
          <div className={`verdict ${grade.outcome}`}>
            <strong>{OUTCOME_LABEL[grade.outcome]}</strong>
            {grade.outcome !== "correct" && (
              <div>
                Answer: <strong style={{ display: "inline" }}>{expected}</strong>
                {grade.accepted.length > 1 && <span className="small"> (also: {grade.accepted.filter((a) => a !== expected).join(", ")})</span>}
              </div>
            )}
            {grade.reasons.length > 0 && (
              <ul>
                {grade.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="card stack">
            <Headword word={word} sense={sense} />
            <GrammarForms word={word} />
            {exampleForFeedback && <ExampleSentence sentence={exampleForFeedback} />}
            <Notes sense={sense} />
            <div className="row">
              <SpeakButton text={item.skill === "de_en" ? prompt : expected} enabled={settings.audioEnabled} />
              {sense.sentences.length > 1 && (
                <button type="button" className="btn small" onClick={() => setExampleIndex((i) => i + 1)}>
                  Another example
                </button>
              )}
              <button type="button" className="btn small" onClick={() => setReport(true)}>
                Report
              </button>
            </div>
          </div>

          <div className="card">
            <div className="small muted" style={{ marginBottom: 6 }}>
              Grade (override if the automatic grade is wrong · keys <span className="kbd">1</span>–<span className="kbd">4</span>)
            </div>
            <div className="override" role="radiogroup" aria-label="Grade">
              {(["correct", "almost", "wrong", "unknown"] as Outcome[]).map((o) => (
                <button key={o} type="button" role="radio" aria-checked={chosen === o} className={`btn ${chosen === o ? "selected" : ""}`} onClick={() => setChosen(o)}>
                  <span>
                    {OUTCOME_LABEL[o]}
                    <br />
                    <span className="k">{preview?.[o]}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button ref={continueRef} type="button" className="btn primary block" onClick={commitUnaided} disabled={saving}>
            Continue
          </button>
        </div>
      )}

      {report && (
        <ReportDialog
          senseId={sense.id}
          sentenceId={exampleForFeedback?.id}
          answerGiven={grade && grade.outcome !== "correct" && grade.outcome !== "unknown" ? answer : undefined}
          onAccept={async (a) => {
            await addCustomAnswer(db, sense.id, item.skill, a);
            setChosen("correct");
            toast(`“${a}” will be accepted from now on`);
          }}
          onClose={() => setReport(false)}
          onSubmit={async (r) => {
            await addReport(db, r);
          }}
        />
      )}
    </div>
  );
}

function pick(s: LearningState) {
  return { dueAt: s.dueAt, stability: s.stability, difficulty: s.difficulty, phase: s.phase };
}

function EmptyExplanation({ session }: { session: SessionRecord }) {
  const d = session.diagnostics;
  if (!d) return <p className="muted">No cards are due and no new words are available with the current setup.</p>;
  const f = session.config.filter;
  return (
    <div className="card stack">
      <p>Nothing matched this setup. Cards are never shown before they are due.</p>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
        <li>
          Due reviews: {d.dueCount}
          {d.nextDueAt ? ` · next one ${formatRelativeDue(d.nextDueAt)}` : ""}
        </li>
        {f === "due" || f === "weak" ? (
          <li>This filter never introduces new words. Choose “Due reviews + new words” or “New words only” to learn new vocabulary.</li>
        ) : (
          <li>
            New words available at these levels: {d.availableNew}. Today's allowance: {d.remainingToday} of {d.dailyLimit} left
            {d.availableNew > 0 && d.allowance === 0
              ? " – the daily limit is used up. Tick “Go beyond today's limit” in session setup, or raise the limit in Settings."
              : d.availableNew > 0 && session.config.newWordLimit === 0
                ? " – this session was set to 0 new words."
                : d.availableNew === 0
                  ? " – every word at these levels has been started; add more levels."
                  : "."}
          </li>
        )}
      </ul>
    </div>
  );
}

function Summary({ session }: { session: SessionRecord }) {
  const { db, toast } = useStore();
  const s = sessionSummary(session);
  useEffect(() => {
    if (session.status === "finished" && session.answered.length > 0) {
      void autoSync(db, (m) => toast(`Sync failed: ${m}`)).then((r) => r && r.status !== "unchanged" && toast("Progress synced"));
    }
  }, [db, session.status, session.answered.length, toast]);
  const empty = session.queue.length === 0;
  return (
    <div className="stack">
      <h1>{empty ? "Nothing to review" : "Session complete"}</h1>
      {empty ? (
        <EmptyExplanation session={session} />
      ) : (
        <div className="grid-2">
          <div className="stat">
            <div className="value">{s.total}</div>
            <div className="label">unaided reviews</div>
          </div>
          <div className="stat">
            <div className="value">{s.total ? Math.round((s.correct / s.total) * 100) : 0}%</div>
            <div className="label">correct</div>
          </div>
          <div className="stat">
            <div className="value">{s.almost}</div>
            <div className="label">almost</div>
          </div>
          <div className="stat">
            <div className="value">{s.wrong}</div>
            <div className="label">wrong</div>
          </div>
          <div className="stat">
            <div className="value">{s.newWords}</div>
            <div className="label">new words</div>
          </div>
          <div className="stat">
            <div className="value">{s.cloze}</div>
            <div className="label">cloze exercises</div>
          </div>
        </div>
      )}
      <button type="button" className="btn primary block" onClick={() => navigate("")}>
        Back to dashboard
      </button>
      <button type="button" className="btn block" onClick={() => navigate("setup")}>
        New session
      </button>
    </div>
  );
}
