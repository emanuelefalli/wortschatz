"""Extract German/English pairs from the OCR GCSE German vocabulary list PDF.

Usage: PYTHONPATH=<pdfplumber dir> python3 scripts/extract-ocr.py <pdf> <out.json>
Output: list of {de, en, tier, topic, page}. Articles, plurals and example
sentences are not in the PDF and are added later.
"""
import json, re, sys, collections
import pdfplumber

PDF, OUT = sys.argv[1], sys.argv[2]
SKIP = re.compile(r"^(GCSE German General Vocabulary List|© OCR|Page \d+ of|German Vocabulary List General|Topic Area \d)")
entries = []
tier, topic = "Foundation", "General"
with pdfplumber.open(PDF) as pdf:
    for pno, page in enumerate(pdf.pages, start=1):
        if pno < 5:
            continue
        words = page.extract_words(keep_blank_chars=False)
        if not words:
            continue
        # English column = the most common x0 among words to the right of 150pt
        hist = collections.Counter(round(w["x0"]) for w in words if w["x0"] > 150)
        if not hist:
            continue
        col = hist.most_common(1)[0][0]
        rows = collections.defaultdict(list)
        for w in words:
            rows[round(w["top"] / 3)].append(w)
        for k in sorted(rows):
            ws = sorted(rows[k], key=lambda w: w["x0"])
            de = " ".join(w["text"] for w in ws if w["x0"] < col - 3).strip()
            en = " ".join(w["text"] for w in ws if w["x0"] >= col - 3).strip()
            line = (de + " " + en).strip()
            if not line or SKIP.match(line):
                continue
            if line in ("Foundation", "Higher"):
                tier = line
                continue
            if not en:
                # section heading (topic name) or wrapped fragment
                if len(de) > 3 and de[0].isupper() and not entries or (len(de.split()) >= 2 and de[0].isupper() and "," not in de):
                    topic = de
                continue
            if not de:
                # continuation of the previous English meaning
                if entries:
                    entries[-1]["en"] += " " + en
                continue
            entries.append({"de": de, "en": en, "tier": tier, "topic": topic, "page": pno})
json.dump(entries, open(OUT, "w"), ensure_ascii=False, indent=1)
print(len(entries), "pairs;", collections.Counter(e["tier"] for e in entries))
print("topics:", sorted(set(e["topic"] for e in entries))[:40])
