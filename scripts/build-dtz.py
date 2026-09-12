"""Merge extracted DTZ entries with translation batches into a compact dataset.

Usage: python3 scripts/build-dtz.py <pending.json> <translations dir> <out.json>
Translation batch files: JSON arrays of {"i": <index into pending>, "en": [...], "x": "<English of first example>", "p"?: pos override, "n"?: note}
Entries without a translation are left out (and counted).
"""
import json, sys, glob, os, re, random
pending = json.load(open(sys.argv[1]))
tr = {}
for f in sorted(glob.glob(os.path.join(sys.argv[2], "*.json"))):
    for t in json.load(open(f)):
        if "i" in t:
            tr[t["i"]] = t
entries = []
missing = 0
for i, e in enumerate(pending):
    t = tr.get(i)
    if not t or not t.get("en"):
        missing += 1
        continue
    pos = t.get("p", e["pos"])
    lemma = t.get("l") or e["lemma"]
    ex = e["examples"][0]
    # target text: the lemma or an inflected form present in the sentence
    target = None
    cands = [lemma]
    if e.get("forms"):
        cands += [x for x in (e["forms"].get("p3"), e["forms"].get("pret"), e["forms"].get("pp")) if x]
        cands += [c.split(" ")[0] for c in cands if " " in c]
    for pl in (t.get("pl"), e.get("plural")):
        if pl and not pl.startswith("(") and pl != "-":
            cands.append(pl)
    base = lemma.replace("sich ", "")
    cands += [base, base[0].upper() + base[1:], base[0].lower() + base[1:]]
    for c in cands:
        if c and c in ex:
            target = c
            break
    words = re.findall(r"[A-Za-zÄÖÜäöüß]+", ex)
    if t.get("t"):
        target = t["t"]
    if not target and e.get("forms") and e["forms"].get("p3") and " " in e["forms"]["p3"]:
        # Separable verb: "geben … an", "angezogen", "anzuschnallen"
        prefix = e["forms"]["p3"].split(" ", 1)[1].strip()
        verb = base[len(prefix):] if base.startswith(prefix) else base
        stem = re.sub(r"(en|n|e)$", "", verb.lower())
        for w in words:
            wl = w.lower()
            if wl.startswith(prefix + "ge") or wl.startswith(prefix + "zu") or (len(stem) >= 3 and wl.startswith(stem)):
                target = w
                break
        if not target and prefix.startswith("he"):
            short = prefix[2:]  # (he)raus -> raus
            for w in words:
                if w.lower().startswith(short + "ge"):
                    target = w
                    break
    if not target:
        # Inflected form: a word starting with (or, for participles, containing) the stem
        stem = re.sub(r"(en|n|e)$", "", base.lower())
        if len(stem) >= 3:
            for w in words:
                if w.lower().startswith(stem):
                    target = w
                    break
            if not target:
                for w in words:
                    if w.lower().startswith("ge") and stem in w.lower():
                        target = w
                        break
    if not target:
        target = ""
    if not target or target not in ex:
        missing += 1
        continue
    entry = {"l": lemma, "p": pos, "c": t.get("c", "B1")}
    if pos == "noun":
        entry["art"] = t.get("a") or e["article"]
        if not entry["art"]:
            missing += 1
            continue
        pl = t.get("pl") or e.get("plural")
        if pl == "-":
            pl = None  # explicit "no plural" override
        if pl and not pl.startswith("("):
            entry["pl"] = pl
    if e.get("forms"):
        f = e["forms"]
        entry["v"] = {"p3": f["p3"], "pret": f["pret"], "pp": f["pp"], "aux": "sein" if f["aux"] == "ist" else "haben"}
        if e.get("reflexive"):
            entry["v"]["refl"] = True
        if f["p3"] and " " in f["p3"]:
            entry["v"]["sep"] = True
    sense = {"en": t["en"], "x": [[ex, t["x"], target]]}
    note = t.get("n") or e.get("note")
    if note:
        sense["gn"] = note
    if e.get("plural") == "(plural only)":
        sense["gn"] = (sense.get("gn", "") + " Plural only.").strip()
    entry["s"] = [sense]
    entries.append(entry)
data = {
    "meta": {
        "name": "DTZ Wortliste (Deutsch-Test für Zuwanderer, A2–B1)",
        "source": "Goethe-Institut / telc, DTZ-Wortliste (headwords, grammar and German example sentences); English translations original",
        "license": "Personal use only – the German content is copyrighted by Goethe-Institut/telc and must not be redistributed",
        "redistributable": False,
        "notes": "Extracted from the learner's own copy of the PDF. Level set to B1 for all entries because the list is not level-tagged.",
        "format": "compact-v1"
    },
    "entries": entries
}
# Stable pseudo-random introduction order (the list carries no frequency data);
# the file itself stays alphabetical for easy inspection.
order = list(range(len(entries)))
random.Random(20260911).shuffle(order)
for rank, idx in enumerate(order, start=1):
    entries[idx]["rank"] = rank
json.dump(data, open(sys.argv[3], "w"), ensure_ascii=False, indent=0)
print(f"{len(entries)} entries written, {missing} without translation/target")
