#!/usr/bin/env python3
"""매일 아침 ntfy 알림: 오늘의 주제 + 언어별 한 문장 미리보기.
GitHub Actions 가 실행합니다. 환경변수 NTFY_TOPIC 필요.
"""
import datetime, json, os, re, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_URL = "https://jeongjwng-hub.github.io/lang3/#today"
START = datetime.date(2026, 11, 22)  # 1일차


def plain(it):
    return re.sub(r"\{([^|}]+)\|[^}]+\}", r"\1", it["ruby"]) if "ruby" in it else it["text"]


def main():
    lessons = json.load(open(os.path.join(ROOT, "data", "lessons.json"), encoding="utf-8"))["lessons"]
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date()
    n = (today - START).days
    L = lessons[n % len(lessons)]
    pick = lambda lang: L[lang]["items"][n // len(lessons) % len(L[lang]["items"])]
    ja, en, fr = pick("ja"), pick("en"), pick("fr")
    msg = (f"🇯🇵 {plain(ja)}\n   {ja['ko']}\n"
           f"🇬🇧 {en['text']}\n   {en['ko']}\n"
           f"🇫🇷 {fr['text']}\n   {fr['ko']}\n\n"
           "탭해서 오늘 공부 시작 → 출근길엔 🚗 드라이브 모드")
    body = {
        "topic": os.environ["NTFY_TOPIC"],
        "title": f"☀️ 하루 세 언어 · {L['emoji']} {L['topic']}",
        "message": msg,
        "click": APP_URL,
        "actions": [{"action": "view", "label": "앱 열기", "url": APP_URL}],
    }
    req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        print("sent", r.status, L["id"])


if __name__ == "__main__":
    main()
