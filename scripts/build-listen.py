"""Merge the hand-written entries in scripts/listen-entries/*.json into one
compact dataset, dropping anything already present in the other data/vocab
files. Usage: python3 scripts/build-listen.py data/vocab/listen-tabellen-a2b1.json"""
import glob, json, random, sys
out_path = sys.argv[1]
have = set()
for f in glob.glob("data/vocab/*.json"):
    if f.replace("\\", "/") == out_path:
        continue
    for e in json.load(open(f))["entries"]:
        have.add(e["l"].lower().replace("sich ", ""))
entries, seen, dropped = [], set(), []
for f in sorted(glob.glob("scripts/listen-entries/*.json")):
    for e in json.load(open(f)):
        k = e["l"].lower().replace("sich ", "")
        if k in have or k in seen:
            dropped.append(e["l"])
            continue
        seen.add(k)
        entries.append(e)
order = list(range(len(entries)))
random.Random(20260913).shuffle(order)
for rank, idx in enumerate(order, start=1):
    entries[idx]["rank"] = rank
data = {
    "meta": {
        "name": "Deutsch – Aber Hallo! Listen & Tabellen A1–A2 (verbs)",
        "source": "Headwords, verb forms and government patterns from Hans Witzlinger, Deutsch – Aber Hallo! Listen & Tabellen für die Grundstufe A1–A2; English translations and example sentences written for this project",
        "license": "Personal, non-commercial study use of the verb list; original additions CC0-1.0",
        "notes": "Only the verbs missing from the other data/vocab files (the list overlaps almost entirely with the DTZ and OCR lists). Levels are our own approximation. Ranks are a stable shuffle.",
        "format": "compact-v1",
    },
    "entries": entries,
}
json.dump(data, open(out_path, "w"), ensure_ascii=False, indent=0)
print(f"{len(entries)} entries written; {len(dropped)} dropped as duplicates: {dropped}")
