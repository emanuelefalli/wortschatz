import { useState } from "react";
import type { ContentReport } from "../../domain/types";

export function ReportDialog({
  senseId,
  sentenceId,
  answerGiven,
  onAccept,
  onSubmit,
  onClose
}: {
  senseId: string;
  sentenceId?: string;
  /** The learner's rejected answer, if any; enables "accept in future". */
  answerGiven?: string;
  onAccept?: (answer: string) => Promise<void>;
  onSubmit: (r: ContentReport) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ContentReport["kind"]>("missing_translation");
  const [text, setText] = useState(answerGiven ?? "");
  const [accept, setAccept] = useState(!!answerGiven && !!onAccept);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Report content" onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <h2>Report a problem</h2>
        <div className="field">
          <label htmlFor="report-kind">What is wrong?</label>
          <select id="report-kind" value={kind} onChange={(e) => setKind(e.target.value as ContentReport["kind"])}>
            <option value="missing_translation">My translation should be accepted</option>
            <option value="bad_sentence">The example sentence is bad</option>
            <option value="other">Something else</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="report-text">Details</label>
          <input id="report-text" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 'to phone' should be accepted" />
        </div>
        {kind === "missing_translation" && onAccept && (
          <label className="row">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            Accept “{text.trim() || answerGiven}” as correct for this card from now on
          </label>
        )}
        <div className="row">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              await onSubmit({ createdAt: new Date().toISOString(), senseId, sentenceId, kind, text });
              const toAccept = (text.trim() || answerGiven || "").trim();
              if (kind === "missing_translation" && accept && onAccept && toAccept) await onAccept(toAccept);
              onClose();
            }}
          >
            Save
          </button>
        </div>
        <p className="small muted">Reports are stored on this device and included in backups.</p>
      </div>
    </div>
  );
}
