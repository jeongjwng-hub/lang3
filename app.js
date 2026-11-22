/* 하루 세 언어 — 일본어 · 영어 · 프랑스어 데일리 학습 */
(() => {
  const LANGS = [
    { key: "ja", name: "일본어", flag: "🇯🇵" },
    { key: "en", name: "영어", flag: "🇬🇧" },
    { key: "fr", name: "프랑스어", flag: "🇫🇷" },
  ];
  const LNAME = Object.fromEntries(LANGS.map(l => [l.key, l]));
  const INTERVALS = [1, 3, 7, 14, 30]; // 복습 간격(일)
  const AUDIO_CACHE = "lang3-audio-v3"; // 음성을 새로 만들면 숫자 올리기
  try { caches.keys().then(ks => ks.filter(k => k.startsWith("lang3-audio") && k !== AUDIO_CACHE).forEach(k => caches.delete(k))); } catch (e) {}
  const $ = s => document.querySelector(s);
  const view = $("#view");

  // ---------- 저장 ----------
  const KEY = "lang3-state";
  let S = { done: {}, rev: {}, notes: {}, furi: true };
  try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

  const today = () => ymd(new Date());
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }

  // ---------- 데이터 ----------
  let LESSONS = [], MAN = { items: {}, tracks: {} };
  const byId = id => LESSONS.find(l => l.id === id);
  const allItems = () => LESSONS.flatMap(L => LANGS.flatMap(({ key }) => L[key].items.map(it => ({ ...it, lang: key, lesson: L }))));

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ruby = s => esc(s).replace(/\{([^|}]+)\|([^}]+)\}/g, "<ruby>$1<rt>$2</rt></ruby>");
  const plain = it => it.ruby ? it.ruby.replace(/\{([^|}]+)\|[^}]+\}/g, "$1") : it.text;
  const shown = it => it.ruby ? ruby(it.ruby) : esc(it.text);
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // 지금 공부할 주제: 오늘 끝낸 주제가 있으면 그것, 아니면 아직 안 한 첫 주제
  function todayState() {
    const doneToday = LESSONS.filter(L => S.done[L.id] === today());
    const next = LESSONS.find(L => !S.done[L.id]);
    return { doneToday, next };
  }
  function dueLessons() {
    return LESSONS.filter(L => {
      if (!S.done[L.id]) return false;
      const r = S.rev[L.id] || { stage: 0, last: S.done[L.id] };
      if (r.stage >= INTERVALS.length) return false;
      return daysBetween(r.last, today()) >= INTERVALS[r.stage];
    });
  }
  function streak() {
    const days = new Set(Object.values(S.done));
    Object.values(S.rev).forEach(r => r.last && days.add(r.last));
    let n = 0, d = new Date();
    if (!days.has(ymd(d))) d.setDate(d.getDate() - 1);
    while (days.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // ---------- 오디오 (캐시 → blob, 오프라인 재생 가능) ----------
  async function audioURL(path) {
    try {
      const c = await caches.open(AUDIO_CACHE);
      let r = await c.match(path);
      if (!r) { r = await fetch(path); if (!r.ok) throw 0; await c.put(path, r.clone()); }
      return URL.createObjectURL(await r.blob());
    } catch (e) { return path; }
  }
  const clip = new Audio();
  let clipBtn = null;
  async function playClip(id, slow, btn) {
    if (player.audio && !player.audio.paused) player.audio.pause();
    clipBtn && clipBtn.classList.remove("busy");
    clipBtn = btn; btn && btn.classList.add("busy");
    clip.src = await audioURL(`audio/items/${id}.m4a`);
    clip.playbackRate = slow ? 0.75 : 1;
    clip.onended = () => btn && btn.classList.remove("busy");
    clip.play().catch(() => btn && btn.classList.remove("busy"));
  }

  // ---------- 화면: 학습 ----------
  function itemHTML(it, lang, hideKo) {
    const kanji = (it.kanji || []).map(([k, ko, r]) => `<span><b>${esc(k)}</b> ${esc(ko)} → ${esc(r)}</span>`).join("");
    return `<div class="item">
      <div class="tx" lang="${lang}">${shown(it)}</div>
      <div class="ko ${hideKo ? "hid" : ""}">${esc(it.ko)}</div>
      <div class="play"><button data-clip="${it.id}">🔊 듣기</button><button data-clip="${it.id}" data-slow="1">🐢 천천히</button></div>
      ${it.simple ? `<div class="simple">쉬운 말 <s lang="${lang}">${esc(it.simple)}</s> → <b>업그레이드!</b></div>` : ""}
      <div class="note">${esc(it.note)}</div>
      ${kanji ? `<div class="kanji">${kanji}</div>` : ""}
    </div>`;
  }
  function verbHTML(v) {
    if (!v) return "";
    return `<div class="verb"><div class="vt">오늘의 동사 · ${esc(v.dict)} ${v.reading ? `(${esc(v.reading)})` : ""} <span>${esc(v.ko)}</span></div>
      <div class="forms">${v.forms.map(([a, b]) => `<div><em>${esc(a)}</em>${esc(b)}</div>`).join("")}</div></div>`;
  }
  function langHTML(L, key, hideKo) {
    const d = L[key], l = LNAME[key];
    const nk = `${L.id}-${key}`;
    return `<section class="lang ${key}">
      <div class="head">${l.flag} ${l.name}<small>${d.items.length}개 표현</small></div>
      <div class="body">
        <div class="grammar"><b>${esc(d.grammar.title)}</b><p>${esc(d.grammar.desc)}</p></div>
        ${verbHTML(d.verb)}
        ${d.items.map(it => itemHTML(it, key, hideKo)).join("")}
        <div class="task"><label>✍️ ${esc(d.task)}</label>
          <textarea data-note="${nk}" lang="${key}" placeholder="여기에 써 보세요 (자동 저장)">${esc(S.notes[nk] || "")}</textarea></div>
      </div></section>`;
  }
  function makeQuiz(L) {
    const pool = allItems();
    return LANGS.map(({ key }) => {
      const ans = shuffle(L[key].items)[0];
      const others = shuffle(pool.filter(x => x.lang === key && x.id !== ans.id)).slice(0, 3);
      return { lang: key, ans, opts: shuffle([ans, ...others]) };
    });
  }
  let hideKo = false;
  function renderLesson(L, opts = {}) {
    const isDone = !!S.done[L.id];
    const quiz = makeQuiz(L);
    view.innerHTML = `
      ${opts.banner || ""}
      <div class="hero">
        <div class="day">${L.day}일차 · 오늘의 주제</div>
        <h2>${L.emoji} ${esc(L.topic)}</h2>
        <p>${esc(L.intro)}</p>
        <div class="play" style="margin-top:12px"><button id="hideko">${hideKo ? "🙈 뜻 보이기" : "🙈 뜻 가리기"}</button></div>
      </div>
      ${LANGS.map(({ key }) => langHTML(L, key, hideKo)).join("")}
      <h3>🎯 확인 퀴즈</h3>
      <div class="quiz">${quiz.map((q, i) => `<div class="q" data-q="${i}">
          <div class="qk"><small>${LNAME[q.lang].flag} ${LNAME[q.lang].name}로 알맞은 것은?</small>${esc(q.ans.ko)}</div>
          ${q.opts.map(o => `<button class="opt" lang="${q.lang}" data-ok="${o.id === q.ans.id ? 1 : 0}">${shown(o)}</button>`).join("")}
        </div>`).join("")}</div>
      <button class="btn" id="finish" ${isDone ? "" : "disabled"}>${isDone ? "✅ 완료한 주제예요" : "퀴즈를 모두 풀면 완료할 수 있어요"}</button>
      ${opts.footer || ""}`;
    let answered = 0;
    view.querySelectorAll(".q").forEach(q => q.addEventListener("click", e => {
      const b = e.target.closest(".opt"); if (!b || q.dataset.done) return;
      q.dataset.done = 1;
      q.querySelectorAll(".opt").forEach(o => o.dataset.ok === "1" && o.classList.add("right"));
      if (b.dataset.ok !== "1") b.classList.add("wrong");
      const qq = quiz[+q.dataset.q]; playClip(qq.ans.id, false);
      if (++answered === quiz.length && !isDone) {
        const f = $("#finish"); f.disabled = false; f.textContent = "🎉 오늘 학습 완료!";
      }
    }));
    $("#finish").onclick = () => {
      if (S.done[L.id]) return;
      S.done[L.id] = today(); S.rev[L.id] = { stage: 0, last: today() }; save();
      location.hash = "#today"; render(); window.scrollTo(0, 0);
    };
    $("#hideko").onclick = () => { hideKo = !hideKo; renderLesson(L, opts); };
  }

  function renderToday() {
    const { doneToday, next } = todayState();
    if (!doneToday.length && next) return renderLesson(next);
    const last = doneToday[doneToday.length - 1];
    const due = dueLessons().length;
    view.innerHTML = `
      <div class="done-banner"><div class="big">🎉</div>
        <h2 style="margin:6px 0">${last ? `오늘의 학습 완료!` : "준비된 주제를 모두 끝냈어요"}</h2>
        <p class="muted">연속 학습 ${streak()}일째${last ? ` · ${esc(last.emoji + " " + last.topic)}` : ""}</p></div>
      <a class="btn" href="#drive">🚗 출근길에 오늘 표현 듣기</a>
      ${due ? `<a class="btn ghost" href="#review">🔁 복습할 주제 ${due}개</a>` : ""}
      ${next ? `<a class="btn ghost" href="#lesson/${next.id}">📖 더 공부하기 · ${next.day}일차 ${esc(next.topic)}</a>` : `<p class="muted" style="text-align:center">다음 주제가 곧 추가될 거예요.</p>`}
      ${last ? `<a class="btn ghost" href="#lesson/${last.id}">오늘 배운 내용 다시 보기</a>` : ""}`;
  }

  // ---------- 화면: 복습 (플래시카드) ----------
  let session = null;
  function renderReview() {
    if (session) return renderCard();
    const due = dueLessons();
    const learned = LESSONS.filter(L => S.done[L.id]);
    view.innerHTML = `
      <div class="card"><h3>🔁 간격 복습</h3>
        <p class="muted">배운 주제를 1일 → 3일 → 7일 → 14일 → 30일 뒤에 다시 보여줘요. 잊어버릴 때쯤 복습하면 오래 기억에 남아요.</p></div>
      ${due.length ? `<button class="btn" id="startDue">오늘 복습 시작 · ${due.length}개 주제 (${due.reduce((n, L) => n + LANGS.reduce((m, { key }) => m + L[key].items.length, 0), 0)}개 표현)</button>`
        : `<p class="muted" style="text-align:center">오늘 복습할 주제가 없어요 👍</p>`}
      ${learned.length ? `<button class="btn ghost" id="startAll">배운 표현 전체 자유 복습</button>` : ""}
      <div class="list" style="margin-top:12px">${learned.map(L => {
        const r = S.rev[L.id] || { stage: 0, last: S.done[L.id] };
        const isDue = due.includes(L);
        const nextIn = r.stage >= INTERVALS.length ? null : INTERVALS[r.stage] - daysBetween(r.last, today());
        return `<a class="row" href="#lesson/${L.id}"><span class="em">${L.emoji}</span><span class="grow">${L.day}일차 ${esc(L.topic)}<small>복습 ${r.stage}단계</small></span>
          <span class="badge ${isDue ? "due" : "ok"}">${isDue ? "복습할 때" : nextIn == null ? "졸업 🎓" : `${nextIn}일 뒤`}</span></a>`;
      }).join("") || `<p class="muted" style="text-align:center">아직 배운 주제가 없어요. 오늘 탭에서 시작해 보세요.</p>`}</div>`;
    const start = (lessons, scored) => {
      const cards = shuffle(lessons.flatMap(L => LANGS.flatMap(({ key }) => L[key].items.map(it => ({ ...it, lang: key, lid: L.id })))));
      session = { cards, i: 0, shown: false, wrong: new Set(), lessons: lessons.map(L => L.id), scored };
      renderCard();
    };
    $("#startDue") && ($("#startDue").onclick = () => start(due, true));
    $("#startAll") && ($("#startAll").onclick = () => start(learned, false));
  }
  function renderCard() {
    const s = session, c = s.cards[s.i];
    if (!c) return finishReview();
    view.innerHTML = `
      <p class="muted">${s.i + 1} / ${s.cards.length}</p>
      <div class="bar" style="margin-bottom:14px"><i style="width:${(s.i / s.cards.length) * 100}%"></i></div>
      <div class="card flash">
        <div><span class="tag ${c.lang}">${LNAME[c.lang].flag} ${LNAME[c.lang].name}</span></div>
        <div class="ko" style="margin-top:12px">${esc(c.ko)}</div>
        ${s.shown ? `<div class="ans" lang="${c.lang}">${shown(c)}</div>
          <div class="play" style="justify-content:center"><button data-clip="${c.id}">🔊 다시 듣기</button></div>` : `<p class="muted">소리 내서 먼저 말해 보세요</p>`}
      </div>
      ${s.shown ? `<div class="row2"><button class="btn ghost" id="bad">😅 헷갈려요</button><button class="btn" id="good">😊 알았어요</button></div>`
        : `<button class="btn" id="show">정답 보기</button>`}
      <button class="btn ghost" id="quit">그만하기</button>`;
    if (s.shown) {
      playClip(c.id, false);
      $("#good").onclick = () => { s.i++; s.shown = false; renderCard(); };
      $("#bad").onclick = () => { s.wrong.add(c.lid); s.cards.push({ ...c }); s.i++; s.shown = false; renderCard(); };
    } else $("#show").onclick = () => { s.shown = true; renderCard(); };
    $("#quit").onclick = () => { session = null; renderReview(); };
  }
  function finishReview() {
    const s = session; session = null;
    if (s.scored) s.lessons.forEach(id => {
      const r = S.rev[id] || { stage: 0 };
      S.rev[id] = { stage: s.wrong.has(id) ? r.stage : r.stage + 1, last: today() };
    });
    save();
    view.innerHTML = `<div class="done-banner"><div class="big">💪</div><h2 style="margin:6px 0">복습 끝!</h2>
      <p class="muted">${s.wrong.size ? "헷갈린 주제는 같은 간격으로 다시 나와요." : "모두 기억했어요. 다음 복습은 더 나중에 나와요."}</p></div>
      <a class="btn" href="#today">오늘 화면으로</a>`;
  }

  // ---------- 화면: 드라이브 모드 ----------
  const player = { audio: null, list: [], i: 0, mode: null };
  const MODES = {
    am: { label: "출근", min: 30, desc: "운전 20분 + 도보 10분" },
    pm: { label: "퇴근", min: 40, desc: "도보 10분 + 운전 30분" },
    today: { label: "오늘 것만", min: 0, desc: "학습 + 퀴즈 약 5분" },
    all: { label: "전체 퀴즈", min: 0, desc: "배운 주제 말하기 퀴즈" },
  };
  function focusLesson() {
    const { doneToday, next } = todayState();
    return doneToday[doneToday.length - 1] || next || LESSONS[LESSONS.length - 1];
  }
  function buildPlaylist(mode) {
    const cur = focusLesson();
    const learned = LESSONS.filter(L => S.done[L.id] && L.id !== cur.id).reverse();
    const t = (L, k) => ({ id: `${L.id}-${k}`, title: `${L.emoji} ${L.day}일차 ${L.topic}`, kind: k === "learn" ? "학습" : "말하기 퀴즈", dur: MAN.tracks[`${L.id}-${k}`] || 0 });
    let base;
    if (mode === "today") return [t(cur, "learn"), t(cur, "quiz")];
    if (mode === "all") return [cur, ...learned].map(L => t(L, "quiz"));
    const nxt = LESSONS.find(L => !S.done[L.id] && L.id !== cur.id);
    const preview = nxt ? [{ ...t(nxt, "learn"), kind: "내일 주제 미리 듣기" }] : [];
    if (mode === "am") base = [t(cur, "learn"), t(cur, "quiz"), ...learned.map(L => t(L, "quiz")), ...preview];
    else base = [t(cur, "quiz"), ...dueLessons().filter(L => L.id !== cur.id).map(L => t(L, "learn")), t(cur, "learn"), ...learned.map(L => t(L, "quiz"))];
    const target = MODES[mode].min * 60, list = [];
    let total = 0, k = 0;
    while (total < target && k < 200) { const x = base[k % base.length]; list.push(x); total += x.dur; k++; }
    return list;
  }
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  async function loadTrack(i, autoplay) {
    player.i = i;
    const tr = player.list[i];
    if (!tr) { stopDrive(); return; }
    if (!player.audio) {
      player.audio = new Audio();
      player.audio.addEventListener("ended", () => loadTrack(player.i + 1, true));
      player.audio.addEventListener("timeupdate", updatePlayerUI);
      player.audio.addEventListener("play", updatePlayerUI);
      player.audio.addEventListener("pause", updatePlayerUI);
    }
    player.audio.src = await audioURL(`audio/${tr.id}.m4a`);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: `${tr.title} · ${tr.kind}`, artist: "하루 세 언어", album: `${MODES[player.mode].label} 플레이리스트`, artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }] });
    }
    if (autoplay) player.audio.play().catch(() => {});
    const nx = player.list[i + 1]; if (nx) audioURL(`audio/${nx.id}.m4a`).then(u => u.startsWith("blob:") && URL.revokeObjectURL(u));
    updatePlayerUI();
  }
  // 10초 앞/뒤: 트랙 끝을 넘으면 다음 트랙으로
  function seek(sec) {
    const a = player.audio; if (!a || !player.list.length) return;
    const t = a.currentTime + sec;
    if (a.duration && t >= a.duration - 0.3) return loadTrack(player.i + 1, true);
    a.currentTime = Math.max(0, t);
    updatePlayerUI();
  }
  function stopDrive() { if (player.audio) player.audio.pause(); player.mode = null; player.list = []; if (location.hash === "#drive") renderDrive(); }
  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => player.audio && player.audio.play());
    ms.setActionHandler("pause", () => player.audio && player.audio.pause());
    ms.setActionHandler("nexttrack", () => player.list.length && loadTrack(Math.min(player.i + 1, player.list.length - 1), true));
    ms.setActionHandler("previoustrack", () => player.list.length && loadTrack(Math.max(player.i - 1, 0), true));
    try {
      ms.setActionHandler("seekbackward", d => seek(-((d && d.seekOffset) || 10)));
      ms.setActionHandler("seekforward", d => seek((d && d.seekOffset) || 10));
    } catch (e) {}
  }
  function updatePlayerUI() {
    if (location.hash !== "#drive" || !player.mode) return;
    const a = player.audio, tr = player.list[player.i];
    const now = $("#now"); if (!now || !tr) return;
    now.textContent = `${tr.title}`;
    $("#kind").textContent = `${tr.kind} · ${player.i + 1}/${player.list.length}`;
    $("#pp").textContent = a && !a.paused ? "⏸" : "▶";
    const left = player.list.slice(player.i).reduce((n, x) => n + x.dur, 0) - (a ? a.currentTime : 0);
    $("#left").textContent = `남은 시간 약 ${Math.max(1, Math.round(left / 60))}분`;
    $("#prog").style.width = a && a.duration ? `${(a.currentTime / a.duration) * 100}%` : "0";
    view.querySelectorAll(".tracks div").forEach((d, j) => d.classList.toggle("cur", j === player.i));
  }
  function renderDrive() {
    const cur = focusLesson();
    view.innerHTML = `
      <div class="card"><h3>🚗 듣기</h3>
        <p class="muted">화면을 꺼도 계속 재생돼요. 한국어 뜻 → 외국어 2번 → <b>따라 말하기</b> → 한 번 더 순서예요. 퀴즈는 한국어를 듣고 먼저 말한 뒤 정답을 들어요.</p></div>
      <div class="modes">${Object.entries(MODES).map(([k, m]) => `<button data-mode="${k}" class="${player.mode === k ? "on" : ""}"><b>${m.label}${m.min ? ` ${m.min}분` : ""}</b><small>${m.desc}</small></button>`).join("")}</div>
      ${player.mode ? `<div class="card player">
          <div class="muted" id="kind"></div><div class="now" id="now"></div>
          <div class="bar"><i id="prog"></i></div>
          <div class="ctrl"><button id="prev" aria-label="이전 트랙">⏮</button><button id="back10" class="sk" aria-label="10초 뒤로">−10<small>초</small></button><button id="pp" class="main" aria-label="재생/일시정지">▶</button><button id="fwd10" class="sk" aria-label="10초 앞으로">+10<small>초</small></button><button id="next" aria-label="다음 트랙">⏭</button></div>
          <p class="muted" id="left" style="text-align:center;margin:0"></p></div>
        <div class="tracks">${player.list.map(t => `<div><span>${esc(t.title)} · ${t.kind}</span><span>${fmt(t.dur)}</span></div>`).join("")}</div>`
        : `<p class="muted">지금 기준 주제: ${cur.emoji} ${cur.day}일차 ${esc(cur.topic)}. 배운 주제가 늘어날수록 플레이리스트에 복습이 더 많이 섞여요.</p>`}
      <button class="btn ghost" id="offline">📥 오디오 전부 미리 저장 (터널·지하 대비)</button>`;
    view.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
      player.mode = b.dataset.mode; player.list = buildPlaylist(player.mode);
      renderDrive(); loadTrack(0, true);
    });
    if (player.mode) {
      $("#pp").onclick = () => player.audio.paused ? player.audio.play() : player.audio.pause();
      $("#prev").onclick = () => loadTrack(Math.max(player.i - 1, 0), true);
      $("#next").onclick = () => loadTrack(player.i + 1, true);
      $("#back10").onclick = () => seek(-10);
      $("#fwd10").onclick = () => seek(10);
      updatePlayerUI();
    }
    $("#offline").onclick = async e => {
      const b = e.target; b.disabled = true;
      const paths = [...Object.keys(MAN.tracks).map(t => `audio/${t}.m4a`), ...Object.keys(MAN.items).map(t => `audio/items/${t}.m4a`)];
      try {
        const c = await caches.open(AUDIO_CACHE);
        let n = 0;
        for (const p of paths) { if (!(await c.match(p))) await c.add(p); b.textContent = `저장 중… ${++n}/${paths.length}`; }
        b.textContent = "✅ 오디오 저장 완료 (인터넷 없이도 재생돼요)";
      } catch (err) { b.disabled = false; b.textContent = "저장 실패 — 인터넷 연결을 확인하고 다시 눌러 주세요"; }
    };
  }

  // ---------- 화면: 전체 ----------
  function renderMore() {
    const n = Object.keys(S.done).length;
    view.innerHTML = `
      <div class="card"><h3>📚 전체 주제</h3><p class="muted">완료 ${n} / ${LESSONS.length} · 연속 학습 ${streak()}일째</p>
        <p class="muted">여유 있는 날은 다음 주제를 미리 공부해도 돼요. 비중은 일본어 40 · 영어 30 · 프랑스어 30이에요.</p></div>
      <div class="list">${LESSONS.map(L => `<a class="row" href="#lesson/${L.id}"><span class="em">${L.emoji}</span>
        <span class="grow">${L.day}일차 ${esc(L.topic)}<small>${esc(L.ja.grammar.title)} · ${esc(L.en.grammar.title)} · ${esc(L.fr.grammar.title)}</small></span>
        <span class="badge ${S.done[L.id] ? "ok" : ""}">${S.done[L.id] ? "완료" : "예정"}</span></a>`).join("")}</div>
      <div class="card"><h3>⏰ 아침 알림</h3><p class="muted">평일 오전 5:30, 주말 오전 8:00쯤 ntfy 앱으로 오늘의 주제와 미리보기 문장이 와요. 알림을 누르면 이 앱이 열려요.</p></div>`;
  }

  // ---------- 화면: 타블로 영상 표현 (Gemini 분석 → data/tablo.json) ----------
  let TABLO = { videos: [] };
  let tbHideKo = true; // Tablo 화면은 처음부터 뜻을 가려요
  if (!S.tb) S.tb = {};
  if (!S.tbStar) S.tbStar = {}; // 대사 보기에서 ⭐ 누른 줄 (카드로 외우기)
  const DET = {}; // 영상별 대사 한 줄씩 분석 (data/tablo/<id>.json, 필요할 때 불러와요)
  const tbVideo = id => TABLO.videos.find(v => v.id === id) || { id, title: "", expressions: [] };
  const tbAll = () => [...TABLO.videos.flatMap(v => v.expressions.map(x => ({ ...x, video: v }))),
    ...Object.values(S.tbStar).map(x => ({ ...x, video: tbVideo(x.vid) }))];
  const tbDue = () => tbAll().filter(x => {
    const r = S.tb[x.id]; if (!r) return false;
    return r.stage < INTERVALS.length && daysBetween(r.last, today()) >= INTERVALS[r.stage];
  });
  const tbNew = () => tbAll().filter(x => !S.tb[x.id]);
  const mark = (q, p) => {
    const i = q.toLowerCase().indexOf(p.toLowerCase());
    return i < 0 ? esc(q) : esc(q.slice(0, i)) + `<mark>${esc(q.slice(i, i + p.length))}</mark>` + esc(q.slice(i + p.length));
  };
  const ytAt = x => `https://www.youtube.com/watch?v=${x.video.id}${x.sec ? `&t=${x.sec}s` : ""}`;
  function speak(text, btn) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = btn && btn.dataset.slow ? 0.75 : 1;
    const v = speechSynthesis.getVoices().find(v => /^en[-_]US/.test(v.lang) && /natural|neural|samantha|google/i.test(v.name)); if (v) u.voice = v;
    btn && btn.classList.add("busy"); u.onend = () => btn && btn.classList.remove("busy");
    speechSynthesis.speak(u);
  }
  function tbExpHTML(x) {
    const st = S.tb[x.id];
    return `<div class="item">
      <div class="phrase">${esc(x.phrase)} <span class="badge">${esc(x.level)}</span>${st ? ` <span class="badge ok">복습 ${st.stage}단계</span>` : ""}</div>
      <div class="tx" lang="en">“${mark(x.quote, x.phrase)}”</div>
      <div class="ko ${tbHideKo ? "hid" : ""}">${esc(x.ko)}</div>
      <div class="play"><button data-say="${esc(x.quote)}">🔊 듣기</button><button data-say="${esc(x.quote)}" data-slow="1">🐢 천천히</button>
        <a class="pill" href="${ytAt(x)}" target="_blank" rel="noopener">▶ 영상${x.time ? ` ${esc(x.time)}` : ""}</a></div>
      <div class="note">${esc(x.meaning)}</div>
      <div class="simple">예문 <b lang="en">${esc(x.example)}</b> <button class="mini" data-say="${esc(x.example)}">🔊</button><br>${esc(x.example_ko)}</div>
    </div>`;
  }
  const fmtT = s => s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const lineId = (vid, l) => `tl-${vid}-${l.sec}-${l.text.length}`;
  const spkClass = sp => "sp" + ([...sp].reduce((n, c) => n + c.charCodeAt(0), 0) % 4);
  function markNotes(text, notes) {
    let h = esc(text);
    notes.forEach(n => { const p = esc(n.phrase); const i = h.toLowerCase().indexOf(p.toLowerCase()); if (p && i >= 0) h = h.slice(0, i) + `<mark>${h.slice(i, i + p.length)}</mark>` + h.slice(i + p.length); });
    return h;
  }
  if (!S.tbMark) S.tbMark = {}; // 영상별 책갈피 { vid: { lineId: { time, sec, text, memo } } }
  if (!S.tbPos) S.tbPos = {};   // 영상별 마지막으로 보던 대사 lineId
  const tbOpen = {};            // 영상별 펼친 챕터 번호 (Set)
  let tbPanel = null;           // "chap" | "mark" | null
  // 챕터: 유튜브 챕터가 있으면 그것, 없으면 5분 구간
  function chaptersOf(d) {
    const end = Math.max(d.done_sec || 0, ...d.lines.map(l => l.sec + 1));
    const yt = ((d.chapters || []).length ? d.chapters : d.ai_chapters || []).filter(c => c.sec < end);
    const base = yt.length ? yt.map(c => ({ sec: c.sec, title: c.title }))
      : (d.sections || []).map(x => ({ sec: x.start, title: x.summary, range: true }));
    if (!base.length) base.push({ sec: 0, title: "전체" });
    if (base[0].sec > 0) base.unshift({ sec: 0, title: "시작" });
    return base.map((c, i) => ({ ...c, end: i + 1 < base.length ? base[i + 1].sec : end }));
  }
  const chapIndex = (chs, sec) => { let k = 0; chs.forEach((c, i) => { if (sec >= c.sec) k = i; }); return k; };
  function lineHTML(v, l, i, marks) {
    const id = lineId(v.id, l), star = !!S.tbStar[id], mk = marks[id];
    return `<div class="line ${l.lang} ${mk ? "marked" : ""}" id="L${i}" data-lid="${esc(id)}">
      <div class="lh"><a class="t" href="https://www.youtube.com/watch?v=${v.id}&t=${l.sec}s" target="_blank" rel="noopener">${esc(l.time)}</a>
        <span class="spk ${spkClass(l.speaker)}">${esc(l.speaker)}</span>
        <span class="acts">${l.lang === "en" ? `<button class="mini" data-say="${esc(l.text)}">🔊</button><button class="mini star ${star ? "on" : ""}" data-star="${esc(id)}" title="카드 학습에 추가">${star ? "⭐" : "☆"}</button>` : ""}
        <button class="mini mk ${mk ? "on" : ""}" data-mark="${i}" title="책갈피">${mk ? "🔖" : "🏷️"}</button></span></div>
      <div class="lt" lang="${l.lang}">${markNotes(l.text, l.notes)}</div>
      <div class="ko ${tbHideKo ? "hid" : ""}">${esc(l.tr)}</div>
      ${l.notes.length ? `<div class="lnotes">${l.notes.map(n => `<div><b>${esc(n.phrase)}</b> ${esc(n.meaning)}</div>`).join("")}</div>` : ""}
      ${mk && mk.memo ? `<div class="memo">📝 ${esc(mk.memo)}</div>` : ""}
    </div>`;
  }
  function detailHTML(v, d) {
    const prog = v.detail || {};
    const head = `<div class="head">📜 대사 한 줄씩<small>${d ? `${d.lines.length}줄` : ""}${prog.status !== "done" && prog.duration ? ` · 분석 ${fmtT(prog.done_sec)} / ${fmtT(prog.duration)}` : prog.status === "queued" ? " · 분석 대기 중" : prog.status !== "done" ? ` · ${fmtT(prog.done_sec || 0)}까지 분석` : ""}</small></div>`;
    if (!d) return `<section class="lang en script">${head}<div class="body"><p class="muted">${prog.status === "queued" ? "곧 분석을 시작해요. 5분 구간씩 차례로 채워져요." : "불러오는 중…"}</p></div></section>`;
    const chs = chaptersOf(d), marks = S.tbMark[v.id] || {};
    const idx = Object.fromEntries(d.lines.map((l, i) => [lineId(v.id, l), i]));
    const pos = idx[S.tbPos[v.id]];
    if (!tbOpen[v.id]) tbOpen[v.id] = new Set([pos != null ? chapIndex(chs, d.lines[pos].sec) : 0]);
    const open = tbOpen[v.id];
    const byChap = chs.map(() => []);
    d.lines.forEach((l, i) => byChap[chapIndex(chs, l.sec)].push(i));
    const ytChap = !!((d.chapters || []).length || (d.ai_chapters || []).length), secs = d.sections || [];
    const markList = Object.entries(marks).filter(([id]) => idx[id] != null).sort((a, b) => idx[a[0]] - idx[b[0]]);
    const panel = tbPanel === "chap" ? `<div class="sheet">${chs.map((c, k) => `<button data-jump-chap="${k}"><span class="t">${fmtT(c.sec)}</span><span class="grow">${esc(c.range ? `${fmtT(c.sec)}~${fmtT(c.end)} · ${c.title}` : c.title)}</span><small>${byChap[k].length}줄</small></button>`).join("")}</div>`
      : tbPanel === "mark" ? `<div class="sheet">${markList.length ? markList.map(([id, m]) => `<div class="mrow"><button data-jump="${idx[id]}"><span class="t">${esc(m.time)}</span><span class="grow">${esc(m.text)}</span></button>
          <input data-memo="${esc(id)}" placeholder="메모 (자동 저장)" value="${esc(m.memo || "")}"></div>`).join("")
          : `<p class="muted">대사 오른쪽의 🏷️를 누르면 책갈피가 생겨요.</p>`}</div>` : "";
    const body = chs.map((c, k) => {
      const ids = byChap[k], nMark = ids.filter(i => marks[lineId(v.id, d.lines[i])]).length;
      let inner = "";
      if (open.has(k)) {
        let si = 0;
        ids.forEach(i => {
          const l = d.lines[i];
          if (ytChap) while (si < secs.length && secs[si].start <= l.sec) { if (secs[si].start >= c.sec) inner += `<div class="sec">${fmtT(secs[si].start)}~ · ${esc(secs[si].summary)}</div>`; si++; }
          inner += lineHTML(v, l, i, marks);
        });
      }
      return `<details class="chap" data-chap="${k}" ${open.has(k) ? "open" : ""}>
        <summary><span class="t">${fmtT(c.sec)}</span><span class="grow">${esc(c.range ? `${fmtT(c.sec)}~${fmtT(c.end)}` : c.title)}${c.range ? `<small>${esc(c.title)}</small>` : ""}</span>
          <span class="cnt">${ids.length}줄${nMark ? ` · 🔖${nMark}` : ""}</span></summary>
        <div class="cbody">${inner}</div></details>`;
    }).join("");
    return `<section class="lang en script">${head}
      <div class="stick"><div class="sbar"><button data-panel="chap" class="${tbPanel === "chap" ? "on" : ""}">📑 챕터 ${chs.length}</button>
        <button data-panel="mark" class="${tbPanel === "mark" ? "on" : ""}">🔖 책갈피 ${markList.length}</button>
        ${pos != null ? `<button data-jump="${pos}">📍 이어 보기 ${esc(d.lines[pos].time)}</button>` : ""}
        <button data-fold="1">접기</button></div>${panel}</div>
      <div class="body"><p class="muted">챕터를 눌러 펼치세요. 🏷️ 책갈피 · ☆ 카드 학습 · 시각을 누르면 그 장면부터 재생돼요.</p>${body}
      ${prog.status !== "done" ? `<p class="muted" style="text-align:center">나머지 구간은 분석되는 대로 계속 채워져요.</p>` : ""}</div></section>`;
  }
  // 펼침 상태·스크롤을 유지한 채 다시 그리기
  function rerenderDetail(vid, jump) {
    const y = scrollY; renderTablo(vid);
    if (jump == null) return scrollTo(0, y);
    const el = document.getElementById("L" + jump);
    if (el) { el.scrollIntoView({ block: "start" }); el.classList.add("hl"); setTimeout(() => el.classList.remove("hl"), 1600); }
  }
  function jumpTo(vid, i) {
    const d = DET[vid]; if (!d || !d.lines[i]) return;
    const chs = chaptersOf(d); tbOpen[vid].add(chapIndex(chs, d.lines[i].sec)); tbPanel = null;
    rerenderDetail(vid, i);
  }
  let posTimer = 0;
  window.addEventListener("scroll", () => {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      const m = location.hash.match(/^#tablo\/(.+)/); if (!m) return;
      const first = [...document.querySelectorAll(".line")].find(el => el.getBoundingClientRect().top > 100);
      if (first && S.tbPos[m[1]] !== first.dataset.lid) { S.tbPos[m[1]] = first.dataset.lid; save(); }
    }, 600);
  }, { passive: true });
  function loadDetail(vid) {
    if (DET[vid] !== undefined) return;
    DET[vid] = null;
    fetch(`data/tablo/${vid}.json`, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).then(d => {
      if (!d) { delete DET[vid]; return; }
      DET[vid] = d;
      if (location.hash === `#tablo/${vid}`) { const y = scrollY; renderTablo(vid); scrollTo(0, y); }
    }).catch(() => { delete DET[vid]; });
  }
  function renderTablo(vid) {
    if (tbSession) return renderTbCard();
    if (vid) {
      const v = TABLO.videos.find(v => v.id === vid);
      if (v) {
        view.innerHTML = `<div class="hero"><div class="day">${v.date ? esc(v.date) + " · " : ""}@heytablo</div><h2>${esc(v.title)}</h2><p>${esc(v.summary)}</p>
          <div class="play" style="margin-top:12px"><a class="pill" href="${esc(v.url)}" target="_blank" rel="noopener">▶ 유튜브에서 보기</a><button id="hideko">${tbHideKo ? "🙈 뜻 보이기" : "🙈 뜻 가리기"}</button></div></div>
          ${v.expressions.length || !v.detail ? `<section class="lang en"><div class="head">🎬 이 영상의 표현<small>${v.expressions.length}개</small></div>
          <div class="body">${v.expressions.map(x => tbExpHTML({ ...x, video: v })).join("") || `<p class="muted">이 영상에서는 고를 만한 영어 표현이 없었어요.</p>`}</div></section>` : ""}
          ${v.detail ? detailHTML(v, DET[vid]) : ""}
          <a class="btn ghost" href="#tablo">← 영상 목록</a>`;
        $("#hideko").onclick = () => { tbHideKo = !tbHideKo; rerenderDetail(vid); };
        if (v.detail) loadDetail(vid);
        if (tbPanel && !DET[vid]) tbPanel = null;
        return;
      }
    }
    const due = tbDue().length, nw = tbNew().length, all = tbAll().length;
    view.innerHTML = `
      <div class="card"><h3>🎬 Tablo 영상 표현</h3>
        <p class="muted">@heytablo 새 영상을 Gemini가 매일 분석해서 실제로 쓰인 영어 표현을 골라 줘요. 카드로 외우면 1→3→7→14→30일 간격으로 다시 나와요.</p>
        <p class="muted">전체 ${all}개 · 새 표현 ${nw}개 · 오늘 복습 ${due}개</p></div>
      ${due || nw ? `<button class="btn" id="tbStart">카드 학습 시작 · 복습 ${due} + 새 표현 ${Math.min(nw, 10)}</button>` : all ? `<p class="muted" style="text-align:center">오늘 할 카드가 없어요 👍</p>` : ""}
      <div class="list">${TABLO.videos.map(v => `<a class="row" href="#tablo/${v.id}"><span class="em">🎬</span>
        <span class="grow">${esc(v.title || v.id)}<small>${v.detail ? `📜 대사 ${v.detail.lines}줄 · 표현 노트 ${v.detail.notes}개${v.detail.status === "done" ? "" : v.detail.duration ? ` · 분석 ${Math.round(v.detail.done_sec / v.detail.duration * 100)}%` : " · 분석 대기"}`
          : `${esc(v.date)} · 표현 ${v.expressions.length}개${v.expressions[0] ? ` · ${esc(v.expressions.slice(0, 2).map(x => x.phrase).join(", "))}…` : ""}`}</small></span>
        <span class="badge ${v.detail ? "" : v.expressions.every(x => S.tb[x.id]) && v.expressions.length ? "ok" : ""}">${v.detail ? (v.detail.status === "done" ? "완료" : "분석 중") : `${v.expressions.filter(x => S.tb[x.id]).length}/${v.expressions.length}`}</span></a>`).join("")
        || `<p class="muted" style="text-align:center">아직 분석한 영상이 없어요. 매일 분석이 돌면 여기에 나타나요.</p>`}</div>`;
    $("#tbStart") && ($("#tbStart").onclick = () => {
      tbSession = { cards: shuffle([...tbDue(), ...tbNew().slice(0, 10)]), i: 0, shown: false, wrong: new Set() };
      renderTbCard();
    });
  }
  let tbSession = null;
  function renderTbCard() {
    const s = tbSession, c = s.cards[s.i];
    if (!c) {
      tbSession = null;
      view.innerHTML = `<div class="done-banner"><div class="big">🎤</div><h2 style="margin:6px 0">카드 끝!</h2>
        <p class="muted">${s.wrong.size ? `헷갈린 ${s.wrong.size}개는 내일 다시 나와요.` : "모두 기억했어요. 다음 복습은 더 나중에 나와요."}</p></div>
        <a class="btn" href="#tablo">목록으로</a>`;
      return;
    }
    view.innerHTML = `
      <p class="muted">${s.i + 1} / ${s.cards.length}</p>
      <div class="bar" style="margin-bottom:14px"><i style="width:${(s.i / s.cards.length) * 100}%"></i></div>
      <div class="card flash">
        <div><span class="tag en">🎬 ${esc((c.video.title || "").slice(0, 30))}${c.speaker ? ` · ${esc(c.speaker)}` : ""}</span></div>
        <div class="ko" style="margin-top:12px">${esc(c.ko)}</div>
        ${c.meaning ? `<p class="muted">힌트: ${esc(c.meaning)}</p>` : ""}
        ${s.shown ? `<div class="ans" lang="en">“${mark(c.quote, c.phrase)}”</div>
          <div class="play" style="justify-content:center"><button data-say="${esc(c.quote)}">🔊 다시 듣기</button><a class="pill" href="${ytAt(c)}" target="_blank" rel="noopener">▶ 영상</a></div>
          ${c.example ? `<p class="muted" lang="en">${esc(c.example)}</p>` : ""}` : `<p class="muted">Tablo가 영어로 뭐라고 했을지 먼저 말해 보세요</p>`}
      </div>
      ${s.shown ? `<div class="row2"><button class="btn ghost" id="bad">😅 헷갈려요</button><button class="btn" id="good">😊 알았어요</button></div>`
        : `<button class="btn" id="show">정답 보기</button>`}
      <button class="btn ghost" id="quit">그만하기</button>`;
    const grade = ok => {
      const r = S.tb[c.id];
      S.tb[c.id] = { stage: ok ? (r ? r.stage + 1 : 1) : 0, last: today() }; save();
      if (!ok) { s.wrong.add(c.id); }
      s.i++; s.shown = false; renderTbCard();
    };
    if (s.shown) {
      speak(c.quote);
      $("#good").onclick = () => grade(true);
      $("#bad").onclick = () => grade(false);
    } else $("#show").onclick = () => { s.shown = true; renderTbCard(); };
    $("#quit").onclick = () => { tbSession = null; renderTablo(); };
  }

  // ---------- 라우팅 ----------
  function render() {
    const h = location.hash || "#today";
    const tab = h.startsWith("#lesson") ? "more" : h.startsWith("#tablo") ? "tablo" : h.slice(1);
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab || (h === "#today" && b.dataset.tab === "today")));
    if (h.startsWith("#lesson/")) {
      const L = byId(h.split("/")[1]);
      if (L) return renderLesson(L, { footer: `<a class="btn ghost" href="#today">← 오늘 화면으로</a>` });
    }
    if (h.startsWith("#tablo")) return renderTablo(h.split("/")[1]);
    if (h === "#review") return renderReview();
    if (h === "#drive") return renderDrive();
    if (h === "#more") return renderMore();
    return renderToday();
  }
  window.addEventListener("hashchange", () => { if (location.hash !== "#review") session = null; if (location.hash !== "#tablo") tbSession = null; render(); window.scrollTo(0, 0); });
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => { location.hash = "#" + b.dataset.tab; });

  view.addEventListener("click", e => {
    const b = e.target.closest("[data-clip]");
    if (b) playClip(b.dataset.clip, !!b.dataset.slow, b);
    const sb = e.target.closest("[data-say]"); if (sb) speak(sb.dataset.say, sb);
    const tm = location.hash.match(/^#tablo\/(.+)/), tvid = tm && tm[1];
    if (tvid && DET[tvid]) {
      const d = DET[tvid];
      const pn = e.target.closest("[data-panel]"); if (pn) { tbPanel = tbPanel === pn.dataset.panel ? null : pn.dataset.panel; return rerenderDetail(tvid); }
      const jc = e.target.closest("[data-jump-chap]");
      if (jc) { const k = +jc.dataset.jumpChap, chs = chaptersOf(d), i = d.lines.findIndex(l => chapIndex(chs, l.sec) === k); if (i >= 0) jumpTo(tvid, i); return; }
      const jp = e.target.closest("[data-jump]"); if (jp) return jumpTo(tvid, +jp.dataset.jump);
      if (e.target.closest("[data-fold]")) { tbOpen[tvid] = new Set(); tbPanel = null; return rerenderDetail(tvid); }
      const mb = e.target.closest("[data-mark]");
      if (mb) {
        const l = d.lines[+mb.dataset.mark], id = lineId(tvid, l), mk = S.tbMark[tvid] = S.tbMark[tvid] || {};
        if (mk[id]) { if (!mk[id].memo || confirm("메모가 있는 책갈피예요. 지울까요?")) delete mk[id]; }
        else mk[id] = { time: l.time, sec: l.sec, text: l.text, memo: "" };
        save(); return rerenderDetail(tvid);
      }
    }
    const st = e.target.closest("[data-star]");
    if (st) {
      const id = st.dataset.star, vid = location.hash.split("/")[1], d = DET[vid];
      const l = d && d.lines.find(l => lineId(vid, l) === id);
      if (S.tbStar[id]) delete S.tbStar[id];
      else if (l) S.tbStar[id] = { id, vid, phrase: l.notes[0] ? l.notes[0].phrase : "", quote: l.text, ko: l.tr, speaker: l.speaker,
        meaning: l.notes.map(n => n.meaning).join(" / "), example: "", example_ko: "", time: l.time, sec: l.sec, level: "" };
      save(); st.classList.toggle("on", !!S.tbStar[id]); st.textContent = S.tbStar[id] ? "⭐" : "☆";
    }
    const ko = e.target.closest(".ko.hid, .ko.peek"); if (ko) { ko.classList.toggle("hid"); ko.classList.toggle("peek"); }
  });
  view.addEventListener("toggle", e => {
    const dt = e.target; if (!dt.matches || !dt.matches("details.chap")) return;
    const vid = location.hash.split("/")[1], set = tbOpen[vid] = tbOpen[vid] || new Set(), k = +dt.dataset.chap;
    if (dt.open === set.has(k)) return;
    dt.open ? set.add(k) : set.delete(k);
    if (dt.open && !dt.querySelector(".line")) rerenderDetail(vid);
  }, true);
  view.addEventListener("input", e => {
    const mm = e.target.closest("[data-memo]");
    if (mm) { const vid = location.hash.split("/")[1], m = (S.tbMark[vid] || {})[mm.dataset.memo]; if (m) { m.memo = mm.value; save(); } return; }
    const t = e.target.closest("[data-note]"); if (!t) return;
    S.notes[t.dataset.note] = t.value; save();
  });
  const furi = $("#furi");
  const applyFuri = () => { document.body.classList.toggle("nofuri", !S.furi); furi.setAttribute("aria-pressed", S.furi); };
  furi.onclick = () => { S.furi = !S.furi; save(); applyFuri(); };
  applyFuri();

  Promise.all([
    fetch("data/lessons.json", { cache: "no-cache" }).then(r => r.json()),
    fetch("audio/manifest.json", { cache: "no-cache" }).then(r => r.json()).catch(() => MAN),
    fetch("data/tablo.json", { cache: "no-cache" }).then(r => r.json()).catch(() => TABLO),
  ]).then(([d, m, t]) => { LESSONS = d.lessons; MAN = m; TABLO = t; render(); })
    .catch(() => { view.innerHTML = `<p class="muted">학습 데이터를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>`; });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
