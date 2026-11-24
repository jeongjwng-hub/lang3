#!/usr/bin/env python3
"""tools/lessons_src/ 의 원고(d04~)를 data/lessons.json 에 합칩니다. 같은 id 는 덮어써요."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lessons_src"))
import a, b, c  # noqa: E402

PATH = os.path.join(os.path.dirname(HERE), "data", "lessons.json")
new = [a.D04, a.D05, b.D06, b.D07, b.D08, c.D09, c.D10]

data = json.load(open(PATH, encoding="utf-8"))
byid = {L["id"]: L for L in data["lessons"]}
for L in new:
    byid[L["id"]] = L
data["lessons"] = sorted(byid.values(), key=lambda L: L["day"])

# 점검: 한자 읽기 표기, id 중복
ids = [i["id"] for L in data["lessons"] for k in ("ja", "en", "fr") for i in L[k]["items"]]
assert len(ids) == len(set(ids)), "id 중복"
json.dump(data, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("레슨", len(data["lessons"]), "개, 표현", len(ids), "개")
