"""Extract entries from the DTZ Wortliste PDF (two-column Goethe/telc layout).

Usage: PYTHONPATH=<pdfplumber dir> python3 scripts/extract-dtz.py dtz_wortliste.pdf out.json

Output: a JSON list of raw entries {lemma, article, plural, forms, reflexive,
header, examples[], page}. Translations are added in a separate step; this
script only reads what is printed.
"""
import json, re, sys, collections
import pdfplumber

PDF, OUT = sys.argv[1], sys.argv[2]
COL_SPLIT = 300          # left column x < 300
HEADER_W = 100           # header sub-column width from column start
COL_START = {0: 42, 1: 305}
UMLAUT = {"a": "ä", "o": "ö", "u": "ü", "A": "Ä", "O": "Ö", "U": "Ü"}

def umlaut(stem):
    # au -> äu, else last a/o/u (any case) -> umlaut
    low = stem.lower()
    i = low.rfind("au")
    j = max(low.rfind(v) for v in "aou")
    if i >= 0 and i + 1 >= j:
        return stem[:i] + ("Äu" if stem[i] == "A" else "äu") + stem[i + 2:]
    if j >= 0:
        return stem[:j] + UMLAUT[stem[j]] + stem[j + 1:]
    return stem

def join_suffix(stem, suffix):
    """Goethe notation overlaps: Abschluss + "sse" -> Abschlüsse, Name + "en" -> Namen."""
    # Only merge a real overlap of 2+ letters (Abschluss + "sse"); "Ergebnis, -se" is a plain append.
    for k in range(min(len(stem), len(suffix)), 1, -1):
        if stem.endswith(suffix[:k]):
            return stem + suffix[k:]
    return stem + suffix

def expand_plural(lemma, raw):
    raw = raw.strip()
    if raw in ("", "-"):
        return lemma if raw == "-" else None
    if raw.startswith("(Pl") or raw.startswith("(Sg"):
        return raw
    m = re.match(r'^-\s*(["”]?)\s*(-?)([a-zäöü]*)$', raw)
    if not m:
        return raw  # keep as printed (e.g. "Leute (Pl.)")
    um, _, suffix = m.groups()
    stem = umlaut(lemma) if um else lemma
    return join_suffix(stem, suffix)

def lines_of(words):
    """Group words into lines by vertical position."""
    rows = collections.defaultdict(list)
    for w in words:
        rows[round(w["top"] / 3)].append(w)
    out = []
    for k in sorted(rows):
        ws = sorted(rows[k], key=lambda w: w["x0"])
        out.append(ws)
    return out

entries = []
with pdfplumber.open(PDF) as pdf:
    for pno, page in enumerate(pdf.pages, start=1):
        words = page.extract_words(extra_attrs=["fontname"], keep_blank_chars=False)
        words = [w for w in words if w["top"] > 70 and "Titel" not in w["fontname"]]
        for col in (0, 1):
            cw = [w for w in words if (w["x0"] < COL_SPLIT) == (col == 0)]
            start = COL_START[col]
            current = None
            last_head_top = None
            for line in lines_of(cw):
                head = [w for w in line if w["x0"] < start + HEADER_W]
                exam = [w for w in line if w["x0"] >= start + HEADER_W]
                head_text = " ".join(w["text"] for w in head).strip()
                exam_text = " ".join(w["text"] for w in exam).strip()
                if head_text and re.fullmatch(r"[A-ZÄÖÜ]", head_text):
                    continue  # letter heading
                if head:
                    top = head[0]["top"]
                    # Wrapped header lines sit ~11pt apart; a new entry leaves a bigger gap.
                    new_entry = current is None or last_head_top is None or top - last_head_top > 13.5
                    last_head_top = top
                    if new_entry:
                        current = {"header": head_text, "examples": [], "page": pno}
                        entries.append(current)
                    else:
                        current["header"] += " " + head_text
                if exam_text and current is not None:
                    if re.match(r"^\d+\.", exam_text) or not current["examples"]:
                        current["examples"].append(exam_text)
                    else:
                        current["examples"][-1] += " " + exam_text

ADJ_SUFFIX = ("lich", "ig", "isch", "bar", "sam", "haft", "los", "voll", "ell", "iv", "al", "ös", "ant", "ent")
PREPS = {"ab","an","auf","aus","bei","bis","durch","für","gegen","gegenüber","hinter","in","mit","nach","neben","ohne","seit","statt","trotz","über","um","unter","von","vor","während","wegen","zu","zwischen","außer","außerhalb","innerhalb","entlang","laut","pro","je"}
CONJ = {"aber","als","bevor","bis","da","damit","dass","denn","falls","nachdem","ob","obwohl","oder","seit","seitdem","sobald","sodass","solange","sondern","sowie","sowohl","und","weil","wenn","während","wie","entweder","weder","zwar"}
PRON = {"ich","du","er","sie","es","wir","ihr","man","mein","dein","sein","unser","euer","dieser","jener","jeder","jemand","niemand","etwas","nichts","alle","alles","einige","mancher","welcher","wer","was","derselbe","einander","irgendein","irgendjemand","irgendwas","selbst","sich"}

def guess_pos(lemma, extra):
    l = lemma.lower()
    if l in PREPS: return "preposition"
    if l in CONJ: return "conjunction"
    if l in PRON: return "pronoun"
    if extra and any(x.startswith(("mehr", "meist", "besser", "höher", "am ")) for x in extra): return "adjective"
    if l.endswith(ADJ_SUFFIX): return "adjective"
    if re.fullmatch(r"(null|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|hundert|tausend|million|erste|zweite|dritte).*", l): return "numeral"
    return "other"

def dehyphenate(text):
    """Join line-wrap hyphens ("Wohnungs- angebote") but keep "Bio- und Naturkost"."""
    return re.sub(r"(\w)- (?!und\b|oder\b|bzw\b)([a-zäöüß])", r"\1\2", text)

def parse(e):
    h = dehyphenate(re.sub(r"\s+", " ", e["header"]).strip())
    h = re.sub(r"\s*,\s*", ", ", h)
    h = h.replace("- \"", "-\"").replace("-\" ", "-\"")
    h = re.sub(r"^([a-zäöü]) ([a-zäöü]{2,})\b", r"\1\2", h)  # kerning glitch: "t un" -> "tun"
    out = {"header": h, "lemma": None, "article": None, "plural": None, "forms": None, "reflexive": False, "pos": "other", "note": None}
    reflexive = h.startswith("sich ")
    body = h[5:] if reflexive else h
    parts = [p.strip() for p in body.split(", ")]
    first = parts[0]
    m = re.match(r"^\(?(der|die|das)\)?\s+(.+)$", first)
    if m:
        out["pos"] = "noun"; out["article"] = m.group(1); lemma = m.group(2)
        pl_only = "(Pl.)" in h or "(nur Pl.)" in h
        lemma = re.sub(r"\s*\((nur )?Pl\.\)|\s*\(Sg\.( oder Pl\.)?\)", "", lemma).strip()
        if "/" in lemma:
            variants = [v.strip() for v in lemma.split("/")]
            lemma = variants[0]
            out["note"] = "Also: " + ", ".join(v for v in variants[1:] if v and v != "-")
        m2 = re.match(r"^(.+?)\s*\((.+)\)$", lemma)
        if m2:
            lemma = m2.group(1); out["note"] = m2.group(2)
        out["lemma"] = lemma
        if pl_only:
            out["plural"] = "(plural only)"
        elif len(parts) > 1:
            out["plural_raw"] = parts[1]
            out["plural"] = expand_plural(lemma, re.sub(r"\s*\((nur )?Pl\.\)", "", parts[1]))
    elif len(parts) >= 3 and any(p.startswith(("hat ", "ist ")) for p in parts):
        out["pos"] = "verb"; out["lemma"] = ("sich " if reflexive else "") + first; out["reflexive"] = reflexive
        forms = parts[1:]
        aux_pp = next((p for p in forms if p.startswith(("hat ", "ist "))), "")
        firstvar = lambda t: t.split("/")[0].strip() if t else t
        out["forms"] = {"p3": firstvar(forms[0]) if len(forms) > 0 else None,
                        "pret": firstvar(forms[1]) if len(forms) > 1 else None,
                        "aux": aux_pp.split(" ")[0] if aux_pp else None,
                        "pp": firstvar(" ".join(aux_pp.split(" ")[1:]).replace("sich ", "")) if aux_pp else None}
    else:
        out["lemma"] = ("sich " if reflexive else "") + first
        out["extra"] = parts[1:] if len(parts) > 1 else None
        out["pos"] = guess_pos(first, out["extra"])
    return out

result = []
for e in entries:
    p = parse(e)
    ex = []
    for x in e["examples"]:
        x = re.sub(r"^\d+\.\s*", "", x).strip()
        x = dehyphenate(re.sub(r"\s+", " ", x))
        x = re.sub(r"^\d\s+(?=[A-ZÄÖÜ„])", "", x)                        # "1 Hast du …"
        x = re.split(r"\s\d\.?\s(?=[A-ZÄÖÜ„])", x)[0].strip()             # "… 2 Parken ist …"
        ex.append(x)
    result.append({**p, "examples": ex, "page": e["page"]})

json.dump(result, open(OUT, "w"), ensure_ascii=False, indent=1)
c = collections.Counter(r["pos"] for r in result)
print(len(result), "entries", dict(c))
print("no examples:", sum(1 for r in result if not r["examples"]))
print("nouns without plural:", sum(1 for r in result if r["pos"] == "noun" and not r.get("plural")))

# ---------------- cleanup pass ----------------
def clean(result):
    # 1. Cut back matter: everything after the last page that has a lemma starting with "zw"/"zu".
    last = max((r["page"] for r in result if r["lemma"] in ("zwischen", "zwölf", "zusammen", "zurzeit")), default=10**9)
    result = [r for r in result if r["page"] <= last]
    out = []
    seen = {}
    for r in result:
        h = r["header"]
        lemma = r["lemma"] or ""
        if any(ch.isdigit() for ch in lemma) or "§" in h or not r["examples"]:
            continue
        # kerning / wrap glitches
        lemma = re.sub(r"(\w{3,}) ([a-zäöüß])$", r"\1\2", lemma)            # "arbeitslo s"
        lemma = re.sub(r"(\w)- ([a-zäöüß]\w+)", r"\1\2", lemma)             # "Bedienungs- anleitung"
        lemma = re.sub(r"\s+-$", "-", lemma)                                 # "all -" -> "all-"
        lemma = lemma.split("/")[0].strip()                                  # "gesamt-/Gesamt-" -> "gesamt-"
        lemma = lemma.replace("(sich etwas) ", "").replace("(sich) ", "").replace("jdn. ", "").replace("(ein) ", "ein ")
        lemma = re.sub(r"\s*\([^)]*\)$", "", lemma).strip()                   # "meistens (meist)"
        if lemma.endswith(".") or "…" in lemma or "..." in lemma:
            lemma = lemma.rstrip(".")
        if not lemma or lemma.endswith(".") or ":" in lemma:
            continue
        if lemma.endswith("-") and r["pos"] != "noun":
            continue  # word-formation elements (all-, irgend-, Haupt-) cannot be graded
        r["lemma"] = lemma
        # plural: take first variant, re-expand when needed
        if r["pos"] == "noun" and r.get("plural_raw"):
            raw = r["plural_raw"].split("/")[0].strip().replace(" ", "")
            raw = re.sub(r'^"-', '-"', raw)
            pl = expand_plural(lemma, raw)
            if pl and not pl.startswith("(") and len(pl) < 3:
                pl = expand_plural(lemma, "-" + raw.lstrip("-‑ ").strip())
            r["plural"] = pl
        if r["pos"] == "noun" and r.get("plural") and re.fullmatch(r"[a-zäöü]{1,3}", r["plural"]):
            r["plural"] = lemma + r["plural"]
        key = (lemma.lower(), r["pos"])
        if key in seen:
            seen[key]["examples"] = seen[key]["examples"] + [x for x in r["examples"] if x not in seen[key]["examples"]]
            continue
        seen[key] = r
        out.append(r)
    return out

result = clean(result)
json.dump(result, open(OUT, "w"), ensure_ascii=False, indent=1)
c = collections.Counter(r["pos"] for r in result)
print("after cleanup:", len(result), "entries", dict(c))
