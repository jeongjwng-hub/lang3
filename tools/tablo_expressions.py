#!/usr/bin/env python3
"""타블로 유튜브 채널(@heytablo) 새 영상을 Gemini(Google AI Studio API)로 분석해
외워 둘 만한 영어 표현을 data/tablo.json 에 쌓습니다.

필요:  환경변수 GEMINI_API_KEY  (https://aistudio.google.com/apikey 에서 발급)
선택:  GEMINI_MODEL  (쉼표로 여러 개, 앞에서부터 시도 · 기본값은 아래 DEFAULT_MODELS 참고)
       TABLO_MAX     (한 번에 분석할 새 영상 수, 기본 1)
       TABLO_VIDEOS  (채널 대신 이 영상 URL/ID만 분석, 쉼표로 구분)
       TABLO_DETAIL  (이 영상을 '대사 한 줄씩 자세히' 대기열 맨 앞에 추가, 쉼표로 구분)
       TABLO_QUICK   (1이면 새 영상을 대사 자세히 대신 핵심 표현만 빠르게 분석)
       TABLO_CHUNKS  (자세히 모드에서 한 번에 분석할 5분 구간 수, 기본 4)

실행할 때마다:
  1) 자세히 대기열(queue)에 영상이 있으면 → 그 영상을 5분씩 이어서 대사 한 줄씩 분석
     (data/tablo/<영상ID>.json, 구간마다 저장해서 중간에 멈춰도 다음에 이어서 해요)
  2) 대기열이 비었으면 → 채널 새 영상 1개를 대기열에 넣고 바로 같은 방식으로 분석 (챕터로 나눠 보여줘요)
     (TABLO_QUICK=1 또는 TABLO_VIDEOS 를 주면 예전처럼 핵심 표현만 빠르게 분석)

사용법:  GEMINI_API_KEY=... python3 tools/tablo_expressions.py
이미 분석한 영상은 건너뜁니다. 외부 패키지 없이 파이썬 기본 라이브러리만 씁니다.
"""
import datetime, json, os, re, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "tablo.json")
HANDLE = "heytablo"
# 앞 모델이 "사용량 많음(503)"이거나 없는 모델(404)이면 다음 모델로 넘어가요
# 2026-11-24 점검: gemini-2.5-* 는 없어졌고(404), flash 계열은 자주 바빠서(503) 가벼운 모델도 함께 시도해요.
DEFAULT_MODELS = "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-flash-latest,gemini-3.5-flash,gemini-3-flash-preview,gemini-3.1-flash-lite"
MODELS = [m.strip() for m in (os.environ.get("GEMINI_MODEL") or DEFAULT_MODELS).split(",") if m.strip()]
MODEL = MODELS[0]
MAX_NEW = int(os.environ.get("TABLO_MAX", "1"))
CHUNK = 300          # 자세히 모드 구간 길이(초)
CHUNKS = int(os.environ.get("TABLO_CHUNKS", "4"))
QUICK_LIMIT = 900    # 일반 모드에서 긴 영상은 앞 15분만
DETAIL_DIR = os.path.join(ROOT, "data", "tablo")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.8"}

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


DETAIL_PROMPT = """너는 한국인 영어 학습자를 돕는 원어민 영어 코치야.
이 영상은 타블로(Tablo)의 유튜브 영상이고, 지금 보는 건 전체 영상 중 {start}~{end} 구간이야.
이 구간에서 들리는 대사를 처음부터 끝까지 빠짐없이, 말한 순서대로 한 줄씩 받아 적고 분석해 줘.

규칙:
- 한 줄 = 한 사람이 이어서 말한 한두 문장. 너무 길면 문장 단위로 나눠.
- time: 그 줄이 시작되는 시각. **전체 영상 기준** "m:ss" 또는 "h:mm:ss" (구간 시작이 {start}이야)
- speaker: 말한 사람 이름 (예: Tablo, John Park). 모르면 "?"
- text: 들린 그대로 (영어는 영어로, 한국어는 한국어로). 추임새(um, uh)는 빼도 돼.
- lang: "en" 또는 "ko"
- tr: 영어 줄이면 자연스러운 한국어 번역, 한국어 줄이면 자연스러운 영어 번역
- notes: 그 줄에서 배울 만한 표현(구어, 슬랭, 관용구, 구동사, 문법 포인트, 문화 맥락)을
  0~3개. phrase(원문 그대로의 표현) + meaning(한국어로 뜻·뉘앙스·쓰임 1~2문장).
  흔한 쉬운 표현은 빼.
- 노래·음악만 나오는 부분은 건너뛰어.
- 들리지 않는 말을 지어내지 마.
summary 에는 이 구간 내용을 한국어 1~2문장으로 요약해."""

DETAIL_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "summary": {"type": "STRING"},
        "lines": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "time": {"type": "STRING"}, "speaker": {"type": "STRING"}, "text": {"type": "STRING"},
                    "lang": {"type": "STRING"}, "tr": {"type": "STRING"},
                    "notes": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                        "phrase": {"type": "STRING"}, "meaning": {"type": "STRING"}}, "required": ["phrase", "meaning"]}},
                },
                "required": ["time", "speaker", "text", "lang", "tr", "notes"],
                "propertyOrdering": ["time", "speaker", "text", "lang", "tr", "notes"],
            },
        },
    },
    "required": ["summary", "lines"],
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


def parse_chapters(desc):
    """영상 설명의 '0:00 제목' 줄들 → [{sec, title}] (유튜브 챕터 규칙: 0:00부터 시작, 3개 이상)"""
    out = []
    for line in (desc or "").splitlines():
        m = re.match(r"^\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|·]?\s*(.+?)\s*$", line)
        if m:
            out.append({"sec": secs(m.group(1)), "title": m.group(2)})
    out.sort(key=lambda c: c["sec"])
    return out if len(out) >= 3 and out[0]["sec"] == 0 else []


def iso_dur(t):
    m = re.match(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", t or "")
    d, h, mi, se = (int(x or 0) for x in m.groups()) if m else (0, 0, 0, 0)
    return d * 86400 + h * 3600 + mi * 60 + se


def video_info(vid, key=None):
    """영상 길이(초)·제목·챕터. 실패하면 (0, "", []).
    유튜브는 GitHub 서버의 직접 접속을 막아서(403/429), YouTube Data API(googleapis.com)를 먼저 써요.
    같은 구글 프로젝트에서 'YouTube Data API v3'를 켜 두면 Gemini 키로 그대로 돼요."""
    key = os.environ.get("YOUTUBE_API_KEY") or key or os.environ.get("GEMINI_API_KEY")
    if key:
        try:
            r = json.loads(http(f"https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id={vid}&key={key}"))
            it = (r.get("items") or [{}])[0]
            dur = iso_dur(it.get("contentDetails", {}).get("duration"))
            if dur:
                ch = parse_chapters(it.get("snippet", {}).get("description", ""))
                print(f"  영상 정보(YouTube Data API): {dur}초, 챕터 {len(ch)}개", flush=True)
                return dur, it["snippet"].get("title", ""), ch
            print(f"  YouTube Data API: 영상 정보 없음 {str(r)[:200]}", flush=True)
        except urllib.error.HTTPError as e:
            msg = e.read().decode()
            hint = " → Google Cloud에서 'YouTube Data API v3'를 사용 설정해 주세요" if "has not been used" in msg or "disabled" in msg or "blocked" in msg else ""
            print(f"  YouTube Data API 실패 {e.code}{hint}: {msg[:300]}", flush=True)
        except Exception as e:
            print(f"  YouTube Data API 실패: {e}", flush=True)
    try:
        body = {"context": {"client": {"clientName": "WEB", "clientVersion": "2.20241120.01.00", "hl": "en"}}, "videoId": vid}
        r = json.loads(http("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", json.dumps(body).encode(),
                            {"Content-Type": "application/json"}))
        vd = r.get("videoDetails") or {}
        if vd.get("lengthSeconds"):
            ch = parse_chapters(vd.get("shortDescription", ""))
            print(f"  영상 정보: {vd.get('lengthSeconds')}초, 챕터 {len(ch)}개", flush=True)
            return int(vd["lengthSeconds"]), vd.get("title", ""), ch
        print(f"  플레이어 API에 영상 정보가 없어요: {str(r.get('playabilityStatus'))[:200]}", flush=True)
    except Exception as e:
        print(f"  플레이어 API 실패: {e}", flush=True)
    try:
        html = http(f"https://www.youtube.com/watch?v={vid}")
    except Exception as e:
        print(f"  영상 페이지 실패: {e}", flush=True)
        return 0, "", []
    m = (re.search(r'"lengthSeconds":"(\d+)"', html) or re.search(r'"approxDurationMs":"(\d+)\d{3}"', html))
    if not m:
        print(f"  영상 길이를 페이지에서 못 찾았어요 (페이지 {len(html)}자)", flush=True)
    t = re.search(r'<meta name="title" content="([^"]*)"', html)
    dm = re.search(r'"shortDescription":"((?:[^"\\]|\\.)*)"', html)
    desc = json.loads(f'"{dm.group(1)}"') if dm else ""
    import html as H
    return (int(m.group(1)) if m else 0), (H.unescape(t.group(1)) if t else ""), parse_chapters(desc)


def hms(sec):
    sec = int(sec)
    return f"{sec // 3600}:{sec // 60 % 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"


def analyze(video, key, prompt=PROMPT, schema=SCHEMA, start=None, end=None):
    """video 가 None 이면 글만 보내요 (챕터 나누기 등)"""
    parts = []
    if video:
        part = {"file_data": {"file_uri": video["url"], "mime_type": "video/*"}}
        if start is not None or end is not None:
            part["video_metadata"] = {k: f"{v}s" for k, v in (("start_offset", start), ("end_offset", end)) if v is not None}
        parts.append(part)
    body = {
        "contents": [{"parts": parts + [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "temperature": 0.3,
            "mediaResolution": "MEDIA_RESOLUTION_LOW",  # 화면보다 말소리가 중요해서 토큰 절약
        },
    }
    raw, last = None, None
    for rnd in range(2):  # 모든 모델을 두 바퀴까지
        for model in MODELS:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            try:
                raw = http(url, json.dumps(body).encode(), {"Content-Type": "application/json", "x-goog-api-key": key}, timeout=300)
                analyze.used = model
                break
            except urllib.error.HTTPError as e:
                msg = e.read().decode()[-400:]
                last = RuntimeError(f"Gemini 오류 {e.code} ({model}): {msg}")
                last.code = e.code
                if e.code == 404 or e.code in (429, 500, 503):
                    print(f"  {model}: {e.code} → 다음 모델", flush=True)
                    time.sleep(0 if e.code == 404 else 8)
                    continue
                raise last  # 400 등은 바로 알려요 (영상 끝을 넘긴 구간 판단에 써요)
            except (TimeoutError, urllib.error.URLError) as e:
                last = RuntimeError(f"연결 문제 ({model}): {e}")
                last.code = 0
                print(f"  {model}: 시간 초과/연결 문제 → 다음 모델", flush=True)
                continue
        if raw is not None:
            break
        print("  모든 모델이 바빠요. 2분 쉬고 한 바퀴 더", flush=True)
        time.sleep(120)
    if raw is None:
        raise last
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
        db = json.load(open(OUT, encoding="utf-8"))
    except FileNotFoundError:
        db = {"version": 1, "channel": f"@{HANDLE}", "videos": []}
    db.setdefault("queue", [])
    return db


def save(db):
    db["videos"].sort(key=lambda v: v.get("date") or v.get("analyzed", ""), reverse=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=1)
        f.write("\n")


def entry(db, vid):
    for v in db["videos"]:
        if v["id"] == vid:
            return v
    v = {"id": vid, "title": "", "date": "", "url": f"https://www.youtube.com/watch?v={vid}", "summary": "", "expressions": []}
    db["videos"].append(v)
    return v


def run_detail(db, vid, key):
    """대기열 맨 앞 영상을 5분 구간씩 이어서 분석. 다 끝나면 대기열에서 빼요."""
    v = entry(db, vid)
    path = os.path.join(DETAIL_DIR, f"{vid}.json")
    try:
        d = json.load(open(path, encoding="utf-8"))
    except FileNotFoundError:
        d = {"id": vid, "lines": [], "sections": [], "done_sec": 0, "duration": 0}
    if not d["duration"] or not v["title"] or not d.get("chapters"):
        dur, title, chs = video_info(vid, key)
        d["duration"] = d["duration"] or dur
        if chs or "chapters" not in d:
            d["chapters"] = chs
        v["title"] = v["title"] or title or vid
    d["title"], d["url"] = v["title"], v["url"]
    dur = d["duration"]
    print(f"자세히 분석: {v['title']} ({hms(d['done_sec'])} / {hms(dur) if dur else '길이 모름'})", flush=True)

    for n in range(CHUNKS):
        a = d["done_sec"]
        if dur and a >= dur:
            break
        b = a + CHUNK if not dur else min(a + CHUNK, dur)
        print(f"  구간 {hms(a)}~{hms(b)}", flush=True)
        try:
            r = analyze(v, key, DETAIL_PROMPT.format(start=hms(a), end=hms(b)), DETAIL_SCHEMA, a, b)
        except Exception as e:
            print(f"  실패: {e}", flush=True)
            # 길이를 모를 때 영상 끝을 넘긴 구간은 400(잘못된 요청)으로 와요. 그때만 끝으로 봐요.
            # 503(사용량 많음) 같은 일시적 오류는 다음 실행에서 이 구간부터 다시 해요.
            if not dur and d["lines"] and getattr(e, "code", 0) == 400:
                d["duration"] = dur = a
            break
        lines = r.get("lines", [])
        secs_raw = [secs(x.get("time", "")) for x in lines]
        # 모델이 구간 기준 시각을 줬으면 구간 시작만큼 더해요
        rel = a > 0 and secs_raw and max(secs_raw) < a - 5
        for x, sc in zip(lines, secs_raw):
            text = str(x.get("text", "")).strip()
            if not text:
                continue
            sc = sc + a if rel else sc
            sc = min(max(sc, a), b)
            d["lines"].append({"sec": sc, "time": hms(sc), "speaker": str(x.get("speaker", "")).strip() or "?",
                               "text": text, "lang": "ko" if x.get("lang") == "ko" else "en",
                               "tr": str(x.get("tr", "")).strip(),
                               "notes": [{"phrase": str(o.get("phrase", "")).strip(), "meaning": str(o.get("meaning", "")).strip()}
                                         for o in x.get("notes", []) if o.get("phrase")][:3]})
        d["sections"].append({"start": a, "end": b, "summary": r.get("summary", ""), "model": getattr(analyze, "used", MODEL)})
        d["done_sec"] = b
        if not dur and not lines:  # 길이를 모를 때 빈 구간이면 끝으로 봐요
            d["duration"] = dur = a
        print(f"  대사 {len(lines)}줄", flush=True)
        write_detail(path, d, v, db)
        time.sleep(15)

    if not d.get("chapters") and d["lines"] and d.get("ai_ch_upto", 0) < d["done_sec"]:
        make_ai_chapters(d, key)
    if dur and d["done_sec"] >= dur:
        print("  이 영상 분석 완료!", flush=True)
        db["queue"] = [q for q in db["queue"] if q != vid]
        v["detail"]["status"] = "done"
    write_detail(path, d, v, db)


CHAPTER_PROMPT = """아래는 타블로 유튜브 영상의 대사 기록이야 (시각 화자: 대사).
대화 주제가 바뀌는 지점을 기준으로 챕터를 나눠 줘. 유튜브 챕터처럼.
- 5분에 1~2개 정도, 한 챕터는 최소 2분
- 첫 챕터는 0:00
- time: 챕터가 시작되는 대사의 시각 (아래 기록에 있는 시각 그대로)
- title: 한국어로 짧고 구체적으로 (예: "영국 악센트가 똑똑해 보이는 이유", 20자 안팎)

대사 기록:
{script}"""

CHAPTER_SCHEMA = {"type": "OBJECT", "properties": {"chapters": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
    "time": {"type": "STRING"}, "title": {"type": "STRING"}}, "required": ["time", "title"]}}}, "required": ["chapters"]}


def make_ai_chapters(d, key):
    """유튜브 챕터를 못 가져왔을 때: 지금까지 분석한 대사로 주제별 챕터를 만들어요 (글만 보내서 가벼워요)."""
    script = "\n".join(f"{l['time']} {l['speaker']}: {l['text'][:160]}" for l in d["lines"])
    try:
        r = analyze(None, key, CHAPTER_PROMPT.format(script=script), CHAPTER_SCHEMA)
    except Exception as e:
        print(f"  챕터 만들기 실패: {e}", flush=True)
        return
    out = []
    for c in r.get("chapters", []):
        sc, title = secs(c.get("time", "")), str(c.get("title", "")).strip()
        if title and sc <= d["done_sec"] and (not out or sc > out[-1]["sec"]):
            out.append({"sec": sc, "title": title})
    if out:
        out[0]["sec"] = 0
        d["ai_chapters"], d["ai_ch_upto"] = out, d["done_sec"]
        print(f"  AI 챕터 {len(out)}개", flush=True)


def write_detail(path, d, v, db):
    d["lines"].sort(key=lambda x: x["sec"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write("\n")
    old = v.get("detail") or {}
    v["detail"] = {"status": "done" if old.get("status") == "done" else "running", "done_sec": d["done_sec"], "duration": d["duration"],
                   "lines": len(d["lines"]), "notes": sum(len(x["notes"]) for x in d["lines"])}
    if not v.get("summary") and d["sections"]:
        v["summary"] = " ".join(s["summary"] for s in d["sections"][:2])
    v.setdefault("analyzed", datetime.date.today().isoformat())
    save(db)


def run_quick(db, key):
    seen = {v["id"] for v in db["videos"]}
    if os.environ.get("TABLO_VIDEOS"):
        cands = [video_from_arg(s) for s in os.environ["TABLO_VIDEOS"].split(",") if s.strip()]
    else:
        cands = latest_videos(channel_id(HANDLE))
    todo = [v for v in cands if v["id"] not in seen][:MAX_NEW]
    if not todo:
        print("새 영상이 없어요")
        return
    for v in todo:
        dur, title, _ = video_info(v["id"], key)
        v["title"] = v["title"] or title or v["id"]
        end = QUICK_LIMIT if dur > QUICK_LIMIT else None
        print(f"분석 중: {v['title']}" + (f" (앞 {QUICK_LIMIT // 60}분만)" if end else ""), flush=True)
        try:
            r = analyze(v, key, start=0 if end else None, end=end)
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
        db["videos"].append({**v, "summary": r.get("summary", ""), "expressions": exps,
                             "analyzed": datetime.date.today().isoformat(), "model": getattr(analyze, "used", MODEL)})
        save(db)
        print(f"  표현 {len(exps)}개", flush=True)


def main():
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY 환경변수가 필요해요 (https://aistudio.google.com/apikey)")
    db = load()
    add = [video_from_arg(s)["id"] for s in os.environ.get("TABLO_DETAIL", "").split(",") if s.strip()]
    if add:
        db["queue"] = add + [q for q in db["queue"] if q not in add]
        for vid in add:
            e = entry(db, vid)
            e.setdefault("detail", {"status": "queued", "done_sec": 0, "duration": 0, "lines": 0, "notes": 0})
        save(db)
    if not db["queue"] and not (os.environ.get("TABLO_QUICK") or os.environ.get("TABLO_VIDEOS")):
        # 새 영상은 처음부터 '대사 한 줄씩 + 챕터'로 분석해요. (TABLO_QUICK=1 이면 예전처럼 핵심 표현만)
        seen = {v["id"] for v in db["videos"]}
        new = [v for v in latest_videos(channel_id(HANDLE)) if v["id"] not in seen][:MAX_NEW]
        if not new:
            print("새 영상이 없어요")
        for v in new:
            e = entry(db, v["id"])
            e["title"] = e["title"] or v.get("title", "")
            e["date"] = e["date"] or v.get("date", "")
            e.setdefault("detail", {"status": "queued", "done_sec": 0, "duration": 0, "lines": 0, "notes": 0})
            db["queue"].append(v["id"])
        if new:
            save(db)
    if db["queue"]:
        run_detail(db, db["queue"][0], key)
    elif os.environ.get("TABLO_QUICK") or os.environ.get("TABLO_VIDEOS"):
        run_quick(db, key)
    print("완료")


if __name__ == "__main__":
    main()
