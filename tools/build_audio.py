#!/usr/bin/env python3
"""lessons.json 으로 발음 클립과 출퇴근용 오디오를 만듭니다.
음성: Microsoft 뉴럴 음성(edge-tts, tools/.venv) → afconvert 로 m4a.

사용법:  python3 tools/build_audio.py
이미 만든 파일은 내용이 바뀌지 않았으면 건너뜁니다.
"""
import hashlib, json, os, re, subprocess, tempfile, time, wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "audio")
EDGE = os.path.join(ROOT, "tools", ".venv", "bin", "edge-tts")
ENGINE = "edge1"  # 음성을 바꾸면 이 값을 바꿔서 전부 다시 만들기
RATE = 24000
VOICES = {"ko": "ko-KR-SunHiNeural", "ja": "ja-JP-NanamiNeural", "en": "en-US-AvaNeural", "fr": "fr-FR-DeniseNeural"}
NORMAL = {"ko": "+0%", "ja": "+0%", "en": "+0%", "fr": "+0%"}
SLOW = {"ja": "-25%", "en": "-25%", "fr": "-25%"}
LANG_NAMES = {"ja": "일본어", "en": "영어", "fr": "프랑스어"}

TMP = tempfile.mkdtemp(prefix="lang3-")
_seg_cache = {}


def plain(item):
    if "ruby" in item:
        return re.sub(r"\{([^|}]+)\|[^}]+\}", r"\1", item["ruby"])
    return item["text"]


def speak(lang, text, rate=None):
    """텍스트를 PCM 바이트로."""
    rate = rate or NORMAL[lang]
    key = (lang, text, rate)
    if key in _seg_cache:
        return _seg_cache[key]
    base = os.path.join(TMP, hashlib.md5(repr(key).encode()).hexdigest())
    for attempt in range(4):
        r = subprocess.run([EDGE, "--voice", VOICES[lang], f"--rate={rate}", "--text", text,
                            "--write-media", base + ".mp3"], capture_output=True)
        if r.returncode == 0 and os.path.getsize(base + ".mp3") > 0:
            break
        time.sleep(2 + attempt * 3)
    else:
        raise RuntimeError(f"음성 생성 실패: {text}\n{r.stderr.decode()[-300:]}")
    path = base + ".wav"
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1", base + ".mp3", path], check=True)
    with wave.open(path) as w:
        data = w.readframes(w.getnframes())
    _seg_cache[key] = data
    return data


def silence(sec):
    return b"\x00\x00" * int(RATE * sec)


def write_m4a(pcm, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    wav = out + ".wav"
    with wave.open(wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(pcm)
    subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "48000", wav, out], check=True)
    os.remove(wav)
    return round(len(pcm) / 2 / RATE, 1)


def build(out, recipe_key, make):
    """recipe_key 가 같으면 다시 만들지 않음."""
    stamp = out + ".key"
    digest = hashlib.md5(recipe_key.encode()).hexdigest()
    if os.path.exists(out) and os.path.exists(stamp) and open(stamp).read().split()[0] == digest:
        return float(open(stamp).read().split()[1])
    dur = write_m4a(make(), out)
    with open(stamp, "w") as f:
        f.write(f"{digest} {dur}")
    return dur


def main():
    data = json.load(open(os.path.join(ROOT, "data", "lessons.json"), encoding="utf-8"))
    manifest = {"items": {}, "tracks": {}}
    for L in data["lessons"]:
        groups = [(lang, L[lang]["items"]) for lang in ("ja", "en", "fr")]

        # 1) 앱 안 발음 버튼용 클립
        for lang, items in groups:
            for it in items:
                t = plain(it)
                out = os.path.join(AUDIO, "items", it["id"] + ".m4a")
                manifest["items"][it["id"]] = build(out, f"{ENGINE}|{lang}|{t}", lambda: silence(0.15) + speak(lang, t) + silence(0.3))

        # 2) 학습 트랙: 한국어 뜻 → 외국어 → 한 번 더 → (따라 말하기) → 한 번 더 (모두 보통 속도)
        def learn():
            pcm = speak("ko", f"{L['day']}일차. 오늘의 주제는 {L['topic']}입니다.") + silence(1.2)
            for lang, items in groups:
                pcm += speak("ko", LANG_NAMES[lang]) + silence(0.9)
                for it in items:
                    t = plain(it)
                    pcm += speak("ko", it["ko"]) + silence(0.7)
                    pcm += speak(lang, t) + silence(0.9)
                    pcm += speak(lang, t) + silence(3.0)  # 2번째도 보통 속도 (사용자 요청)
                    pcm += speak(lang, t) + silence(1.5)
            return pcm + speak("ko", "학습 트랙 끝.") + silence(1.0)

        # 3) 말하기 퀴즈 트랙: 한국어 → (먼저 말해보기) → 정답
        def quiz():
            pcm = speak("ko", f"{L['day']}일차 말하기 퀴즈. 한국어를 듣고 먼저 말해 보세요.") + silence(1.2)
            for lang, items in groups:
                pcm += speak("ko", LANG_NAMES[lang]) + silence(0.8)
                for it in items:
                    t = plain(it)
                    pcm += speak("ko", it["ko"])
                    pcm += silence(min(7.0, 3.0 + len(t) * (0.12 if lang == "ja" else 0.06)))
                    pcm += speak(lang, t) + silence(2.0)
            return pcm + speak("ko", "퀴즈 끝.") + silence(1.0)

        sig = json.dumps([L["day"], L["topic"], [[plain(i), i["ko"]] for _, its in groups for i in its]], ensure_ascii=False)
        for kind, fn in (("learn", learn), ("quiz", quiz)):
            out = os.path.join(AUDIO, f"{L['id']}-{kind}.m4a")
            manifest["tracks"][f"{L['id']}-{kind}"] = build(out, f"{ENGINE}|{kind}|noslow|{sig}", fn)
            print(f"{L['id']}-{kind}: {manifest['tracks'][L['id'] + '-' + kind]}s")

    json.dump(manifest, open(os.path.join(AUDIO, "manifest.json"), "w"), indent=1)
    print("완료:", len(manifest["items"]), "클립,", len(manifest["tracks"]), "트랙")


if __name__ == "__main__":
    main()
