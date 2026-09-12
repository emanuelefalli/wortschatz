import { computeOverview } from "../../domain/stats";
import { countWeak } from "../../domain/session";
import { getActiveSession, getAllStates, getDailyStats, getReviewLog } from "../../db/repo";
import { localDay } from "../../domain/time";
import { useAsync } from "../hooks";
import { navigate } from "../router";
import { useStore } from "../store";

export function Dashboard() {
  const { db, words, settings } = useStore();
  const { data, loading } = useAsync(async () => {
    const now = new Date();
    const [states, log, today, active] = await Promise.all([
      getAllStates(db),
      getReviewLog(db, 2000),
      getDailyStats(db, localDay(now)),
      getActiveSession(db)
    ]);
    return { overview: computeOverview(words, states, log, now), today, active, weak: countWeak(states.values(), now) };
  }, [db, words]);

  if (loading || !data) return <p className="muted">Loading…</p>;
  const { overview, today, active, weak } = data;
  const newLeft = Math.max(0, settings.dailyNewWordLimit - today.newWords);
  const goalPct = Math.min(100, Math.round((today.reviews / Math.max(1, settings.dailyReviewGoal)) * 100));
  const levels = [...new Set(words.map((w) => w.cefrLevel))].sort();

  return (
    <div className="stack">
      <h1>Today</h1>
      <div className="grid-3">
        <div className="stat">
          <div className="value">{overview.dueNow}</div>
          <div className="label">due now</div>
        </div>
        <div className="stat">
          <div className="value">{newLeft}</div>
          <div className="label">new words left</div>
        </div>
        <div className="stat">
          <div className="value">{overview.estimatedRetention ? `${Math.round(overview.estimatedRetention * 100)}%` : "–"}</div>
          <div className="label">est. retention</div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Daily goal</strong>
          <span className="muted small">
            {today.reviews} / {settings.dailyReviewGoal} reviews
          </span>
        </div>
        <div className="progress" aria-label="Daily goal progress">
          <div style={{ width: `${goalPct}%` }} />
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          {today.correct} correct · {today.almost} almost · {today.wrong} wrong today
        </p>
      </div>

      {active ? (
        <button type="button" className="btn primary block" onClick={() => navigate("session?resume=1")}>
          Resume session ({active.cursor}/{active.queue.length})
        </button>
      ) : (
        <button type="button" className="btn primary block" onClick={() => navigate("setup")}>
          Start a session
        </button>
      )}
      {weak > 0 && !active && (
        <button type="button" className="btn block" onClick={() => navigate("session?preset=weak")}>
          Practice {weak} weak {weak === 1 ? "word" : "words"}
        </button>
      )}
      {overview.dueNow === 0 && newLeft === 0 && !active && (
        <p className="small muted">Nothing is due and today's new words are done. Come back tomorrow, or raise the limit in Settings.</p>
      )}

      <div className="card">
        <h3>Vocabulary</h3>
        <div className="summary-list">
          <div>
            <span className="dot new" /> New: {overview.buckets.new}
          </div>
          <div>
            <span className="dot learning" /> Learning: {overview.buckets.learning}
          </div>
          <div>
            <span className="dot mature" /> Mature: {overview.buckets.mature}
          </div>
          <div>
            <span className="dot suspended" /> Suspended: {overview.buckets.suspended}
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          {Math.round(overview.coverage * 100)}% of {overview.totalSenses} word senses started ·{" "}
          {levels.map((l) => `${l}: ${words.filter((w) => w.cefrLevel === l).length}`).join(" · ")}
        </p>
        <button type="button" className="btn small" onClick={() => navigate("placement")}>
          Already know some words? Placement
        </button>
      </div>
    </div>
  );
}
