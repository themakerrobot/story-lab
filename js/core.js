/* 그림책 공방 — 공통 도구
   조사 고르기, 글자 틀 채우기, 저장, 이모지 분리, 문장 나누기, 읽어 주기(AI 목소리) */
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
  function defaults() { return { v: 1, author: '', rate: 1, style: 'F1', aiReady: false, books: [] }; }
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

  /* ---------- 오디오 ---------- */
  var ua = global.navigator ? navigator.userAgent : '';
  var IOS = /iP(ad|hone|od)/.test(ua) || (/Macintosh/.test(ua) && global.navigator && navigator.maxTouchPoints > 1);
  SL.IOS = IOS;
  SL.isMobile = function () { return IOS || /Android|Mobile/i.test(ua); };
  var audioCtx = null;
  function getAudio() {
    if (!audioCtx) { try { var C = global.AudioContext || global.webkitAudioContext; if (C) audioCtx = new C(); } catch (e) { } }
    return audioCtx;
  }
  SL.audio = getAudio;
  /* iPad·iPhone·Chrome 은 터치 안에서 오디오를 깨워야 소리가 난다 → 첫 터치 때 깨워 둔다 */
  function unlock() { var a = getAudio(); if (a && a.state === 'suspended') { try { a.resume(); } catch (e) { } } }
  if (global.document) ['touchend', 'click', 'keydown'].forEach(function (t) { document.addEventListener(t, unlock, { capture: true, passive: true }); });

  /* 글자 수로 잡는 예상 시간: 1초에 약 4글자 + 1.2초, 빠르기에 맞춰 줄인다 */
  function expectMs(text, rate) {
    var n = Array.from(String(text).replace(/\s+/g, '')).length;
    return ms((n / 4 + 1.2) * 1000 / (rate || 1));
  }
  SL.expectMs = expectMs;

  /* ---------- AI 목소리 (Supertonic 3, 기기 안에서 계산) ----------
     이 앱은 AI 목소리만 쓴다. 준비 전·실패 때는 소리 없이 예상 시간만큼 문장을 짚고 넘어간다.
     테스트는 window.__SL_FAKE_TTS = { sampleRate, synth(text, opts) → Promise<Float32Array> } 를 넣어 모델 대신 쓴다 */
  var model = { state: 'off', tts: null, msg: '', err: '', pct: 0, listeners: [], pcm: new Map(), loading: null };
  function modelEmit() { model.listeners.forEach(function (f) { try { f(model); } catch (e) { } }); }
  SL.model = model;
  SL.onModel = function (f) { model.listeners.push(f); return function () { model.listeners = model.listeners.filter(function (x) { return x !== f; }); }; };
  SL.loadModel = function () {
    if (model.loading) return model.loading;
    model.state = 'loading'; model.msg = 'AI 목소리를 준비하는 중'; model.err = ''; model.pct = 0; modelEmit();
    var make = global.__SL_FAKE_TTS ? Promise.resolve({ load: function () { return Promise.resolve(); }, synth: function (t, o) { return global.__SL_FAKE_TTS.synth(t, o); }, sampleRate: global.__SL_FAKE_TTS.sampleRate || 16000 })
      : import('./tts-client.js').then(function (m) { return m.createTTS(); });
    function onStatus(msg) {
      model.msg = msg;
      var m = /([\d.]+) \/ ([\d.]+) MB/.exec(msg), step = /\((\d)\/4\)/.exec(msg);
      if (m && step) model.pct = Math.round(((+step[1] - 1) + (+m[1] / +m[2])) / 4 * 100);
      else if (step) model.pct = Math.max(model.pct, Math.round(+step[1] / 4 * 100));
      modelEmit();
    }
    /* 지킴이: 여러 스레드로 준비하다 소식 없이 오래 멈추면(기기·브라우저에 따라 생길 수 있음) 워커를 버리고 한 스레드로 다시 준비한다.
       내려받는 동안에는 조각마다 소식이 오므로, 느린 인터넷을 멈춤으로 보지 않는다 */
    var STALL_MS = global.__SL_STALL_MS || 90000;
    function guarded(tts, single) {
      if (!tts.inWorker || single) return tts.load(onStatus, { single: single });
      return new Promise(function (resolve, reject) {
        var last = Date.now(), done = false;
        var timer = setInterval(function () {
          if (done || Date.now() - last < STALL_MS) return;
          done = true; clearInterval(timer);
          console.warn('[tts] 준비가 멈춰 한 스레드로 다시 준비');
          try { tts.terminate(); } catch (e) { }
          model.msg = 'AI 목소리를 다시 준비하는 중'; modelEmit();
          import('./tts-client.js').then(function (m) { return m.createTTS(); }).then(function (t2) {
            model.tts = t2;
            return guarded(t2, true);
          }).then(resolve, reject);
        }, 1000);
        tts.load(function (msg) { last = Date.now(); onStatus(msg); }).then(function () {
          if (done) return; done = true; clearInterval(timer); resolve();
        }, function (e) {
          if (done) return; done = true; clearInterval(timer); reject(e);
        });
      });
    }
    model.loading = make.then(function (tts) {
      model.tts = tts;
      return guarded(tts, false);
    }).then(function () {
      model.state = 'ready'; model.msg = 'AI 목소리 준비 완료'; model.pct = 100; modelEmit();
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
    if (model.pcm.size > 40) model.pcm.delete(model.pcm.keys().next().value);
    return p;
  }
  SL.synthPcm = function (text, opts) { return synthPcm(splitEmoji(text).text, opts.style, opts.rate); };
  /* 다음 문장을 미리 합성해 두어 문장 사이 틈을 줄인다 */
  SL.prefetch = function (text, opts) {
    if (model.state !== 'ready' || !text) return;
    synthPcm(splitEmoji(text).text, opts.style, opts.rate).catch(function () { });
  };
  /* 소리 크기 맞추기: 목소리·문장마다 크기가 달라 들쭉날쭉하다 → 말소리 크기(RMS)를 같은 값으로 맞춘다.
     조용한 틈은 빼고 재며, 가장 큰 소리가 0.95 를 넘지 않게 하고, 너무 작은 소리를 지나치게 키우지 않는다(최대 6배) */
  var TARGET_RMS = 0.075;
  function normalize(pcm) {
    var sum = 0, n = 0, peak = 0;
    for (var i = 0; i < pcm.length; i++) { var v = Math.abs(pcm[i]); if (v > peak) peak = v; if (v > 0.01) { sum += v * v; n++; } }
    if (!n || !peak) return pcm;
    var rms = Math.sqrt(sum / n), g = Math.min(TARGET_RMS / rms, 0.95 / peak, 6);
    if (Math.abs(g - 1) < 0.03) return pcm;
    var out = new Float32Array(pcm.length);
    for (var k = 0; k < pcm.length; k++) out[k] = pcm[k] * g;
    return out;
  }
  SL.normalizePcm = normalize;
  /* 테스트·진단용: 문장을 읽기 시작할 때 알린다 */
  function announce(text, style, silent) { try { global.dispatchEvent(new CustomEvent('sl-say', { detail: { text: text, style: style, silent: !!silent } })); } catch (e) { } }

  /* 소리 없이 예상 시간만큼 기다린다 (모델 준비 전·실패 때) */
  function silentSay(text, opts, done) {
    announce(text, opts.style, true);
    var t = setTimeout(function () { done(true); }, expectMs(text, opts.rate));
    return { cancel: function () { clearTimeout(t); } };
  }
  /* AI 목소리로 한 문장. 합성이 너무 오래 걸리면(예상 시간의 3배 + 5초) 소리 없이 넘어간다 */
  function modelSay(text, opts, done) {
    var finished = false, src = null, timer = null, inner = null, ac = typeof AbortController === 'function' ? new AbortController() : null;
    function finish(ok) { if (finished) return; finished = true; clearTimeout(timer); done(ok); }
    function fallback(why) {
      if (finished || inner) return;
      if (why) console.warn('[읽기] AI 목소리로 읽지 못해 소리 없이 넘어가요', why);
      inner = silentSay(text, opts, finish);
    }
    timer = setTimeout(function () { if (ac) { try { ac.abort(); } catch (e) { } } fallback('합성이 너무 오래 걸림'); }, expectMs(text, opts.rate) * 3 + ms(5000));
    synthPcm(text, opts.style, opts.rate, ac && ac.signal).then(function (pcm) {
      if (finished || inner) return;
      clearTimeout(timer);
      var a = getAudio();
      if (!a) throw new Error('오디오를 쓸 수 없어요');
      if (a.state === 'suspended') { try { a.resume(); } catch (e) { } }
      var buf = a.createBuffer(1, pcm.length, model.tts.sampleRate);
      var even = normalize(pcm);
      buf.copyToChannel ? buf.copyToChannel(even, 0) : buf.getChannelData(0).set(even);
      src = a.createBufferSource();
      src.buffer = buf;
      src.connect(a.destination);
      src.onended = function () { finish(true); };
      announce(text, opts.style, false);
      src.start();
      /* onended 가 오지 않는 경우 대비: 소리 길이 + 1초 */
      timer = setTimeout(function () { finish(true); }, buf.duration * 1000 + ms(1000));
    }).catch(function (e) {
      if (finished) return;
      if (e && e.name === 'AbortError') return;
      fallback(e);
    });
    return {
      cancel: function () {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (ac) { try { ac.abort(); } catch (e) { } }
        if (src) { try { src.onended = null; src.stop(); } catch (e) { } }
        if (inner) inner.cancel();
      }
    };
  }

  /* ---------- 말하기 창구 ----------
     say(text, opts, done): opts = { rate, style }. 새로 말하면 앞의 것은 끊긴다.
     done(true)는 끝까지 말했을 때 딱 한 번, 끊기면 부르지 않는다 */
  var current = null, token = 0;
  function stop() {
    token++;
    if (current) { var c = current; current = null; c.cancel(); }
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
    current = model.state === 'ready' ? modelSay(spoken, opts, cb) : silentSay(spoken, opts, cb);
  }
  SL.say = say;

  /* ---------- 해설과 대사 나누기 ----------
     문장 하나를 따옴표 밖(해설)과 안(대사)으로 나눈다. who: 대사 임자 목록(쪽마다), at: 지금까지 읽은 대사 수 */
  SL.speechParts = function (sentence, who, at) {
    var out = [], bits = String(sentence).split('"'), n = at || 0;
    bits.forEach(function (b, i) {
      var t = b.replace(/^\s+|\s+$/g, '');
      var inside = i % 2 === 1;
      if (inside) { var w = (who && who[n]) || 'narr'; n++; if (/[가-힣A-Za-z0-9]/.test(t)) out.push({ t: t, who: w }); }
      else if (/[가-힣A-Za-z0-9]/.test(t)) out.push({ t: t, who: 'narr' });
    });
    if (!out.length) out.push({ t: String(sentence), who: 'narr' });
    return { parts: out, at: n };
  };
  SL.STYLES = [['F1', '여자 1'], ['F2', '여자 2'], ['F3', '여자 3'], ['F4', '여자 4'], ['F5', '여자 5'], ['M1', '남자 1'], ['M2', '남자 2'], ['M3', '남자 3'], ['M4', '남자 4'], ['M5', '남자 5']];

  SL.stopSpeak = stop;
})(window);
