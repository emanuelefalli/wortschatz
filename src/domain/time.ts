/** All persisted timestamps are UTC ISO strings. "Days" for goals use the local calendar. */

export const nowIso = () => new Date().toISOString();

/** Local calendar day as YYYY-MM-DD (daily goals follow the user's clock, not UTC). */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatInterval(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d`;
  const mo = Math.round(d / 30);
  if (mo < 18) return `${mo} mo`;
  return `${(d / 365).toFixed(1)} y`;
}

export function formatRelativeDue(dueAt: string, now: Date = new Date()): string {
  const diff = new Date(dueAt).getTime() - now.getTime();
  if (diff <= 0) return "due now";
  return `in ${formatInterval(diff)}`;
}
