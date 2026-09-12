import { describe, expect, it } from "vitest";
import { expectedAnswer, gradeAnswer, gradeCloze, promptText } from "../src/domain/grader";
import { firstSense } from "./fixtures";

describe("DE→EN grading", () => {
  const [tisch, tischSense] = firstSense("Tisch");
  const [laufen, laufenSense] = firstSense("laufen");
  const [stadt, stadtSense] = firstSense("Stadt");

  it("accepts the canonical answer, ignoring case, whitespace and punctuation", () => {
    expect(gradeAnswer(tisch, tischSense, "de_en", "  Table. ").outcome).toBe("correct");
  });
  it("accepts 'the' / 'a' before nouns and 'to'-less verbs", () => {
    expect(gradeAnswer(tisch, tischSense, "de_en", "the table").outcome).toBe("correct");
    expect(gradeAnswer(tisch, tischSense, "de_en", "a table").outcome).toBe("correct");
    expect(gradeAnswer(laufen, laufenSense, "de_en", "run").outcome).toBe("correct");
  });
  it("accepts stored synonyms but not semantic relatives", () => {
    expect(gradeAnswer(stadt, stadtSense, "de_en", "town").outcome).toBe("correct");
    const r = gradeAnswer(stadt, stadtSense, "de_en", "village");
    expect(r.outcome).toBe("wrong");
    expect(r.reasons[0]).toMatch(/not an accepted translation/);
  });
  it("classifies a one-letter typo as almost with a reason", () => {
    const r = gradeAnswer(tisch, tischSense, "de_en", "tabel");
    expect(r.outcome).toBe("almost");
    expect(r.reasons[0]).toMatch(/Spelling/);
  });
  it("returns unknown for an empty answer", () => {
    expect(gradeAnswer(tisch, tischSense, "de_en", "   ").outcome).toBe("unknown");
  });
  it("prompt never contains the answer", () => {
    expect(promptText(tisch, tischSense, "de_en")).toBe("der Tisch");
    expect(promptText(tisch, tischSense, "en_de")).toBe("table");
  });
});

describe("EN→DE grading", () => {
  const [tisch, tischSense] = firstSense("Tisch");
  const [strasse, strasseSense] = firstSense("Straße");
  const [apfel, apfelSense] = firstSense("Apfel");
  const [schoen, schoenSense] = firstSense("schön");
  const [laufen, laufenSense] = firstSense("laufen");

  it("requires the definite article for nouns by default", () => {
    expect(expectedAnswer(tisch, tischSense, "en_de")).toBe("der Tisch");
    expect(gradeAnswer(tisch, tischSense, "en_de", "der Tisch").outcome).toBe("correct");
    const r = gradeAnswer(tisch, tischSense, "en_de", "Tisch");
    expect(r.outcome).toBe("almost");
    expect(r.reasons[0]).toMatch(/Missing article/);
  });
  it("accepts a bare noun when article requirement is disabled", () => {
    const r = gradeAnswer(tisch, tischSense, "en_de", "Tisch", { umlautTolerance: "almost", requireArticle: false });
    expect(r.outcome).toBe("correct");
  });
  it("flags a wrong article as almost", () => {
    const r = gradeAnswer(tisch, tischSense, "en_de", "die Tisch");
    expect(r.outcome).toBe("almost");
    expect(r.reasons[0]).toMatch(/Wrong article/);
  });
  it("flags missing noun capitalization as almost", () => {
    const r = gradeAnswer(tisch, tischSense, "en_de", "der tisch");
    expect(r.outcome).toBe("almost");
    expect(r.reasons[0]).toMatch(/Capitalization/);
  });
  it("handles umlaut substitutions according to tolerance", () => {
    expect(gradeAnswer(schoen, schoenSense, "en_de", "schoen").outcome).toBe("almost");
    expect(
      gradeAnswer(schoen, schoenSense, "en_de", "schoen", { umlautTolerance: "accept", requireArticle: true }).outcome
    ).toBe("correct");
    expect(
      gradeAnswer(schoen, schoenSense, "en_de", "schoen", { umlautTolerance: "strict", requireArticle: true }).outcome
    ).toBe("wrong");
  });
  it("accepts stored German variants (ss for ß) as correct", () => {
    expect(gradeAnswer(strasse, strasseSense, "en_de", "die Strasse").outcome).toBe("correct");
  });
  it("reports multiple reasons at once", () => {
    const r = gradeAnswer(apfel, apfelSense, "en_de", "apfel");
    expect(r.outcome).toBe("almost");
    expect(r.reasons.length).toBe(2);
  });
  it("classifies a minor typo as almost and a different word as wrong", () => {
    expect(gradeAnswer(laufen, laufenSense, "en_de", "laufn").outcome).toBe("almost");
    expect(gradeAnswer(laufen, laufenSense, "en_de", "gehen").outcome).toBe("wrong");
  });
  it("handles NFD Unicode input", () => {
    const nfd = "schön"; // o + combining diaeresis
    expect(gradeAnswer(schoen, schoenSense, "en_de", nfd).outcome).toBe("correct");
  });
  it("non-nouns are compared case-insensitively", () => {
    expect(gradeAnswer(schoen, schoenSense, "en_de", "Schön").outcome).toBe("correct");
  });
});

describe("cloze grading", () => {
  it("is case-insensitive and umlaut tolerant", () => {
    expect(gradeCloze("läuft", "LAEUFT").correct).toBe(true);
    expect(gradeCloze("Vorschlag", "vorschlag").correct).toBe(true);
    expect(gradeCloze("Vorschlag", "Vorschlg").correct).toBe(true);
    expect(gradeCloze("Vorschlag", "Termin").correct).toBe(false);
  });
});
