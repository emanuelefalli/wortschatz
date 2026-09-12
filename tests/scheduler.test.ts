import { describe, expect, it } from "vitest";
import { applyReview, isDue, makeScheduler, markKnown, maturity, newLearningState } from "../src/domain/scheduler";
import { stateKey } from "../src/domain/types";

const DAY = 86400000;
const T0 = new Date("2026-03-01T10:00:00Z");

describe("FSRS scheduling", () => {
  const s = makeScheduler();

  it("creates independent states per direction", () => {
    const a = newLearningState("w1", "s1", "de_en", T0);
    const b = newLearningState("w1", "s1", "en_de", T0);
    expect(a.key).toBe(stateKey("s1", "de_en"));
    expect(b.key).toBe(stateKey("s1", "en_de"));
    expect(a.key).not.toBe(b.key);
    const a2 = applyReview(s, a, "correct", T0).next;
    expect(a2.repetitions).toBe(1);
    expect(b.repetitions).toBe(0); // reverse direction untouched
  });

  it("wrong / unknown reappear within minutes; correct within days", () => {
    const st = newLearningState("w1", "s1", "de_en", T0);
    const wrong = applyReview(s, st, "wrong", T0);
    expect(wrong.intervalMs).toBeLessThan(15 * 60000);
    const unknown = applyReview(s, st, "unknown", T0);
    expect(unknown.intervalMs).toBeLessThan(15 * 60000);
    const ok = applyReview(s, st, "correct", T0);
    // First correct: learning step (10m) — graduates on the next correct.
    expect(ok.intervalMs).toBeLessThanOrEqual(DAY);
    const graduated = applyReview(s, ok.next, "correct", new Date(T0.getTime() + 10 * 60000));
    expect(graduated.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(graduated.scheduledDays).toBeLessThanOrEqual(10);
  });

  it("almost schedules earlier than correct", () => {
    let st = newLearningState("w1", "s1", "de_en", T0);
    st = applyReview(s, st, "correct", T0).next;
    st = applyReview(s, st, "correct", new Date(T0.getTime() + 10 * 60000)).next;
    const t1 = new Date(st.dueAt);
    const almost = applyReview(s, st, "almost", t1);
    const correct = applyReview(s, st, "correct", t1);
    expect(almost.intervalMs).toBeLessThan(correct.intervalMs);
  });

  it("repeated correct recall expands intervals to weeks and months", () => {
    let st = newLearningState("w1", "s1", "en_de", T0);
    let t = T0;
    const intervals: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = applyReview(s, st, "correct", t);
      st = r.next;
      intervals.push(r.scheduledDays);
      t = new Date(st.dueAt);
    }
    expect(intervals[intervals.length - 1]).toBeGreaterThan(30);
    for (let i = 3; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThanOrEqual(intervals[i - 1]);
    expect(maturity(st)).toBe("mature");
  });

  it("a lapse increments lapses and shortens the interval", () => {
    let st = newLearningState("w1", "s1", "en_de", T0);
    let t = T0;
    for (let i = 0; i < 4; i++) {
      st = applyReview(s, st, "correct", t).next;
      t = new Date(st.dueAt);
    }
    const before = st.stability;
    const r = applyReview(s, st, "wrong", t);
    expect(r.next.lapses).toBe(1);
    expect(r.next.stability).toBeLessThan(before);
    expect(r.intervalMs).toBeLessThan(DAY);
  });

  it("isDue respects due date and ignores never-reviewed cards", () => {
    const st = newLearningState("w1", "s1", "en_de", T0);
    expect(isDue(st, T0)).toBe(false);
    const r = applyReview(s, st, "correct", T0).next;
    expect(isDue(r, T0)).toBe(false);
    expect(isDue(r, new Date(new Date(r.dueAt).getTime() + 1))).toBe(true);
  });

  it("markKnown moves a card out of the new bucket with a future due date", () => {
    const st = newLearningState("w1", "s1", "en_de", T0);
    const known = markKnown(s, st, T0);
    expect(maturity(known)).not.toBe("new");
    expect(new Date(known.dueAt).getTime()).toBeGreaterThan(T0.getTime() + 6 * DAY);
    expect(known.markedKnownAt).toBe(T0.toISOString());
  });

  it("is deterministic across a daylight-saving boundary (UTC math)", () => {
    // Europe/Berlin DST starts 2026-03-29. Intervals are computed in UTC ms.
    const before = new Date("2026-03-28T12:00:00Z");
    let st = newLearningState("w1", "s1", "en_de", before);
    st = applyReview(s, st, "correct", before).next;
    st = applyReview(s, st, "correct", new Date(before.getTime() + 10 * 60000)).next;
    const due = new Date(st.dueAt).getTime();
    expect((due - before.getTime()) % DAY).toBeLessThan(11 * 60000 + 1); // whole days + the 10 minutes
  });
});
