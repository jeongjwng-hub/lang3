#!/usr/bin/env python3
"""타블로 유튜브 채널(@heytablo) 새 영상을 Gemini(Google AI Studio API)로 분석해
외워 둘 만한 영어 표현을 data/tablo.json 에 쌓습니다.

필요:  환경변수 GEMINI_API_KEY  (https://aistudio.google.com/apikey 에서 발급)
선택:  GEMINI_MODEL  (기본 gemini-flash-latest)
       TABLO_MAX     (한 번에 분석할 새 영상 수, 기본 3)
       TABLO_VIDEOS  (채널 대신 이 영상 URL/ID만 분석, 쉼표로 구분)

사용법:  GEMINI_API_KEY=... python3 tools/tablo_expressions.py
이미 분석한 영상은 건너뜁니다. 외부 패키지 없이 파이썬 기본 라이브러리만 씁니다.
"""
import datetime, json, os, re, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "tablo.json")
HANDLE = "heytablo"
MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
MAX_NEW = int(os.environ.get("TABLO_MAX", "3"))
UA = {"User-Agent": "Mozilla/5.0 (lang3 study app)", "Accept-Language": "en-US,en;q=0.8"}

PROMPT = """너는 한국인 영어 학습자를 돕는 원어민 영어 코치야.
이 유튜브 영상은 타블로(Tablo)의 채널 영상이야. 영상에서 실제로 말한 영어 중에서
한국인 중상급 학습자가 외워서 일상 대화에 바로 쓸 수 있는 표현을 골라 정리해 줘.

고르는 기준:
- 원어민이 자주 쓰지만 교과서에는 잘 안 나오는 구어 표현, 구동사, 관용구, 말 잇는 표현, 감정·의견 표현
- 너무 쉬운 표현(I think, very good 등)과 욕설·고유명사·노래 가사는 제외
- 영상에서 실제로 들린 문장만 사용 (지어내지 말 것). 영어가 거의 없는 영상이면 expressions 를 빈 배열로.
- 최대 8개, 가장 쓸모 있는 순서로

각 표현마다:
- phrase: 외울 핵심 표현 (예: "hit it off", "I'm not gonna lie")
- quote: 영상 속 실제 문장 그대로 (영어)
- ko: quote 의 자연스러운 한국어 번역
- meaning: 핵심 표현의 뜻과 뉘앙스를 한국어로 1~2문장
- example: 이 표현을 쓴 새 예문 하나 (영상과 다른 일상 상황, 영어)
- example_ko: 예문 번역
- time: 그 문장이 나온 영상 시각 "m:ss" (모르면 빈 문자열)
- level: "중급" 또는 "고급"

summary 는 영상 내용을 한국어 2문장으로 요약해."""

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "summary": {"type": "STRING"},
        "expressions": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {k: {"type": "STRING"} for k in
                               ["phrase", "quote", "ko", "meaning", "example", "example_ko", "time", "level"]},
                "required": ["phrase", "quote", "ko", "meaning", "example", "example_ko", "time", "level"],
                "propertyOrdering": ["phrase", "quote", "ko", "meaning", "example", "example_ko", "time", "level"],
            },
        },
    },
    "required": ["summary", "expressions"],
}


def http(url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def channel_id(handle):
    html = http(f"https://www.youtube.com/@{handle}")
    for pat in (r'"externalId":"(UC[\w-]{22})"', r'"channelId":"(UC[\w-]{22})"', r'channel/(UC[\w-]{22})'):
        m = re.search(pat, html)
        if m:
            return m.group(1)
    raise RuntimeError(f"@{handle} 채널 ID를 찾지 못했어요")


def latest_videos(cid):
    """채널 RSS(최신 15개). API 키가 필요 없어요."""
    xml = http(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}")
    ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
    vids = []
    for e in ET.fromstring(xml).findall("a:entry", ns):
        vid = e.find("yt:videoId", ns).text
        vids.append({"id": vid, "title": e.find("a:title", ns).text or "",
                     "date": (e.find("a:published", ns).text or "")[:10],
                     "url": f"https://www.youtube.com/watch?v={vid}"})
    return vids


def video_from_arg(s):
    m = re.search(r"(?:v=|youtu\.be/|shorts/)([\w-]{11})", s)
    vid = m.group(1) if m else s.strip()
    return {"id": vid, "title": "", "date": "", "url": f"https://www.youtube.com/watch?v={vid}"}


def analyze(video, key):
    body = {
        "contents": [{"parts": [
            {"file_data": {"file_uri": video["url"], "mime_type": "video/*"}},
            {"text": PROMPT},
        ]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
            "temperature": 0.3,
            "mediaResolution": "MEDIA_RESOLUTION_LOW",  # 화면보다 말소리가 중요해서 토큰 절약
        },
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    for attempt in range(4):
        try:
            raw = http(url, json.dumps(body).encode(), {"Content-Type": "application/json", "x-goog-api-key": key}, timeout=600)
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[-500:]
            if e.code in (429, 500, 503) and attempt < 3:
                print(f"  잠시 후 다시 시도 ({e.code})", flush=True)
                time.sleep(20 * (attempt + 1))
                continue
            raise RuntimeError(f"Gemini 오류 {e.code}: {msg}")
    res = json.loads(raw)
    try:
        text = "".join(p.get("text", "") for p in res["candidates"][0]["content"]["parts"])
    except (KeyError, IndexError):
        raise RuntimeError(f"Gemini 응답이 비었어요: {raw[:500]}")
    return json.loads(text)


def secs(t):
    parts = [int(x) for x in re.findall(r"\d+", t or "")][-3:]
    n = 0
    for p in parts:
        n = n * 60 + p
    return n


def load():
    try:
        return json.load(open(OUT, encoding="utf-8"))
    except FileNotFoundError:
        return {"version": 1, "channel": f"@{HANDLE}", "videos": []}


def main():
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY 환경변수가 필요해요 (https://aistudio.google.com/apikey)")
    db = load()
    seen = {v["id"] for v in db["videos"]}

    if os.environ.get("TABLO_VIDEOS"):
        cands = [video_from_arg(s) for s in os.environ["TABLO_VIDEOS"].split(",") if s.strip()]
    else:
        cands = latest_videos(channel_id(HANDLE))
    todo = [v for v in cands if v["id"] not in seen][:MAX_NEW]
    if not todo:
        print("새 영상이 없어요")
        return

    added = 0
    for v in todo:
        print(f"분석 중: {v['title'] or v['id']}", flush=True)
        try:
            r = analyze(v, key)
        except Exception as e:  # 한 영상이 실패해도 나머지는 계속
            print(f"  실패: {e}", flush=True)
            continue
        exps = []
        for i, x in enumerate(r.get("expressions", [])[:8], 1):
            x = {k: str(x.get(k, "")).strip() for k in SCHEMA["properties"]["expressions"]["items"]["properties"]}
            if not x["phrase"] or not x["quote"]:
                continue
            x["id"] = f"tb-{v['id']}-{i}"
            x["sec"] = secs(x["time"])
            exps.append(x)
        db["videos"].insert(0, {**v, "summary": r.get("summary", ""), "expressions": exps,
                                "analyzed": datetime.date.today().isoformat(), "model": MODEL})
        added += 1
        print(f"  표현 {len(exps)}개", flush=True)

    db["videos"].sort(key=lambda v: v.get("date") or v["analyzed"], reverse=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"완료: 새 영상 {added}개 → {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
