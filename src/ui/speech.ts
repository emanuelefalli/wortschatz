/** Browser speech recognition (Web Speech API). An aid, not an examiner (spec §8). */

type RecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function ctor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function canRecognize(): boolean {
  return typeof window !== "undefined" && !!ctor();
}

export type RecognitionResult = { transcript: string; confidence: number; alternatives: string[] };

/** Listen once (until the speaker pauses) and return the best transcript. */
export function recognizeOnce(lang = "de-DE", timeoutMs = 8000): Promise<RecognitionResult> {
  const C = ctor();
  if (!C) return Promise.reject(new Error("Speech recognition is not available in this browser."));
  return new Promise((resolve, reject) => {
    const r = new C();
    r.lang = lang;
    r.interimResults = false;
    r.maxAlternatives = 5;
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        r.abort();
        reject(new Error("No speech detected."));
      }
    }, timeoutMs);
    r.onresult = (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const alts = Array.from(e.results[0] ?? []);
      const best = alts[0];
      resolve({ transcript: best?.transcript ?? "", confidence: best?.confidence ?? 0, alternatives: alts.map((a) => a.transcript) });
    };
    r.onerror = (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(e.error === "not-allowed" ? "Microphone access was denied." : `Recognition error: ${e.error}`));
    };
    r.onend = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new Error("No speech detected."));
      }
    };
    r.start();
  });
}
