/* 그림책 공방 — 공통 도구
   조사 고르기, 글자 틀 채우기, 저장, 이모지 분리, 문장 나누기, 읽어 주기(기기 목소리 / AI 목소리) */
(function (global) {
  'use strict';
  var SL = global.SL = global.SL || {};

  /* 테스트에서 기다리는 시간을 줄이려고 쓰는 배율. 평소에는 1 */
  function ms(v) { var k = Number(global.__SL_TIME_SCALE); return v * (k > 0 ? k : 1); }
  SL.ms = ms;

  /* ---------- 조사 ----------
     받침이 있으면 앞말, 없으면 뒷말. '으로/로'는 ㄹ 받침 뒤에도 '로'(달로, 연필로).
     숫자로 끝나면 읽는 소리로 판단(1 일, 3 삼, 6 육, 7 칠, 8 팔, 0 영은 받침 있음) */
  var DIGIT_JONG = { 0: 21, 1: 8, 2: 0, 3: 16, 4: 0, 5: 0, 6: 1, 7: 8, 8: 8, 9: 0 };
  function jong(word) {
    var w = String(word == null ? '' : word).replace(/[\s"'“”‘’)\]}.,!?…~]+$/, '');
    var ch = w.slice(-1);
    if (/[0-9]/.test(ch)) return DIGIT_JONG[ch];
    var code = ch.charCodeAt(0) - 0xAC00;
    if (!(code >= 0 && code <= 11171)) return -1; /* 한글이 아니면 판단할 수 없음 */
    return code % 28;
  }
  function josa(word, pair) {
    var parts = String(pair).split('/');
    var j = jong(word);
    if (j < 0) return parts[0];
    if (parts[0] === '으로' && j === 8) return parts[1];
    return j ? parts[0] : parts[1];
  }
  function J(w, pair) { return w + josa(w, pair); }
  SL.josa = josa; SL.J = J;

  /* ---------- 글자 틀 채우기 ----------
     '{H:은/는} {P}에 갔어요' → vars.H, vars.P 로 채운다. 없는 이름이 있으면 오류를 던져 테스트가 잡게 한다 */
  function fmt(str, vars) {
    return String(str).replace(/\{(\w+)(?::([^}]+))?\}/g, function (_, k, pair) {
      var v = vars[k];
      if (v == null || v === '') throw new Error('빈 자리: ' + k + ' in "' + str + '"');
      v = String(v);
      return pair ? J(v, pair) : v;
    });
  }
  SL.fmt = fmt;

  /* ---------- 정해진 순서의 난수 (같은 seed → 같은 결과) ---------- */
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  SL.rng = rng;
  SL.pick = function (arr, r) { return arr[Math.floor((r || Math.random)() * arr.length)]; };
  SL.shuffle = function (arr, r) {
    var a = arr.slice(); r = r || Math.random;
    for (var i = a.length - 1; i > 0; i--) { var k = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[k]; a[k] = t; }
    return a;
  };

  /* ---------- 이모지 분리 ----------
     국기, 키캡(1️⃣), 피부색, ZWJ로 이은 이모지(🧜‍♀️)까지 한 덩어리로 뗀다 */
  var EMOJI_RE = /(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)/gu;
  function splitEmoji(text) {
    var found = [];
    var t = String(text == null ? '' : text).replace(EMOJI_RE, function (m) { found.push(m); return ' '; });
    t = t.replace(/[️‍⃣]/g, '').replace(/\p{Emoji_Modifier}/gu, '');
    t = t.replace(/\s+/g, ' ').replace(/\s+([.,!?…])/g, '$1').trim();
    return { text: t, emojis: found };
  }
  SL.splitEmoji = splitEmoji;
  SL.hasEmoji = function (s) { EMOJI_RE.lastIndex = 0; var r = EMOJI_RE.test(String(s)); EMOJI_RE.lastIndex = 0; return r; };

  /* 아이가 입력한 글 다듬기: 이모지·따옴표·줄바꿈을 빼고 길이를 자른다 (글자는 늘 textContent로만 넣는다) */
  SL.cleanInput = function (s, max) {
    var t = splitEmoji(String(s || '').replace(/[\r\n\t]+/g, ' ')).text;
    t = t.replace(/["'“”‘’`]/g, '').replace(/\s+/g, ' ').trim();
    return Array.from(t).slice(0, max).join('');
  };

  /* ---------- 문장 나누기 ----------
     . ! ? … 뒤가 띄어쓰기이거나 글 끝이면 나눈다. 따옴표 안의 문장부호에서는 나누지 않는다 */
  var OPEN = { '"': '"', '“': '”', '‘': '’', "'": "'", '「': '」', '『': '』' };
  function splitSentences(text) {
    var s = String(text || '').trim();
    var out = [], cur = '', stack = [];
    var chars = Array.from(s);
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i];
      cur += c;
      var top = stack[stack.length - 1];
      if (top && c === top) stack.pop();
      else if (OPEN[c]) stack.push(OPEN[c]);
      if (stack.length) continue;
      if (/[.!?…]/.test(c)) {
        /* 이어진 문장부호와 닫는 따옴표·괄호까지 붙인다 */
        while (i + 1 < chars.length && /[.!?…~)\]]/.test(chars[i + 1])) cur += chars[++i];
        if (i + 1 >= chars.length || /\s/.test(chars[i + 1])) {
          if (cur.trim()) out.push(cur.trim());
          cur = '';
        }
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  SL.splitSentences = splitSentences;

  /* ---------- 이어 주는 말 · 흉내 내는 말 표시 ----------
     읽기 화면에서 낱말 아래에 색을 넣어 짚어 준다. 글은 조각으로 나누어 textContent로만 넣는다 */
  var LINKS = ['알고 보니', '그다음', '그런데', '그때', '그래서', '그러자', '그러다', '드디어', '마침내', '하지만', '이번에는', '어느 날', '그날 밤', '그날 저녁', '어느새'];
  var MIMES = ('팔랑팔랑 바스락바스락 영차영차 철썩철썩 살랑살랑 펄럭펄럭 헉헉 모락모락 둥둥 살금살금 까르르 얼기설기 둥실둥실 휘이잉 솔솔 반짝반짝 ' +
    '미끌미끌 알록달록 삐빅삐빅 풍덩 하늘하늘 옹기종기 뒤적뒤적 주룩주룩 꼬르륵꼬르륵 쌩쌩 덜덜 휘잉 엉엉 꽁꽁 쿵쿵 쿨쿨 데굴데굴 부르릉 우수수 ' +
    '빙글빙글 삐삐삐 버둥버둥 슬금슬금 철퍼덕 뽀드득 휙휙 부글부글 쿠르릉 꽈당 훌러덩 후들후들 사르르 딸깍 띠링띠링 둥실 뚝딱뚝딱 랄랄라 다다다 ' +
    '콩닥콩닥 글썽글썽 동동 허둥지둥 폴짝폴짝 킁킁 두리번두리번 훨훨 번쩍 첨벙첨벙 쪼르르 뾰로롱 방긋 덜컥 키득키득 찰칵 멍멍 야옹 짹짹 엉금엉금 ' +
    '붕붕 꽥꽥 삐약삐약 뿌우 어흥 부엉부엉 개굴개굴 끼끼 삐리삐리 깡충깡충 꾸물꾸물 딱딱 뽀글뽀글 삐익 크앙 휘익 슝 쿵 쾅 펑 쌩 탁 뚝 휙 후끈후끈 ' +
    '포근포근 성큼성큼 와르르 사각사각 보글보글 졸졸 꿀꺽 냠냠 깔깔 하하 호호 반짝 쏙 영차').split(' ');
  MIMES.sort(function (a, b) { return b.length - a.length; });
  var HANGUL = /[가-힣]/;
  function okAfter(rest) { return !rest || !HANGUL.test(rest[0]) || /^(하|했|해|한|거|대|이|히|와|과|은|는|을|를|도|소리|하는)/.test(rest); }
  function markWords(text) {
    var segs = [], buf = '', i = 0, s = String(text);
    function flush() { if (buf) { segs.push({ t: buf }); buf = ''; } }
    while (i < s.length) {
      var prev = i ? s[i - 1] : '';
      var hit = null;
      if (!HANGUL.test(prev)) {
        for (var a = 0; a < LINKS.length && !hit; a++) if (s.startsWith(LINKS[a], i) && okAfter(s.slice(i + LINKS[a].length))) hit = { w: LINKS[a], c: 'w-link' };
        for (var b = 0; b < MIMES.length && !hit; b++) if (s.startsWith(MIMES[b], i) && okAfter(s.slice(i + MIMES[b].length))) hit = { w: MIMES[b], c: 'w-mime' };
      }
      if (hit) { flush(); segs.push({ t: hit.w, c: hit.c }); i += hit.w.length; }
      else { buf += s[i]; i++; }
    }
    flush();
    return segs;
  }
  SL.markWords = markWords;

  /* ---------- 저장 ---------- */
  var KEY = 'storylab-v1';
  function defaults() { return { v: 1, author: '', rate: 1, voice: 'device', style: 'F1', books: [] }; }
  function load() {
    var d = defaults();
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) return d;
      var got = JSON.parse(raw);
      if (!got || got.v !== 1) return d;
      for (var k in d) if (got[k] != null && typeof got[k] === typeof d[k]) d[k] = got[k];
      if (!Array.isArray(d.books)) d.books = [];
      d.books = d.books.filter(function (b) { return b && typeof b.id === 'string' && b.ep && b.picks; });
      if ([0.8, 1, 1.2].indexOf(d.rate) < 0) d.rate = 1;
    } catch (e) { /* 깨진 저장값은 버린다 */ }
    return d;
  }
  function save(d) {
    try { global.localStorage.setItem(KEY, JSON.stringify(d)); return true; }
    catch (e) { return false; } /* 용량 부족 등 */
  }
  SL.store = { KEY: KEY, load: load, save: save, defaults: defaults };

  /* ---------- 기기 목소리 (Web Speech API) ---------- */
  var ua = global.navigator ? navigator.userAgent : '';
  var IOS = /iP(ad|hone|od)/.test(ua) || (/Macintosh/.test(ua) && global.navigator && navigator.maxTouchPoints > 1);
  SL.IOS = IOS;
  SL.isMobile = function () { return IOS || /Android|Mobile/i.test(ua); };
  function synth() { try { return global.speechSynthesis || null; } catch (e) { return null; } }
  var voices = [];
  function loadVoices() { var s = synth(); try { voices = s && s.getVoices ? s.getVoices() || [] : []; } catch (e) { voices = []; } }
  if (synth()) {
    loadVoices();
    try { synth().addEventListener('voiceschanged', loadVoices); } catch (e) { try { synth().onvoiceschanged = loadVoices; } catch (e2) { } }
  }
  /* 장난감 목소리(Grandma, Rocko 등)는 뺀다. 기기 안 목소리(localService)를 먼저 고른다:
     네트워크 목소리는 문장을 서버로 보내므로 온디바이스 원칙에 어긋난다 */
  var NOVELTY = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Kathy|Fred|Ralph)\b/i;
  function koVoices() {
    if (!voices.length) loadVoices();
    return voices.filter(function (x) { return x && x.lang && x.lang.replace('_', '-').toLowerCase().indexOf('ko') === 0 && !NOVELTY.test(x.name || ''); });
  }
  function pickVoice() {
    var v = koVoices();
    if (!v.length) return null;
    var local = v.filter(function (x) { return x.localService; });
    return local.filter(function (x) { return x.default; })[0] || local[0] || v.filter(function (x) { return x.default; })[0] || v[0];
  }
  SL.voiceInfo = function () {
    var v = koVoices();
    return { has: !!synth(), ko: v.length, local: v.filter(function (x) { return x.localService; }).length, picked: (pickVoice() || {}).name || '' };
  };

  var unlocked = false, audioCtx = null;
  function getAudio() {
    if (!audioCtx) { try { var C = global.AudioContext || global.webkitAudioContext; if (C) audioCtx = new C(); } catch (e) { } }
    return audioCtx;
  }
  /* iPad·iPhone: 첫 터치 때 소리 없는 음성을 한 번 내서 그 뒤의 음성을 허락받는다. AI 목소리용 오디오도 함께 깨운다 */
  function unlock() {
    var a = getAudio();
    if (a && a.state === 'suspended') { try { a.resume(); } catch (e) { } }
    if (unlocked) return;
    unlocked = true;
    var s = synth();
    if (IOS && s) { try { var z = new global.SpeechSynthesisUtterance(' '); z.volume = 0; z.lang = 'ko-KR'; s.speak(z); } catch (e) { } }
  }
  if (global.document) ['touchend', 'click', 'keydown'].forEach(function (t) { document.addEventListener(t, unlock, { capture: true, passive: true }); });

  /* 글자 수로 잡는 예상 시간: 1초에 약 4글자 + 1.2초, 빠르기에 맞춰 줄인다 */
  function expectMs(text, rate) {
    var n = Array.from(String(text).replace(/\s+/g, '')).length;
    return ms((n / 4 + 1.2) * 1000 / (rate || 1));
  }
  SL.expectMs = expectMs;

  /* 한 문장을 기기 목소리로 읽는다. 끝나면 done()을 꼭 한 번만 부른다.
     onend가 오지 않는 기기 대비: 예상 시간이 지나면 speaking을 보고, 아직 말하는 중이면 최대 3배까지 기다린다 */
  var lastUtter = null;
  function deviceSay(text, rate, done) {
    var s = synth();
    var finished = false, timers = [];
    var t0 = Date.now(), expect = expectMs(text, rate);
    function finish(ok) {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      done(ok);
    }
    function check() {
      var busy = false;
      try { busy = !!(s && (s.speaking || s.pending)); } catch (e) { }
      if (busy && Date.now() - t0 < expect * 3) timers.push(setTimeout(check, ms(400)));
      else finish(true);
    }
    /* 대비 타이머는 실제로 말하기 시작한 때부터 잰다 (안드로이드에서 80ms 늦게 말하는 사이에 끝난 것으로 보지 않게) */
    function arm() { t0 = Date.now(); timers.push(setTimeout(check, expect)); }
    if (!s || !global.SpeechSynthesisUtterance) { arm(); return { cancel: function () { finish(false); } }; }
    var u;
    try {
      u = new global.SpeechSynthesisUtterance(String(text));
      u.lang = 'ko-KR';
      u.rate = rate || 1;
      var v = pickVoice();
      if (v) u.voice = v;
      u.onend = function () { finish(true); };
      u.onerror = function (e) { if (e && (e.error === 'interrupted' || e.error === 'canceled')) return; finish(true); };
    } catch (e) { arm(); return { cancel: function () { finish(false); } }; }
    var go = function () {
      if (finished) return;
      arm();
      try { s.resume(); } catch (e) { }
      lastUtter = u; /* 말하는 도중 가비지 수거로 끊기지 않게 잡아 둔다 */
      try { s.speak(u); } catch (e) { }
    };
    /* 안드로이드 Chrome은 cancel() 바로 뒤 speak()를 자주 버린다: 말하는 중일 때만 끊고 80ms 뒤에 말한다.
       iPad·iPhone은 늦추면 터치 밖이 되어 막히므로 바로 말한다 */
    var busyNow = false;
    try { busyNow = s.speaking || s.pending; } catch (e) { }
    if (busyNow) {
      try { s.cancel(); } catch (e) { }
      if (IOS) go(); else timers.push(setTimeout(go, 80));
    } else go();
    return {
      cancel: function () {
        if (finished) return;
        finished = true;
        timers.forEach(clearTimeout);
        try { s.cancel(); } catch (e) { }
      }
    };
  }

  /* ---------- AI 목소리 (Supertonic 3, 기기 안에서 계산) ---------- */
  var model = { state: 'off', tts: null, msg: '', err: '', listeners: [], pcm: new Map(), loading: null };
  function modelEmit() { model.listeners.forEach(function (f) { try { f(model); } catch (e) { } }); }
  SL.model = model;
  SL.onModel = function (f) { model.listeners.push(f); return function () { model.listeners = model.listeners.filter(function (x) { return x !== f; }); }; };
  SL.loadModel = function () {
    if (model.loading) return model.loading;
    model.state = 'loading'; model.msg = 'AI 목소리를 준비하는 중'; model.err = ''; modelEmit();
    model.loading = import('./tts-client.js').then(function (m) { return m.createTTS(); }).then(function (tts) {
      model.tts = tts;
      return tts.load(function (msg) { model.msg = msg; modelEmit(); });
    }).then(function () {
      model.state = 'ready'; model.msg = 'AI 목소리 준비 완료'; modelEmit();
      return model.tts;
    }).catch(function (e) {
      model.state = 'error'; model.err = (e && e.message) || String(e); model.msg = 'AI 목소리를 준비하지 못했어요';
      model.loading = null; modelEmit();
      throw e;
    });
    return model.loading;
  };
  function pcmKey(text, style, rate) { return style + '|' + rate + '|' + text; }
  function synthPcm(text, style, rate, signal) {
    var key = pcmKey(text, style, rate);
    if (model.pcm.has(key)) return model.pcm.get(key);
    var p = model.tts.synth(text, { voice: style, lang: 'ko', speed: 1.05 * (rate || 1), signal: signal }).catch(function (e) { model.pcm.delete(key); throw e; });
    model.pcm.set(key, p);
    if (model.pcm.size > 24) model.pcm.delete(model.pcm.keys().next().value);
    return p;
  }
  /* 다음 문장을 미리 합성해 두어 문장 사이 틈을 줄인다 */
  SL.prefetch = function (text, opts) {
    if (opts.voice !== 'ai' || model.state !== 'ready' || !text) return;
    synthPcm(text, opts.style, opts.rate).catch(function () { });
  };
  function modelSay(text, opts, done) {
    var finished = false, src = null, timer = null, ac = typeof AbortController === 'function' ? new AbortController() : null;
    function finish(ok) { if (finished) return; finished = true; clearTimeout(timer); done(ok); }
    synthPcm(text, opts.style, opts.rate, ac && ac.signal).then(function (pcm) {
      if (finished) return;
      var a = getAudio();
      if (!a) throw new Error('오디오를 쓸 수 없어요');
      if (a.state === 'suspended') { try { a.resume(); } catch (e) { } }
      var buf = a.createBuffer(1, pcm.length, model.tts.sampleRate);
      buf.copyToChannel ? buf.copyToChannel(pcm, 0) : buf.getChannelData(0).set(pcm);
      src = a.createBufferSource();
      src.buffer = buf;
      src.connect(a.destination);
      src.onended = function () { finish(true); };
      src.start();
      /* onended가 오지 않는 경우 대비: 소리 길이 + 1초 */
      timer = setTimeout(function () { finish(true); }, ms(buf.duration * 1000 + 1000));
    }).catch(function (e) {
      if (finished) return;
      if (e && e.name === 'AbortError') return;
      console.warn('[읽기] AI 목소리 합성 실패, 기기 목소리로 읽어요', e);
      var h = deviceSay(text, opts.rate, finish);
      cancelInner = h.cancel;
    });
    var cancelInner = null;
    return {
      cancel: function () {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (ac) { try { ac.abort(); } catch (e) { } }
        if (src) { try { src.onended = null; src.stop(); } catch (e) { } }
        if (cancelInner) cancelInner();
      }
    };
  }

  /* ---------- 말하기 창구 ----------
     say(text, opts, done): opts = { rate, voice: 'device'|'ai', style }. 새로 말하면 앞의 것은 끊긴다.
     done(true)는 끝까지 말했을 때 딱 한 번, 끊기면 부르지 않는다 */
  var current = null, token = 0;
  function stop() {
    token++;
    if (current) { var c = current; current = null; c.cancel(); }
    var s = synth();
    if (s) { try { if (s.speaking || s.pending) s.cancel(); } catch (e) { } }
  }
  function say(text, opts, done) {
    opts = opts || {};
    if (current) { var c = current; current = null; c.cancel(); }
    var my = ++token;
    var spoken = splitEmoji(text).text; /* 이모지는 읽지 않는다 */
    var once = false;
    var cb = function (ok) {
      if (once || my !== token) return;
      once = true;
      current = null;
      if (done) done(ok);
    };
    if (!spoken) { var t = setTimeout(function () { cb(true); }, ms(300)); current = { cancel: function () { clearTimeout(t); } }; return; }
    current = (opts.voice === 'ai' && model.state === 'ready') ? modelSay(spoken, opts, cb) : deviceSay(spoken, opts.rate, cb);
  }
  SL.say = say;
  SL.stopSpeak = stop;
})(window);
