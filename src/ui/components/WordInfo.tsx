import type { Sentence, Word, WordSense } from "../../domain/types";
import { splitHighlight } from "../../domain/cloze";
import { canSpeak, playPronunciation } from "../audio";

export function Headword({ word, sense }: { word: Word; sense: WordSense }) {
  const head =
    word.partOfSpeech === "noun" && word.article ? `${word.article} ${word.lemma}` : word.lemma;
  return (
    <div>
      <div className="headword">
        {head}
        {word.plural && <span className="plural">, die {word.plural}</span>}
      </div>
      <div className="meaning">
        {sense.englishAnswers.join(", ")}{" "}
        <span className="muted small">
          · {word.partOfSpeech} · {word.cefrLevel}
          {sense.register ? ` · ${sense.register}` : ""}
        </span>
      </div>
    </div>
  );
}

export function GrammarForms({ word }: { word: Word }) {
  const rows: [string, string][] = [];
  if (word.partOfSpeech === "noun") {
    if (word.gender) rows.push(["Gender", `${word.gender} (${word.article})`]);
    if (word.plural) rows.push(["Plural", `die ${word.plural}`]);
    if (word.genitive) rows.push(["Genitive", word.genitive]);
  }
  const v = word.verbForms;
  if (v) {
    const aux = v.auxiliary === "sein" ? "ist" : "hat";
    const parts = [v.thirdPersonPresent, v.preterite, v.pastParticiple ? `${aux} ${v.pastParticiple}` : undefined].filter(Boolean);
    if (parts.length) rows.push(["Forms", parts.join(" – ")]);
    if (v.separable) rows.push(["Separable", "yes"]);
    if (v.reflexive) rows.push(["Reflexive", "yes"]);
    if (v.governedPreposition) rows.push(["Preposition", v.governedPreposition]);
  }
  const a = word.adjectiveForms;
  if (a && (a.comparative || a.superlative)) rows.push(["Comparison", [a.comparative, a.superlative].filter(Boolean).join(" – ")]);
  if (word.governedCase) rows.push(["Case", word.governedCase]);
  if (!rows.length) return null;
  return (
    <dl className="forms">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExampleSentence({ sentence, highlight = true }: { sentence: Sentence; highlight?: boolean }) {
  const [before, target, after] = splitHighlight(sentence);
  return (
    <div className="example">
      <div className="de" lang="de">
        {highlight ? (
          <>
            {before}
            <mark>{target}</mark>
            {after}
          </>
        ) : (
          sentence.germanText
        )}
      </div>
      <div className="en">{sentence.englishText}</div>
      {sentence.grammarNote && <div className="small muted">{sentence.grammarNote}</div>}
    </div>
  );
}

export function SpeakButton({
  text,
  audioReference,
  enabled = true,
  label = "Play pronunciation"
}: {
  text: string;
  audioReference?: string;
  enabled?: boolean;
  label?: string;
}) {
  if (!enabled || (!audioReference && !canSpeak())) return null;
  return (
    <button type="button" className="btn small" onClick={() => playPronunciation(text, audioReference)} aria-label={label}>
      🔊 {label}
    </button>
  );
}

export function Notes({ sense }: { sense: WordSense }) {
  if (!sense.usageNote && !sense.grammarNote) return null;
  return (
    <div className="small">
      {sense.usageNote && (
        <div>
          <strong>Common pattern:</strong> {sense.usageNote}
        </div>
      )}
      {sense.grammarNote && (
        <div>
          <strong>Note:</strong> {sense.grammarNote}
        </div>
      )}
    </div>
  );
}
