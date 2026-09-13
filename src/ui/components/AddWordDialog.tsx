import { useMemo, useState } from "react";
import { HIDDEN_LEVELS } from "../../data/loader";
import { buildUserWord, detectTarget, findExistingWord, guessPartOfSpeech, sentenceTokens, splitArticle } from "../../data/userWord";
import type { Article, CefrLevel, PartOfSpeech, Word } from "../../domain/types";
import { CEFR_LEVELS } from "../../domain/types";

const POS: PartOfSpeech[] = ["noun", "verb", "adjective", "adverb", "preposition", "pronoun", "conjunction", "numeral", "interjection", "particle", "other"];

export function AddWordDialog({
  words,
  onAdd,
  onOpenExisting,
  onClose
}: {
  words: Word[];
  onAdd: (word: Word) => Promise<void>;
  onOpenExisting: (wordId: string) => void;
  onClose: () => void;
}) {
  const [german, setGerman] = useState("");
  const [english, setEnglish] = useState("");
  const [posOverride, setPosOverride] = useState<PartOfSpeech | "">("");
  const [articleOverride, setArticleOverride] = useState<Article | "">("");
  const [level, setLevel] = useState<CefrLevel>("A2");
  const [exampleDe, setExampleDe] = useState("");
  const [exampleEn, setExampleEn] = useState("");
  const [targetOverride, setTargetOverride] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const { lemma, article: parsedArticle } = splitArticle(german);
  const pos = posOverride || guessPartOfSpeech(german);
  const article = pos === "noun" ? articleOverride || parsedArticle || "" : "";
  const tokens = useMemo(() => sentenceTokens(exampleDe), [exampleDe]);
  const detected = useMemo(() => detectTarget(exampleDe, lemma), [exampleDe, lemma]);
  const target = targetOverride && tokens.includes(targetOverride) ? targetOverride : detected;
  const existing = useMemo(() => findExistingWord(words, lemma, pos), [words, lemma, pos]);
  const levels = CEFR_LEVELS.filter((l) => !HIDDEN_LEVELS.has(l));

  const submit = async () => {
    if (busy) return;
    setError(undefined);
    try {
      const word = buildUserWord({
        german,
        english,
        partOfSpeech: pos,
        cefrLevel: level,
        article,
        exampleDe,
        exampleEn,
        target,
        frequencyRank: Math.max(0, ...words.map((w) => w.frequencyRank)) + 1
      });
      setBusy(true);
      await onAdd(word);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add a word" onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Add a word</h2>
          <button type="button" className="btn small ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label htmlFor="add-german">German word</label>
            <input id="add-german" type="text" lang="de" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="der Tisch · laufen · sich freuen · schnell" value={german} onChange={(e) => setGerman(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="add-english">English translation</label>
            <input id="add-english" type="text" autoComplete="off" placeholder="table; desk" value={english} onChange={(e) => setEnglish(e.target.value)} />
            <span className="small muted">Separate alternative translations with “;”. Each one will be accepted as correct.</span>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="add-pos">Type</label>
              <select id="add-pos" value={pos} onChange={(e) => setPosOverride(e.target.value as PartOfSpeech)}>
                {POS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            {pos === "noun" && (
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="add-article">Article</label>
                <select id="add-article" value={article} onChange={(e) => setArticleOverride(e.target.value as Article | "")}>
                  <option value="">choose…</option>
                  <option value="der">der</option>
                  <option value="die">die</option>
                  <option value="das">das</option>
                </select>
              </div>
            )}
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="add-level">Level</label>
              <select id="add-level" value={level} onChange={(e) => setLevel(e.target.value as CefrLevel)}>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="add-example-de">Example sentence (optional)</label>
            <input id="add-example-de" type="text" lang="de" autoComplete="off" autoCapitalize="sentences" placeholder="Das Buch liegt auf dem Tisch." value={exampleDe} onChange={(e) => setExampleDe(e.target.value)} />
            <input id="add-example-en" type="text" autoComplete="off" placeholder="English translation of the sentence (optional)" aria-label="English translation of the sentence" value={exampleEn} onChange={(e) => setExampleEn(e.target.value)} />
          </div>
          {tokens.length > 0 && (
            <div className="field">
              <label>Word to blank out in the fill-in-the-gap exercise</label>
              <div className="chips" role="radiogroup" aria-label="Target word">
                {tokens.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={t === target} className={`btn small ${t === target ? "selected" : ""}`} onClick={() => setTargetOverride(t)}>
                    {t}
                  </button>
                ))}
              </div>
              {!target && <span className="small muted">The word was not found in the sentence. Tap the word that stands for it.</span>}
            </div>
          )}
          {existing && (
            <div className={existing.exact ? "form-error" : "small muted"}>
              {existing.exact ? "Already in your vocabulary: " : `A word with this spelling exists as ${existing.word.partOfSpeech}: `}
              <strong lang="de">
                {existing.word.article ? `${existing.word.article} ` : ""}
                {existing.word.lemma}
              </strong>{" "}
              ({existing.word.senses[0].englishAnswers.join(", ")}){" "}
              <button type="button" className="btn small ghost" onClick={() => onOpenExisting(existing.word.id)}>
                Open
              </button>
              {!existing.exact && <span> · You can still add it as a {pos}.</span>}
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="row">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy || !lemma || !english.trim() || !!existing?.exact}>
              Add word
            </button>
          </div>
        </form>
        <p className="small muted">Added words are stored with your progress, included in backups and synced to your other devices. They are shown with the level you choose.</p>
      </div>
    </div>
  );
}
