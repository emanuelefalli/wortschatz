import { getAllStates, getRecentDailyStats, getReviewLog } from "../../db/repo";
import { computeOverview, FORECAST_DAYS } from "../../domain/stats";
import type { Skill } from "../../domain/types";
import { useAsync } from "../hooks";
import { navigate } from "../router";
import { useStore } from "../store";

export function Stats() {
  const { db, words, wordById } = useStore();
  const { data } = useAsync(async () => {
    const [states, log, days] = await Promise.all([getAllStates(db), getReviewLog(db, 5000), getRecentDailyStats(db, 30)]);
    return { overview: computeOverview(words, states, log, new Date()), days: days.reverse() };
  }, [db, words]);
  if (!data) return <p className="muted">Loading…</p>;
  const { overview: o, days } = data;
  const maxReviews = Math.max(1, ...days.map((d) => d.reviews));
  const maxForecast = Math.max(1, ...o.forecast);
  const levels = Object.keys(o.bucketsByLevel).sort() as (keyof typeof o.bucketsByLevel)[];
  const dayLabel = (i: number) => (i === 0 ? "today" : i === 1 ? "tmrw" : `+${i}d`);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
  const skills: Skill[] = ["de_en", "en_de"];

  return (
    <div className="stack">
      <h1>Statistics</h1>
      <div className="grid-3">
        <div className="stat">
          <div className="value">{o.dueNow}</div>
          <div className="label">due ({o.overdueByDay} overdue &gt;1d)</div>
        </div>
        <div className="stat">
          <div className="value">{o.estimatedRetention ? pct(o.estimatedRetention, 1) : "–"}</div>
          <div className="label">est. retention</div>
        </div>
        <div className="stat">
          <div className="value">{pct(o.coverage, 1)}</div>
          <div className="label">coverage</div>
        </div>
      </div>

      <div className="card">
        <h3>Due in the next {FORECAST_DAYS} days</h3>
        <div className="bars" aria-label="Due forecast">
          {o.forecast.map((n, i) => (
            <div key={i} className="bar" style={{ height: `${(n / maxForecast) * 100}%` }} title={`${dayLabel(i)}: ${n}`}>
              <span>{n}</span>
            </div>
          ))}
        </div>
        <div className="row small muted" style={{ justifyContent: "space-between", marginTop: 4 }}>
          <span>today</span>
          <span>+{FORECAST_DAYS - 1} days</span>
        </div>
      </div>

      <div className="card">
        <h3>Reviews and accuracy, last 30 days</h3>
        {days.length === 0 ? (
          <p className="muted small">No reviews yet.</p>
        ) : (
          <div className="bars" aria-label="Daily reviews">
            {days.map((d) => (
              <div
                key={d.day}
                className="bar"
                style={{ height: `${(d.reviews / maxReviews) * 100}%`, opacity: 0.35 + 0.65 * (d.reviews ? d.correct / d.reviews : 0) }}
                title={`${d.day}: ${d.reviews} reviews, ${d.reviews ? Math.round((d.correct / d.reviews) * 100) : 0}% correct, ${d.newWords} new`}
              >
                <span>{d.reviews}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Accuracy by direction</h3>
        <table className="simple">
          <thead>
            <tr>
              <th>Direction</th>
              <th>Reviews</th>
              <th>Correct</th>
              <th>Almost</th>
            </tr>
          </thead>
          <tbody>
            {skills.map((sk) => (
              <tr key={sk}>
                <td>{sk === "de_en" ? "German → English" : "English → German"}</td>
                <td>{o.accuracyBySkill[sk].total}</td>
                <td>{pct(o.accuracyBySkill[sk].correct, o.accuracyBySkill[sk].total)}</td>
                <td>{pct(o.accuracyBySkill[sk].almost, o.accuracyBySkill[sk].total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Progress by level</h3>
        <table className="simple">
          <thead>
            <tr>
              <th>Level</th>
              <th>New</th>
              <th>Learning</th>
              <th>Mature</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((lvl) => {
              const b = o.bucketsByLevel[lvl]!;
              const a = o.accuracyByLevel[lvl];
              return (
                <tr key={lvl}>
                  <td>{lvl}</td>
                  <td>{b.new}</td>
                  <td>{b.learning}</td>
                  <td>{b.mature}</td>
                  <td>{a ? pct(a.correct, a.total) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card" hidden>
        <h3>Accuracy by level</h3>
        <table className="simple">
          <tbody>
            {Object.entries(o.accuracyByLevel).map(([lvl, a]) => (
              <tr key={lvl}>
                <td>{lvl}</td>
                <td>{a.total} reviews</td>
                <td>{pct(a.correct, a.total)}</td>
              </tr>
            ))}
            {Object.keys(o.accuracyByLevel).length === 0 && (
              <tr>
                <td className="muted">No data yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Error types by direction</h3>
        <table className="simple">
          <thead>
            <tr>
              <th>Type</th>
              <th>DE→EN</th>
              <th>EN→DE</th>
            </tr>
          </thead>
          <tbody>
            {(["meaning", "spelling", "article", "capitalization", "umlaut"] as const).map((k) => (
              <tr key={k}>
                <td style={{ textTransform: "capitalize" }}>{k === "umlaut" ? "Umlaut/ß" : k}</td>
                <td>{o.errorsBySkill.de_en[k]}</td>
                <td>{o.errorsBySkill.en_de[k]}</td>
              </tr>
            ))}
            <tr>
              <td className="muted">Error rate</td>
              <td>{pct(o.errorsBySkill.de_en.total, o.accuracyBySkill.de_en.total)}</td>
              <td>{pct(o.errorsBySkill.en_de.total, o.accuracyBySkill.en_de.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Leeches (4+ lapses)</h3>
        {o.leeches.length === 0 ? (
          <p className="muted small">None yet.</p>
        ) : (
          <div className="list">
            {o.leeches.map((l) => (
              <button key={`${l.senseId}|${l.skill}`} type="button" className="list-item" onClick={() => navigate(`browse?word=${encodeURIComponent(l.wordId)}`)}>
                <span className="lemma">{wordById.get(l.wordId)?.lemma ?? l.wordId}</span>
                <span className="meta">
                  {l.skill} · {l.lapses} lapses
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
