"""Merge hand-written entry batches (scripts/ocr-entries/*.json) into a compact
dataset, dropping anything that already exists in other data/vocab files.
Usage: python3 scripts/build-ocr.py data/vocab/ocr-gcse-a2b1.json"""
import json, sys, glob, random
out_path = sys.argv[1]
have = set()
for f in glob.glob("data/vocab/*.json"):
    if f.replace("\\\\", "/") == out_path:
        continue
    for e in json.load(open(f))["entries"]:
        have.add(e["l"].lower().replace("sich ", ""))
entries, seen, dropped = [], set(), []
for f in sorted(glob.glob("scripts/ocr-entries/*.json")):
    for e in json.load(open(f)):
        e.pop("i", None)
        k = e["l"].lower().replace("sich ", "")
        if k in have or k in seen:
            dropped.append(e["l"])
            continue
        seen.add(k)
        entries.append(e)
order = list(range(len(entries)))
random.Random(20260912).shuffle(order)
for rank, idx in enumerate(order, start=1):
    entries[idx]["rank"] = rank
data = {
    "meta": {
        "name": "OCR GCSE German vocabulary (Foundation ≈ A2, Higher ≈ B1)",
        "source": "Headwords and brief meanings from the OCR GCSE German Vocabulary List (© OCR 2010); articles, plurals, verb forms and example sentences with translations written for this project",
        "license": "Personal, non-commercial study use of the OCR word list; original additions CC0-1.0",
        "notes": "Entries already present in the other data/vocab files were left out. Ranks are a stable shuffle so new words are mixed across topics.",
        "format": "compact-v1",
    },
    "entries": entries,
}
json.dump(data, open(out_path, "w"), ensure_ascii=False, indent=0)
print(f"{len(entries)} entries written; {len(dropped)} dropped as duplicates: {dropped[:20]}")
