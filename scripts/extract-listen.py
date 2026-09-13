"""Extract the verbs from Hans Witzlinger's "Deutsch – Aber Hallo! Listen &
Tabellen A1–A2" PDF (sections 2–4: verbs with dative / dative + accusative /
prepositional objects, section 6: strong and mixed verbs).

Usage: PYTHONPATH=<pdfplumber dir> python3 scripts/extract-listen.py listen-tabellen_a1-a2.pdf raw.json
Output: {lemma: {sections, ex[], p3[], pret[], pp[], aux[], refl[], sein[]}}.
Entries already present in data/vocab are listed on stderr so only the
missing ones need to be authored in scripts/listen-entries/.
"""
import glob, json, re, sys
import pdfplumber

PDF, OUT = sys.argv[1], sys.argv[2]
verbs = {}

def add(lemma, sec, **kw):
    d = verbs.setdefault(lemma.strip(), {"sections": []})
    d["sections"].append(sec)
    for k, v in kw.items():
        if v:
            d.setdefault(k, []).append(v)

with pdfplumber.open(PDF) as pdf:
    texts = [p.extract_text() or "" for p in pdf.pages]

sec = None
for line in texts[3].splitlines():  # page 4: sections 2 and 3
    if line.startswith("2.1."): sec = "dat-pers"; continue
    if line.startswith("2.2."): sec = "dat-impers"; continue
    if line.startswith("3."): sec = "dat-akk"; continue
    m = re.match(r"^([a-zäöüß]+(?: / [a-zäöüß]+)?) ((?:Jemand|Etwas).*?)(\d)?$", line)
    if m and sec:
        for l in m.group(1).split(" / "):
            add(l, sec, ex=m.group(2), sein=bool(m.group(3)))
for line in texts[4].splitlines():  # page 5: section 4
    m = re.match(r"^([a-zäöüß]+(?: / [A-Za-zäöüß ]+?)?)( \(sich\)| sich| \[sich\])? ((?:Ich|Er|Du|Es|Man|Sie|Etwas|Musik|Die|Das|Was).*)$", line)
    if m:
        add(m.group(1).split(" / ")[0], "prep", ex=m.group(3), refl=(m.group(2) or "").strip())
for t in texts[6:8]:  # pages 7–8: section 6
    for line in t.splitlines():
        m = re.match(r"^([a-zäöüß]+)\d? (\S+(?: / \S+)?) (\S+(?: / \S+\*?)?) (\S+(?: / \S+\*?)?) (\S+) (hat|ist|ist / hat)\d?$", line)
        if m:
            add(m.group(1), "strong", p3=m.group(2), pret=m.group(3), pp=m.group(5), aux=m.group(6))

have = set()
for f in glob.glob("data/vocab/*.json"):
    for e in json.load(open(f))["entries"]:
        have.add(e["l"].lower().replace("sich ", ""))
new = {l: v for l, v in verbs.items() if l.lower() not in have}
json.dump(verbs, open(OUT, "w"), ensure_ascii=False, indent=1)
print(f"{len(verbs)} verbs in the PDF, {len(verbs) - len(new)} already in data/vocab, {len(new)} new: {sorted(new)}", file=sys.stderr)
