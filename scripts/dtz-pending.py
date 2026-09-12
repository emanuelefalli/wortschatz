"""Build the pending-translation list (entries not already in data/vocab) and print a batch.
Usage: python3 scripts/dtz-pending.py <raw.json> <pending.json> [start end]"""
import json, sys
r = json.load(open(sys.argv[1]))
have = set()
for f in ["data/vocab/sample-a1a2.json", "data/vocab/extended-a2b1.json"]:
    for e in json.load(open(f))["entries"]:
        have.add(e["l"].lower().replace("sich ", ""))
pending = [e for e in r if e["lemma"].lower().replace("sich ", "") not in have]
json.dump(pending, open(sys.argv[2], "w"), ensure_ascii=False)
print("pending:", len(pending))
if len(sys.argv) > 4:
    a, b = int(sys.argv[3]), int(sys.argv[4])
    for i in range(a, min(b, len(pending))):
        e = pending[i]; g = ""
        if e["pos"] == "noun": g = f" [{e['article']}, pl. {e.get('plural') or '-'}]"
        elif e["pos"] == "verb": g = f" [{e['forms']['p3']}, {e['forms']['pret']}, {e['forms']['aux']} {e['forms']['pp']}]"
        print(f"{i}|{e['lemma']}|{e['pos']}{g}|{e['examples'][0]}")
