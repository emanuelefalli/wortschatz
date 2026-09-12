/** Browser speech synthesis for German. Silently no-ops when unavailable. */
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speakGerman(text: string): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "de-DE";
  u.rate = 0.9;
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("de"));
  if (voice) u.voice = voice;
  synth.speak(u);
}

/** Play a licensed audio file when the dataset provides one, else synthesize. */
export function playPronunciation(text: string, audioReference?: string): void {
  if (audioReference) {
    const a = new Audio(audioReference);
    a.play().catch(() => speakGerman(text));
    return;
  }
  speakGerman(text);
}
