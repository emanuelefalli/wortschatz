"""Clean the extracted OCR pairs and drop those already in data/vocab.
Usage: python3 scripts/ocr-pending.py raw.json pending.json [start end]"""
import json, re, sys, glob
raw = json.load(open(sys.argv[1]))
have = set()
for f in glob.glob("data/vocab/*.json"):
    for e in json.load(open(f))["entries"]:
        have.add(e["l"].lower().replace("sich ", ""))
HEADING = re.compile(r"School life|Work experience|Socialising|TV, films|Environmental|Sport, outdoor|Local area|Holidays and|Food and drink|Life in the home")
out, seen = [], set()
for e in raw:
    de = e["de"]
    if HEADING.search(de) or HEADING.search(e["en"]):
        continue
    lemma = re.sub(r"\s*\(.*?\)", "", de)          # "Abend (abends)" -> Abend
    lemma = lemma.split("/")[0].strip()            # "endlich / zuletzt" -> endlich ; "Sänger/in" -> Sänger
    lemma = re.sub(r"\s+", " ", lemma).strip(" ,.")
    if not lemma or len(lemma) > 40:
        continue
    k = lemma.lower().replace("sich ", "")
    if k in have or k in seen:
        continue
    seen.add(k)
    out.append({"de": de, "lemma": lemma, "en": e["en"], "tier": e["tier"], "page": e["page"]})
json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
print("pending:", len(out))
if len(sys.argv) > 4:
    a, b = int(sys.argv[3]), int(sys.argv[4])
    for i in range(a, min(b, len(out))):
        e = out[i]
        print(f"{i}|{e['de']}|{e['en']}|{e['tier'][0]}")
