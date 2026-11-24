"""레슨 원고를 lessons.json 형식으로 바꿔 주는 도우미."""


def L(day, topic, emoji, intro, ja, en, fr):
    did = f"d{day:02d}"

    def sec(lang, d):
        out = {"grammar": {"title": d["g"][0], "desc": d["g"][1]}}
        if d.get("verb"):
            out["verb"] = d["verb"]
        items = []
        for n, it in enumerate(d["items"], 1):
            x = {"id": f"{did}-{lang}-{n}"}
            if lang == "ja":
                ruby, ko, simple, note, kanji = it
                x.update(ruby=ruby, ko=ko, simple=simple, note=note, kanji=[list(k) for k in kanji])
            elif lang == "en":
                text, ko, simple, note = it
                x.update(text=text, ko=ko, simple=simple, note=note)
            else:
                text, ko, note = it
                x.update(text=text, ko=ko, note=note)
            items.append(x)
        out["items"] = items
        out["task"] = d["task"]
        return out

    return {"id": did, "day": day, "topic": topic, "emoji": emoji, "intro": intro,
            "ja": sec("ja", ja), "en": sec("en", en), "fr": sec("fr", fr)}


def jverb(dict_, reading, ko, masu, te, nai, pot, vol):
    return {"dict": dict_, "reading": reading, "ko": ko,
            "forms": [["ます형", masu], ["て형", te], ["ない형", nai], ["가능형", pot], ["의지형", vol]]}


def fverb(dict_, ko, je, tu, il, nous, vous, ils):
    return {"dict": dict_, "ko": ko,
            "forms": [["je", je], ["tu", tu], ["il/elle", il], ["nous", nous], ["vous", vous], ["ils/elles", ils]]}
