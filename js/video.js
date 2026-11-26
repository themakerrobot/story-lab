/* 그림책 공방 — 그림책을 영상(MP4)으로 만들기. 전부 이 기기 안에서 만든다 (서버로 보내지 않음)
   · 그림: 읽기 화면처럼 펼친 책(왼쪽 장면 · 오른쪽 글)을 캔버스에 그린다. 읽는 문장은 노랗게 짚는다
   · 쪽 사이: 오른쪽 쪽이 접혔다가 다음 쪽 왼쪽으로 펴지는 "책장 넘기기"
   · 소리: AI 목소리(해설·인물마다 정한 목소리)를 이어 붙인다
   · 묶기: WebCodecs(H.264 영상 + AAC, 안 되면 Opus 소리) → mp4-muxer(MIT, vendor/mp4-muxer) */
(function (SL) {
  'use strict';
  var W = 1280, H = 720, FPS = 24, RATE = 48000;
  var BOOK = { x: 40, y: 40, w: 1200, h: 640 };
  var GUT = BOOK.x + BOOK.w / 2;
  var SCN = { x: BOOK.x + 24, w: BOOK.w / 2 - 48 };
  SCN.h = SCN.w * 3 / 4; SCN.y = BOOK.y + (BOOK.h - SCN.h) / 2;
  var TXT = { x: GUT + 40, y: BOOK.y + 70, w: BOOK.w / 2 - 80, h: BOOK.h - 130 };
  var EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  var SERIF = '"Gowun Batang","Nanum Myeongjo",serif';
  var SANS = '"Pretendard Variable",Pretendard,sans-serif';
  var C = { paper: '#FBF7EF', panel: '#FFFFFF', line: '#DCD5C6', ink: '#2A2620', ink3: '#6B6255', red: '#B4451C', blue: '#1F5F7A', hl: '#F7E6A6' };

  SL.videoSupported = function () { return typeof window.VideoEncoder === 'function' && typeof window.AudioEncoder === 'function' && typeof window.VideoFrame === 'function'; };

  function loadMuxer() {
    if (window.Mp4Muxer) return Promise.resolve(window.Mp4Muxer);
    return new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = 'vendor/mp4-muxer/mp4-muxer.min.js';
      s.onload = function () { window.Mp4Muxer ? ok(window.Mp4Muxer) : no(new Error('MP4 묶음 도구를 불러오지 못했어요')); };
      s.onerror = function () { no(new Error('MP4 묶음 도구를 불러오지 못했어요')); };
      document.head.appendChild(s);
    });
  }
  /* 배경 SVG → 그림 (배경 이름마다 한 번) */
  var bgCache = {};
  function bgImage(name) {
    if (bgCache[name]) return bgCache[name];
    bgCache[name] = new Promise(function (ok) {
      var svg = SL.bgSVG(name).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" ');
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { ok(null); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    return bgCache[name];
  }

  /* 장면 그리기 — js/scenes.js 의 renderScene 과 같은 자리 (크기·위치는 장면 높이에 대한 %) */
  function drawScene(ctx, sc, cover, x, y, w, hh, bg) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, hh); ctx.clip();
    if (bg) ctx.drawImage(bg, x, y, w, hh); else { ctx.fillStyle = '#cfe9ff'; ctx.fillRect(x, y, w, hh); }
    var noTint = /^(night|space|moon|starland|sea)$/.test(sc.bg);
    if (!noTint && sc.tm === 'eve') { ctx.fillStyle = 'rgba(255,140,70,.26)'; ctx.fillRect(x, y, w, hh); }
    if (!noTint && sc.tm === 'night') { ctx.fillStyle = 'rgba(10,20,70,.45)'; ctx.fillRect(x, y, w, hh); }
    if (sc.mood === 'tense') { ctx.fillStyle = 'rgba(30,10,50,.22)'; ctx.fillRect(x, y, w, hh); }
    var pos = sc.pos || {}, cast = sc.cast || [];
    function emo(e, size, cx, by, anchor) {
      var px = size / 100 * hh;
      ctx.font = px + 'px ' + EMOJI;
      ctx.textAlign = anchor === 'right' ? 'right' : 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(e, cx, by - px * 0.1);
    }
    function put(key, e, size, leftPct, bottomPct, anchor) {
      var p = pos[key];
      if (Array.isArray(p)) { var px = size / 100 * hh; emo(e, size, x + p[0] / 100 * w, y + p[1] / 100 * hh + px * 0.5, 'center'); return; }
      if (anchor === 'right') emo(e, size, x + w - leftPct / 100 * w, y + hh - bottomPct / 100 * hh, 'right');
      else emo(e, size, x + leftPct / 100 * w, y + hh - bottomPct / 100 * hh, 'center');
    }
    if (cover) {
      emo(cast[0] || '🙂', 60, x + w / 2, y + hh * 0.93, 'center');
      cast.slice(1, 4).forEach(function (e, i) { emo(e, 20, x + w - (6 + i * 15) / 100 * w, y + hh * 0.95, 'right'); });
    } else {
      var n = cast.length, size = n <= 2 ? 32 : n === 3 ? 28 : n === 4 ? 25 : 22;
      put('c0', cast[0] || '🙂', size, 14, 4);
      cast.slice(1).forEach(function (e, i) { put('c' + (i + 1), e, size, 86 - i * (n <= 3 ? 22 : 17), 4); });
      if (sc.guest) put('g', sc.guest, Math.round(size * 0.8), 58, 8);
      if (sc.vil) {
        if (Array.isArray(pos.v)) put('v', sc.vil, 30, 0, 0);
        else emo(sc.vil, 30, x + w * 0.95, y + hh * 0.06 + 0.3 * hh, 'right');
      }
      (sc.obj || []).slice(0, 2).forEach(function (e, i, arr) {
        var left = arr.length === 1 ? 50 : (i === 0 ? 40 : 60);
        if (Array.isArray(pos['o' + i])) put('o' + i, e, 20, 0, 0);
        else emo(e, 20, x + left / 100 * w, y + hh * 0.07 + 0.2 * hh, 'center');
      });
    }
    if (sc.mood === 'happy') [[12, 18], [82, 14], [30, 8], [68, 30], [50, 4]].forEach(function (p) { emo('✨', 9, x + p[0] / 100 * w, y + (p[1] + 9) / 100 * hh, 'center'); });
    ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, hh);
  }

  /* 글 줄 나누기: 띄어쓰기에서 나누고, 한 낱말이 너무 길면 글자 단위로 */
  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    words.forEach(function (wd) {
      var t = line ? line + ' ' + wd : wd;
      if (ctx.measureText(t).width <= maxW) { line = t; return; }
      if (line) lines.push(line);
      if (ctx.measureText(wd).width <= maxW) { line = wd; return; }
      line = '';
      Array.from(wd).forEach(function (ch) { if (ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; } else line += ch; });
    });
    if (line) lines.push(line);
    return lines;
  }
  /* 쪽 하나(펼친 책)를 그린다. hl: 짚을 문장 번호 */
  function drawSpread(ctx, page, idx, total, title, bg, hl) {
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(31,95,122,.07)';
    for (var gx = 11; gx < W; gx += 22) for (var gy = 11; gy < H; gy += 22) ctx.fillRect(gx, gy, 2, 2);
    ctx.fillStyle = 'rgba(42,38,32,.10)'; ctx.fillRect(BOOK.x + 4, BOOK.y + 8, BOOK.w, BOOK.h);
    ctx.fillStyle = C.panel; ctx.fillRect(BOOK.x, BOOK.y, BOOK.w, BOOK.h);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(BOOK.x + 0.5, BOOK.y + 0.5, BOOK.w - 1, BOOK.h - 1);
    ctx.fillStyle = C.line; ctx.fillRect(GUT - 1, BOOK.y, 2, BOOK.h);
    drawScene(ctx, page.sc, page.kind === 'cover', SCN.x, SCN.y, SCN.w, SCN.h, bg);
    ctx.textBaseline = 'alphabetic';
    if (page.kind === 'cover') {
      ctx.fillStyle = C.ink3; ctx.font = '600 18px ' + SANS; ctx.textAlign = 'center';
      ctx.fillText('그림책 공방', GUT + BOOK.w / 4, BOOK.y + 230);
      ctx.fillStyle = C.ink; ctx.font = '700 46px ' + SERIF;
      var tl = wrap(ctx, title, TXT.w);
      tl.forEach(function (l, i) {
        if (hl === 0) { var mw = ctx.measureText(l).width; ctx.fillStyle = C.hl; ctx.fillRect(GUT + BOOK.w / 4 - mw / 2 - 8, BOOK.y + 262 + i * 62, mw + 16, 58); ctx.fillStyle = C.ink; }
        ctx.fillText(l, GUT + BOOK.w / 4, BOOK.y + 305 + i * 62);
      });
      if (page.author) { ctx.font = '22px ' + SANS; ctx.fillStyle = C.ink3; ctx.fillText('지은이 ' + page.author, GUT + BOOK.w / 4, BOOK.y + 340 + tl.length * 62); }
    } else if (page.kind === 'end') {
      ctx.fillStyle = C.ink; ctx.font = '700 96px ' + SERIF; ctx.textAlign = 'center';
      ctx.fillText('끝', GUT + BOOK.w / 4, BOOK.y + BOOK.h / 2 + 20);
      ctx.fillStyle = C.ink3; ctx.font = '20px ' + SANS;
      ctx.fillText('그림책 공방에서 만들었어요', GUT + BOOK.w / 4, BOOK.y + BOOK.h / 2 + 80);
    } else {
      ctx.textAlign = 'left';
      var size = 32, lh = size * 1.75;
      ctx.font = size + 'px ' + SERIF;
      var blocks = page.sents.map(function (s) { return wrap(ctx, s, TXT.w); });
      var n = blocks.reduce(function (a, b) { return a + b.length; }, 0);
      while (n * lh > TXT.h && size > 22) { size -= 2; lh = size * 1.75; ctx.font = size + 'px ' + SERIF; blocks = page.sents.map(function (s) { return wrap(ctx, s, TXT.w); }); n = blocks.reduce(function (a, b) { return a + b.length; }, 0); }
      var yy = TXT.y + (TXT.h - n * lh) / 2 + size;
      blocks.forEach(function (lines, si) {
        lines.forEach(function (l) {
          if (si === hl) { ctx.fillStyle = C.hl; ctx.fillRect(TXT.x - 6, yy - size * 1.05, ctx.measureText(l).width + 12, size * 1.45); }
          ctx.fillStyle = C.ink; ctx.fillText(l, TXT.x, yy);
          yy += lh;
        });
      });
      ctx.fillStyle = C.ink3; ctx.font = '600 18px ' + SANS; ctx.textAlign = 'center';
      ctx.fillText(idx + ' / ' + total, GUT + BOOK.w / 4, BOOK.y + BOOK.h - 24);
    }
  }

  /* 소리: 문장 → 해설·대사 조각 → AI 목소리 → 48kHz 로 맞춰 이어 붙인다 */
  function resample(pcm, from) {
    if (from === RATE) return pcm;
    var n = Math.round(pcm.length * RATE / from), out = new Float32Array(n), k = from / RATE;
    for (var i = 0; i < n; i++) { var p = i * k, a = Math.floor(p), f = p - a; out[i] = (pcm[a] || 0) * (1 - f) + (pcm[a + 1] || 0) * f; }
    return out;
  }
  function silence(sec) { return new Float32Array(Math.round(sec * RATE)); }

  /* 만들기. opts: { voiceOf(who) → {style, rate}, onProgress(phase, done, total), isCancelled() } → Blob */
  SL.makeVideo = async function (book, opts) {
    if (!SL.videoSupported()) throw new Error('이 브라우저는 영상 만들기를 지원하지 않아요. 크롬이나 엣지에서 해 주세요.');
    if (SL.model.state !== 'ready') throw new Error('AI 목소리를 먼저 준비해 주세요.');
    var cancelled = opts.isCancelled || function () { return false; };
    var prog = opts.onProgress || function () { };
    var Mux = await loadMuxer();
    var pages = SL.buildBook(book), texts = pages.filter(function (p) { return p.kind === 'text'; }).length;
    var plan = pages.map(function (p) {
      var sents = p.kind === 'cover' ? (book.author ? [book.title, SL.J(book.author, '이/가') + ' 지은 이야기예요.'] : [book.title]) : p.kind === 'end' ? [] : SL.splitSentences(p.t);
      return { kind: p.kind, sc: p.sc, spk: p.spk || [], sents: sents, author: book.author };
    });
    /* 글꼴: 화면에 나올 글자가 든 글꼴 조각을 미리 받는다 */
    try {
      var all = book.title + plan.map(function (p) { return p.sents.join(' '); }).join(' ') + '끝그림책공방지은이0123456789/';
      await Promise.all([document.fonts.load('32px "Gowun Batang"', all), document.fonts.load('700 46px "Gowun Batang"', all), document.fonts.load('600 18px "Pretendard Variable"', all)]);
    } catch (e) { /* 글꼴이 없어도 대체 글꼴로 그린다 */ }

    /* 1) 목소리 */
    var jobs = 0, done = 0;
    plan.forEach(function (p) { var at = 0; p.sents.forEach(function (s) { var r = SL.speechParts(s, p.kind === 'text' ? p.spk : [], at); at = r.at; jobs += r.parts.length; }); });
    for (var pi = 0; pi < plan.length; pi++) {
      var p = plan[pi], at = 0;
      p.audio = []; p.sentT = [];
      for (var si = 0; si < p.sents.length; si++) {
        var r = SL.speechParts(p.sents[si], p.kind === 'text' ? p.spk : [], at); at = r.at;
        var bits = [];
        for (var k = 0; k < r.parts.length; k++) {
          if (cancelled()) throw new DOMException('그만뒀어요', 'AbortError');
          var v = opts.voiceOf(r.parts[k].who);
          var pcm = await SL.synthPcm(r.parts[k].t, v);
          bits.push(resample(SL.normalizePcm(pcm), SL.model.tts.sampleRate));
          if (k < r.parts.length - 1) bits.push(silence(0.15));
          prog('voice', ++done, jobs);
        }
        bits.push(silence(0.4));
        p.audio.push(bits);
      }
    }
    /* 쪽마다 시간 정하기: 문장 소리 길이, 쪽 끝 쉼 0.8초, 소리 없는 쪽은 2.5초 */
    var TURN = 0.7, t = 0, timeline = [];
    plan.forEach(function (p, i) {
      var start = t, segs = [], st = start + 0.4;
      p.audio.forEach(function (bits, si) {
        var len = bits.reduce(function (a, b) { return a + b.length; }, 0) / RATE;
        segs.push({ si: si, t0: st, t1: st + len }); st += len;
      });
      var end = Math.max(st + 0.8, start + 2.5);
      timeline.push({ p: p, i: i, t0: start, t1: end, segs: segs });
      t = end + (i < plan.length - 1 ? TURN : 0);
    });
    var totalSec = t;

    /* 2) 영상·소리 만들기 */
    var vCodec = null;
    for (var vc of [['avc1.4d0028', 'avc'], ['avc1.42001f', 'avc'], ['vp09.00.10.08', 'vp9']]) {
      try { if ((await VideoEncoder.isConfigSupported({ codec: vc[0], width: W, height: H, bitrate: 2500000, framerate: FPS })).supported) { vCodec = vc; break; } } catch (e) { }
    }
    var aCodec = null;
    for (var ac of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      try { if ((await AudioEncoder.isConfigSupported({ codec: ac[0], sampleRate: RATE, numberOfChannels: 1, bitrate: 96000 })).supported) { aCodec = ac; break; } } catch (e) { }
    }
    if (!vCodec || !aCodec) throw new Error('이 기기에서는 MP4 영상을 만들 수 없어요.');
    var target = new Mux.ArrayBufferTarget();
    var muxer = new Mux.Muxer({ target: target, video: { codec: vCodec[1], width: W, height: H }, audio: { codec: aCodec[1], numberOfChannels: 1, sampleRate: RATE }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    var encErr = null;
    var venc = new VideoEncoder({ output: function (c, m) { muxer.addVideoChunk(c, m); }, error: function (e) { encErr = e; } });
    venc.configure({ codec: vCodec[0], width: W, height: H, bitrate: 2500000, framerate: FPS, avc: vCodec[1] === 'avc' ? { format: 'avc' } : undefined });
    var aenc = new AudioEncoder({ output: function (c, m) { muxer.addAudioChunk(c, m); }, error: function (e) { encErr = e; } });
    aenc.configure({ codec: aCodec[0], sampleRate: RATE, numberOfChannels: 1, bitrate: 96000 });

    /* 소리: 쪽 시작 시각에 맞춰 이어 붙인 한 줄 */
    var track = new Float32Array(Math.ceil(totalSec * RATE) + RATE);
    timeline.forEach(function (tl) { var off = Math.round((tl.t0 + 0.4) * RATE); tl.p.audio.forEach(function (bits) { bits.forEach(function (b) { track.set(b, Math.min(off, track.length - b.length)); off += b.length; }); }); });
    for (var a0 = 0; a0 < track.length; a0 += RATE) {
      var chunk = track.subarray(a0, Math.min(track.length, a0 + RATE));
      var ad = new AudioData({ format: 'f32', sampleRate: RATE, numberOfFrames: chunk.length, numberOfChannels: 1, timestamp: Math.round(a0 / RATE * 1e6), data: chunk });
      aenc.encode(ad); ad.close();
    }

    /* 그림: 쪽마다 두 장(왼쪽·오른쪽)을 미리 그려 두고, 넘기는 동안 잘라 쓴다 */
    var cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    var ctx = cvs.getContext('2d');
    var cur = document.createElement('canvas'); cur.width = W; cur.height = H;
    var nxt = document.createElement('canvas'); nxt.width = W; nxt.height = H;
    var frames = Math.ceil(totalSec * FPS), fi = 0, lastKey = '';
    async function emit(tsec, key, force) {
      var ts = Math.round(tsec * 1e6);
      var vf = new VideoFrame(cvs, { timestamp: ts, duration: Math.round(1e6 / FPS) });
      venc.encode(vf, { keyFrame: force || fi % (FPS * 2) === 0 });
      vf.close();
      fi++;
      if (venc.encodeQueueSize > 8) await new Promise(function (ok) { setTimeout(ok, 0); });
      if (encErr) throw encErr;
    }
    for (var ti = 0; ti < timeline.length; ti++) {
      var tl = timeline[ti], bg = await bgImage(tl.p.sc.bg);
      var nextTl = timeline[ti + 1], nbg = nextTl ? await bgImage(nextTl.p.sc.bg) : null;
      var first = true;
      for (var f = Math.round(tl.t0 * FPS); f < Math.round(tl.t1 * FPS); f++) {
        if (cancelled()) throw new DOMException('그만뒀어요', 'AbortError');
        var now = f / FPS, hl = -1;
        tl.segs.forEach(function (s) { if (now >= s.t0 && now < s.t1) hl = s.si; });
        var key = ti + ':' + hl;
        if (key !== lastKey) { drawSpread(ctx, tl.p, tl.i, texts, book.title, bg, hl); lastKey = key; }
        await emit(now, key, first); first = false;
        prog('video', f, frames);
      }
      if (!nextTl) continue;
      /* 책장 넘기기: 오른쪽 쪽이 가운데로 접히고 → 다음 쪽 왼쪽이 펴진다 */
      drawSpread(cur.getContext('2d'), tl.p, tl.i, texts, book.title, bg, -1);
      drawSpread(nxt.getContext('2d'), nextTl.p, nextTl.i, texts, book.title, nbg, -1);
      var tf0 = Math.round(tl.t1 * FPS), tf1 = Math.round(nextTl.t0 * FPS);
      for (var g = tf0; g < tf1; g++) {
        var u = (g - tf0 + 1) / Math.max(1, tf1 - tf0), e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        ctx.drawImage(cur, 0, 0, GUT, H, 0, 0, GUT, H);
        ctx.drawImage(nxt, GUT, 0, W - GUT, H, GUT, 0, W - GUT, H);
        var half = W - GUT - 40;
        if (e < .5) {
          var w1 = half * (1 - 2 * e);
          ctx.drawImage(cur, GUT, 0, half, H, GUT, 0, w1, H);
          ctx.fillStyle = 'rgba(0,0,0,' + (0.18 * 2 * e) + ')'; ctx.fillRect(GUT, BOOK.y, w1, BOOK.h);
        } else {
          var w2 = half * (2 * e - 1);
          ctx.drawImage(nxt, GUT - half, 0, half, H, GUT - w2, 0, w2, H);
          ctx.fillStyle = 'rgba(0,0,0,' + (0.18 * (2 - 2 * e)) + ')'; ctx.fillRect(GUT - w2, BOOK.y, w2, BOOK.h);
        }
        ctx.fillStyle = C.line; ctx.fillRect(GUT - 1, BOOK.y, 2, BOOK.h);
        lastKey = '';
        await emit(g / FPS, 'turn', false);
        prog('video', g, frames);
      }
    }
    await venc.flush(); await aenc.flush();
    venc.close(); aenc.close();
    muxer.finalize();
    prog('video', frames, frames);
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), seconds: totalSec, video: vCodec[1], audio: aCodec[1] };
  };
})(window.SL);
