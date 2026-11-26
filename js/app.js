/* 그림책 공방 — 화면 흐름
   책장 → 이야기 종류 → 설계도(길이) → 카드 고르기 → 마무리 → 읽기
   아이가 입력한 글은 늘 textContent 로만 넣는다(innerHTML 금지). innerHTML 은 미리 정해 둔 배경 SVG 에만 쓴다. */
(function (SL) {
  'use strict';
  var app = document.getElementById('app');
  var data = SL.store.load();
  var D = SL.data, S = SL.story;
  var reading = false, pendingReload = false, leaveRead = null;

  /* ---------- 작은 도우미 ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function btn(text, cls, on, attrs) { attrs = attrs || {}; attrs.class = 'btn ' + (cls || ''); attrs.type = 'button'; attrs.text = text; attrs.onclick = on; return h('button', attrs); }
  function screen(name, kids) {
    if (leaveRead) { var f = leaveRead; leaveRead = null; f(); }
    SL.stopSpeak();
    closeModal();
    app.textContent = '';
    var s = h('div', { class: 'screen ' + name, 'data-screen': name }, kids);
    app.appendChild(s);
    if (pendingReload && name !== 'read') { location.reload(); }
    return s;
  }
  function speakOpts() { return { rate: data.rate, voice: data.voice, style: data.style }; }
  function speak(text) { SL.say(text, speakOpts()); }
  var toastTimer = null;
  function toast(msg, ms) {
    var old = document.querySelector('.toast'); if (old) old.remove();
    var t = h('div', { class: 'toast', role: 'status', text: msg });
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, ms || 3200);
  }
  function persist() {
    var ok = SL.store.save(data);
    if (!ok) toast('저장 공간이 부족해서 저장하지 못했어요. 지금 읽는 책은 계속 볼 수 있어요.', 5000);
    return ok;
  }
  var modalEl = null;
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }
  function modal(kids, onClose) {
    closeModal();
    var box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, kids);
    modalEl = h('div', { class: 'modal-back', onclick: function (e) { if (e.target === modalEl) { closeModal(); if (onClose) onClose(); } } }, [box]);
    document.body.appendChild(modalEl);
    return box;
  }
  function confirmBox(msg, yes, onYes) {
    modal([
      h('h2', { text: msg }),
      h('div', { class: 'row' }, [
        btn('그만두기', '', function () { closeModal(); }, { 'data-act': 'no' }),
        btn(yes, 'primary', function () { closeModal(); onYes(); }, { 'data-act': 'yes' })
      ])
    ]);
  }
  function partOf(step) { return 'p-' + step.part; }

  /* ---------- 책장 ---------- */
  function shelf() {
    var list = h('div', { class: 'shelf', 'data-shelf': '' });
    data.books.forEach(function (b) {
      var pages = SL.buildBook(b);
      var thumb = SL.renderScene(pages[0].sc, { cover: true });
      thumb.classList.add('thumb');
      var card = h('div', { class: 'bookcard', 'data-book': b.id }, [
        h('button', { class: 'open', type: 'button', 'aria-label': '읽기', onclick: function () { read(b, 0); } }, [
          thumb,
          h('div', { class: 'meta' }, [h('div', { class: 'bt', text: b.title }), h('div', { class: 'ba', text: '지은이 ' + (b.author || '나') })])
        ]),
        btn('🗑️', 'icon del', function () {
          confirmBox('"' + b.title + '" 책을 지울까요?', '🗑️ 지우기', function () {
            data.books = data.books.filter(function (x) { return x.id !== b.id; });
            persist(); shelf();
          });
        }, { 'aria-label': '지우기' })
      ]);
      list.appendChild(card);
    });
    screen('shelf', [
      h('div', { class: 'bar' }, [
        h('div', { class: 'grow home-head' }, [h('span', { class: 'logo', text: '📚' }), h('h1', { class: 'title', text: '그림책 공방' })]),
        btn('⚙️', 'icon', settings, { 'aria-label': '설정' })
      ]),
      h('div', { class: 'scroll' }, [
        btn('✏️ 새 그림책 만들기', 'primary big new-book', worlds, { 'data-act': 'new' }),
        data.books.length ? list : h('div', { class: 'empty', text: '아직 만든 그림책이 없어요. 이야기 카드를 골라 나만의 그림책을 만들어 봐요!' })
      ])
    ]);
  }

  /* ---------- 이야기 종류 ---------- */
  function worlds() {
    var g = h('div', { class: 'grid' });
    D.WORLDS.concat([{ id: '*', ic: '🎲', t: '아무거나', d: '무엇이 나올까요?' }]).forEach(function (w) {
      g.appendChild(h('button', { class: 'card', type: 'button', 'data-world': w.id, onclick: function () {
        var id = w.id === '*' ? SL.pick(D.WORLDS).id : w.id;
        planScreen(id);
      } }, [h('span', { class: 'ce', text: w.ic }), h('span', { class: 'cn', text: w.t }), h('span', { class: 'cd', text: w.d })]));
    });
    screen('worlds', [
      h('div', { class: 'bar' }, [btn('◀', 'icon', shelf, { 'aria-label': '뒤로' }), h('h1', { class: 'title grow', text: '어떤 이야기를 만들까요?' })]),
      h('div', { class: 'scroll' }, [g])
    ]);
    speak('어떤 이야기를 만들까요?');
  }

  /* ---------- 설계도: 인물·장소·사건 수 ---------- */
  var custom = { cast: 3, places: 2, events: 2, villain: false, deco: true };
  function planScreen(ep) {
    var w = D.WORLD[ep];
    var box = h('div', { class: 'presets' });
    function statLine(cfg) {
      var e = S.estimate(cfg, ep);
      return '인물 ' + cfg.cast + ' · 장소 ' + Math.min(cfg.places, cfg.events) + ' · 사건 ' + cfg.events + (cfg.villain ? ' · 말썽꾼' : '') + '  |  고르기 ' + e.picks + '번 · 약 ' + e.pages + '쪽';
    }
    D.PRESETS.forEach(function (p) {
      box.appendChild(h('button', { class: 'card wide', type: 'button', 'data-preset': p.id, onclick: function () { start(ep, p); } }, [
        h('span', { class: 'ce', text: p.e }),
        h('span', {}, [h('div', { class: 'cn', text: p.t + ' (' + p.age + ')' }), h('div', { class: 'stat', text: statLine(p) })])
      ]));
    });
    var panel = h('div', { class: 'custom', 'data-custom': '' });
    function cfgOf() { return { cast: custom.cast, places: Math.min(custom.places, custom.events), events: custom.events, villain: custom.villain, detail: custom.deco ? D.FULL_DETAIL : {} }; }
    function drawPanel() {
      panel.textContent = '';
      function stepper(label, key, lo, hi) {
        var v = h('span', { class: 'v', text: String(custom[key]), 'data-v': key });
        return h('div', { class: 'row' }, [h('span', { class: 'lab', text: label }), h('span', { class: 'stepper' }, [
          btn('−', 'icon', function () { custom[key] = Math.max(lo, custom[key] - 1); fix(); drawPanel(); }, { 'aria-label': label + ' 줄이기' }),
          v,
          btn('+', 'icon', function () { custom[key] = Math.min(hi, custom[key] + 1); fix(); drawPanel(); }, { 'aria-label': label + ' 늘리기', 'data-plus': key })
        ])]);
      }
      function fix() { if (custom.places > custom.events) custom.places = custom.events; }
      function toggle(label, key) {
        return h('div', { class: 'row' }, [h('span', { class: 'lab', text: label }),
          btn(custom[key] ? '켜짐' : '꺼짐', 'toggle' + (custom[key] ? ' on' : ''), function () { custom[key] = !custom[key]; drawPanel(); }, { 'data-toggle': key })]);
      }
      panel.appendChild(h('div', { class: 'cn', text: '🎛️ 내 맘대로' }));
      panel.appendChild(stepper('👫 등장인물 (주인공 포함)', 'cast', 1, 4));
      panel.appendChild(stepper('🗺️ 장소', 'places', 1, 3));
      panel.appendChild(stepper('⚡ 사건', 'events', 1, 3));
      panel.appendChild(h('div', { class: 'hint', text: '장소는 사건 수보다 많을 수 없어요.' }));
      panel.appendChild(toggle('😈 말썽꾼', 'villain'));
      panel.appendChild(toggle('🎨 꾸미기 카드 (성격·물건·때·기분·결과)', 'deco'));
      panel.appendChild(h('div', { class: 'stat', text: statLine(cfgOf()) }));
      panel.appendChild(btn('▶ 이대로 시작', 'primary big', function () { start(ep, cfgOf()); }, { 'data-act': 'custom-start' }));
    }
    drawPanel();
    screen('plan', [
      h('div', { class: 'bar' }, [btn('◀', 'icon', worlds, { 'aria-label': '뒤로' }), h('h1', { class: 'title grow', text: w.ic + ' ' + w.t })]),
      h('div', { class: 'scroll' }, [h('div', { class: 'prompt', text: '얼마나 큰 이야기를 만들까요?' }), box, panel])
    ]);
    speak('얼마나 큰 이야기를 만들까요?');
  }
  function start(ep, cfg) {
    var book = S.newBook(ep, cfg);
    pick(book, 0);
  }

  /* ---------- 카드 고르기 ---------- */
  function pick(book, i) {
    var steps = S.plan(book.cfg, book.ep), step = steps[i];
    /* 앞 단계를 다시 고르면 뒤에 고른 것은 비운다 (뒤 카드의 조건이 깨질 수 있으므로) */
    steps.slice(i).forEach(function (s) { delete book.picks[s.key]; });
    var q = S.question(book, i);
    var opts = S.optionsAt(book, i);
    var dots = h('div', { class: 'dots grow', 'aria-label': (i + 1) + ' / ' + steps.length });
    steps.forEach(function (s, k) {
      dots.appendChild(h('span', { class: 'dot ' + partOf(s) + (k < i ? ' done' : '') + (k === i ? ' now' : ''), text: k < i ? S.pickEmoji(book, k) : '' }));
    });
    function choose(c) {
      book.picks[step.key] = c.id;
      if (i + 1 < steps.length) pick(book, i + 1);
      else finish(book);
    }
    var g = h('div', { class: 'grid', 'data-step': step.key });
    opts.forEach(function (c) {
      g.appendChild(h('button', { class: 'card', type: 'button', 'data-card': c.id, onclick: function () { choose(c); } }, [
        h('span', { class: 'ce', text: c.e }), h('span', { class: 'cn', text: c.n })
      ]));
    });
    screen('pick', [
      h('div', { class: 'bar' }, [
        btn('◀', 'icon', function () { if (i === 0) planScreen(book.ep); else pick(book, i - 1); }, { 'aria-label': '뒤로', 'data-act': 'back' }),
        dots,
        h('span', { class: 'chip ' + partOf(step), text: D.PART[step.part] })
      ]),
      h('div', { class: 'scroll' }, [
        h('div', { class: 'qrow' }, [h('div', { class: 'prompt', text: q }), btn('🔊', 'icon ghost', function () { speak(q); }, { 'aria-label': '질문 다시 듣기' })]),
        g
      ]),
      h('div', { class: 'bar bottom' }, [btn('🎲 골라 줘', 'blue', function () { choose(SL.pick(opts)); }, { 'data-act': 'random' })])
    ]);
    speak(q);
  }

  /* ---------- 마무리 ---------- */
  function finish(book) {
    var st = S.stateAt(book, 1);
    var titleTouched = false;
    book.author = book.author || data.author || '';
    function inp(label, max, value, ph, key) {
      return [h('label', { for: 'f-' + key, text: label }), h('input', { id: 'f-' + key, type: 'text', maxlength: String(max), value: value, placeholder: ph, autocomplete: 'off', enterkeyhint: 'done' })];
    }
    var fName = inp('주인공 이름 (안 써도 돼요, 8자까지)', 8, book.name, '예) 콩이', 'name');
    var fTitle = inp('책 제목 (24자까지)', 24, '', '', 'title');
    var fAuthor = inp('지은이 (10자까지)', 10, book.author, '예) 김하늘', 'author');
    var coverBox = h('div', { class: 'coverbox', 'data-cover': '' });
    var ct = h('div', { class: 'ct', 'data-cover-title': '' }), ca = h('div', { class: 'ca', 'data-cover-author': '' });
    var coverSc = null;
    function refresh() {
      book.name = SL.cleanInput(fName[1].value, 8);
      if (!titleTouched) fTitle[1].value = S.autoTitle(book);
      book.title = SL.cleanInput(fTitle[1].value, 24) || S.autoTitle(book);
      book.author = SL.cleanInput(fAuthor[1].value, 10);
      ct.textContent = book.title;
      ca.textContent = '지은이 ' + (book.author || '나');
      if (!coverSc) {
        var pages = S.compose(book);
        coverSc = SL.buildBook({ pages: pages })[0].sc;
        coverBox.insertBefore(SL.renderScene(coverSc, { cover: true }), coverBox.firstChild);
      }
    }
    fName[1].addEventListener('input', refresh);
    fTitle[1].addEventListener('input', function () { titleTouched = true; refresh(); });
    fAuthor[1].addEventListener('input', refresh);
    coverBox.appendChild(h('div', { class: 'covertext' }, [ct, ca]));
    screen('finish', [
      h('div', { class: 'bar' }, [btn('◀', 'icon', function () { pick(book, S.plan(book.cfg, book.ep).length - 1); }, { 'aria-label': '뒤로' }), h('h1', { class: 'title grow', text: '✨ 마무리' })]),
      h('div', { class: 'scroll' }, [h('div', { class: 'finish' }, [coverBox].concat(fName, fTitle, fAuthor, [
        h('div', { class: 'ex', text: st.hero ? '이름을 비워 두면 "' + st.hero.n + '"(이)라고 불러요.' : '' }),
        btn('📕 그림책 완성!', 'primary big', function () { complete(book); }, { 'data-act': 'complete' })
      ]))])
    ]);
    refresh();
    speak('책 제목과 지은이를 써요');
  }
  function complete(book) {
    book.at = Date.now();
    book.title = book.title || S.autoTitle(book);
    book.pages = S.compose(book);
    var keep = { id: book.id, at: book.at, ep: book.ep, cfg: book.cfg, picks: book.picks, seed: book.seed, name: book.name, ending: book.picks.ending, title: book.title, author: book.author, pages: book.pages, len: book.pages.length };
    data.author = book.author;
    data.books = [keep].concat(data.books.filter(function (b) { return b.id !== book.id; }));
    persist();
    read(keep, 0, true);
  }

  /* ---------- 읽기 ---------- */
  function read(book, startAt, auto) {
    var pages;
    try { pages = SL.buildBook(book); }
    catch (e) { console.warn('책을 열지 못했어요', e); toast('이 책을 열지 못했어요.'); shelf(); return; }
    var textCount = pages.filter(function (p) { return p.kind === 'text'; }).length;
    var idx = Math.max(0, Math.min(pages.length - 1, startAt || 0));
    var playing = false, sentEls = [], cur = -1, runId = 0, pauseTimer = null;
    var stage = h('div', { class: 'stage' });
    var pno = h('div', { class: 'pno', 'data-pno': '' });
    var playBtn = btn('🔊 읽어 주기', 'primary', function () { if (playing) stopPlay(); else startPlay(); }, { 'data-act': 'play' });
    var badge = h('span', { class: 'badge', 'data-ai': '' });
    var prevB = btn('◀', 'icon', function () { go(idx - 1); }, { 'aria-label': '앞 쪽', 'data-act': 'prev' });
    var nextB = btn('▶', 'icon', function () { go(idx + 1); }, { 'aria-label': '다음 쪽', 'data-act': 'next' });

    function label(i) { var p = pages[i]; return p.kind === 'cover' ? '표지' : p.kind === 'end' ? '끝' : i + ' / ' + textCount; }
    function sentencesOf(p) {
      if (p.kind === 'cover') return [book.title, '지은이 ' + (book.author || '나') + '.'];
      if (p.kind === 'end') return [];
      return SL.splitSentences(p.t);
    }
    function render(dir) {
      var p = pages[idx];
      stage.textContent = '';
      var pg = h('div', { class: 'pg' + (dir ? (dir > 0 ? ' flip-next' : ' flip-prev') : ''), 'data-page': String(idx), 'data-kind': p.kind });
      pg.appendChild(SL.renderScene(p.sc, { cover: p.kind === 'cover' }));
      var txt = h('div', { class: 'txt' });
      sentEls = [];
      if (p.kind === 'cover') {
        var t1 = h('div', { class: 'cover-t s', text: book.title }), t2 = h('div', { class: 'cover-a s', text: '지은이 ' + (book.author || '나') });
        sentEls = [t1, t2];
        txt.appendChild(t1); txt.appendChild(t2);
      } else if (p.kind === 'end') {
        txt.appendChild(h('div', { class: 'the-end', text: '끝' }));
        txt.appendChild(h('div', { class: 'end-btns' }, [
          btn('↺ 처음부터', '', function () { go(0); }, { 'data-act': 'again' }),
          btn('📚 책장으로', 'primary', shelf, { 'data-act': 'shelf' })
        ]));
        txt.appendChild(h('div', { class: 'legend' }, [
          h('span', { class: 'w-link', text: '파란 말' }), ' 이어 주는 말 · ', h('span', { class: 'w-mime', text: '물결 밑줄' }), ' 흉내 내는 말'
        ]));
      } else {
        sentencesOf(p).forEach(function (s, k) {
          var el = h('span', { class: 's', 'data-s': String(k) });
          SL.markWords(s).forEach(function (seg) { el.appendChild(seg.c ? h('span', { class: seg.c, text: seg.t }) : document.createTextNode(seg.t)); });
          el.addEventListener('click', function () { readOne(k); });
          sentEls.push(el);
          txt.appendChild(el);
          txt.appendChild(document.createTextNode(' '));
        });
      }
      if (p.kind === 'cover') sentEls.forEach(function (el, k) { el.addEventListener('click', function () { readOne(k); }); });
      pg.appendChild(txt);
      stage.appendChild(pg);
      pno.textContent = label(idx);
      prevB.disabled = idx === 0;
      nextB.disabled = idx === pages.length - 1;
      mark(-1);
    }
    function mark(k) {
      cur = k;
      sentEls.forEach(function (el, i) { el.classList.toggle('cur', i === k); });
      if (k >= 0 && sentEls[k] && sentEls[k].scrollIntoView) { try { sentEls[k].scrollIntoView({ block: 'nearest' }); } catch (e) { } }
    }
    function halt() { runId++; clearTimeout(pauseTimer); SL.stopSpeak(); mark(-1); }
    function stopPlay() { playing = false; halt(); playBtn.textContent = '🔊 읽어 주기'; }
    function go(i, keepPlaying) {
      if (i < 0 || i >= pages.length || i === idx) { if (!keepPlaying) halt(); return; }
      if (!keepPlaying && playing) stopPlay(); else if (!keepPlaying) halt();
      var dir = i > idx ? 1 : -1;
      idx = i;
      render(dir);
    }
    function startPlay() {
      playing = true;
      playBtn.textContent = '⏸ 멈추기';
      if (pages[idx].kind === 'end') { go(0, true); }
      playPage();
    }
    function playPage() {
      var my = ++runId;
      var list = sentencesOf(pages[idx]);
      var k = 0;
      function next() {
        if (my !== runId || !playing) return;
        if (k >= list.length) {
          mark(-1);
          if (idx >= pages.length - 1 || pages[idx + 1].kind === 'end') {
            /* 끝 쪽에서 멈춘다 */
            pauseTimer = setTimeout(function () {
              if (my !== runId || !playing) return;
              go(pages.length - 1, true);
              stopPlay();
            }, SL.ms(900));
            return;
          }
          pauseTimer = setTimeout(function () {
            if (my !== runId || !playing) return;
            go(idx + 1, true);
            playPage();
          }, SL.ms(900));
          return;
        }
        var text = list[k];
        mark(k);
        SL.prefetch(list[k + 1] || (sentencesOf(pages[idx + 1] || {})[0]), speakOpts());
        SL.say(text, speakOpts(), function () { if (my !== runId) return; k++; next(); });
      }
      next();
    }
    /* 문장을 누르면 그 문장만 읽는다 */
    function readOne(k) {
      if (playing) stopPlay(); else halt();
      var list = sentencesOf(pages[idx]);
      if (!list[k]) return;
      var my = runId;
      mark(k);
      SL.say(list[k], speakOpts(), function () { if (my === runId) mark(-1); });
    }

    /* 옆으로 밀어 넘기기: 60px 이상, 가로가 세로의 1.5배 넘을 때만 */
    var sx = 0, sy = 0, tracking = false;
    stage.addEventListener('pointerdown', function (e) { tracking = true; sx = e.clientX; sy = e.clientY; });
    stage.addEventListener('pointerup', function (e) {
      if (!tracking) return; tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(idx + (dx < 0 ? 1 : -1));
    });
    stage.addEventListener('pointercancel', function () { tracking = false; });
    function onKey(e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
      else if (e.key === 'Escape') { e.preventDefault(); shelf(); }
    }
    function onVis() { if (document.hidden) stopPlay(); }
    function updBadge() { badge.textContent = data.voice === 'ai' && SL.model.state === 'ready' ? '🤖 AI 목소리' : data.voice === 'ai' && SL.model.state === 'loading' ? '🤖 준비 중…' : ''; }
    var offModel = SL.onModel(updBadge);

    screen('read', [
      h('div', { class: 'bar' }, [btn('✕', 'icon', shelf, { 'aria-label': '책장으로', 'data-act': 'close' }), h('div', { class: 'grow title', text: book.title, style: 'font-size:19px' }), badge, playBtn]),
      stage,
      h('div', { class: 'bar bottom' }, [prevB, pno, nextB])
    ]);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
    leaveRead = function () { stopPlay(); document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis); offModel(); reading = false; };
    reading = true;
    updBadge();
    render(0);
    if (auto) startPlay();
  }

  /* ---------- 설정 ---------- */
  function settings() {
    var box;
    var status = h('div', { class: 'status', 'data-model-status': '' });
    var off = SL.onModel(function (m) { status.textContent = m.state === 'error' ? m.msg + ' (' + m.err.slice(0, 120) + ')' : m.msg; });
    function draw() {
      box.textContent = '';
      box.appendChild(h('h2', { text: '⚙️ 설정' }));
      box.appendChild(h('h3', { text: '읽는 빠르기' }));
      box.appendChild(h('div', { class: 'row' }, [[0.8, '🐢 느리게'], [1, '🙂 보통'], [1.2, '🐇 빠르게']].map(function (r) {
        return btn(r[1], data.rate === r[0] ? 'on' : '', function () { data.rate = r[0]; persist(); draw(); speak('이 빠르기로 읽어 줄게요.'); }, { 'data-rate': String(r[0]) });
      })));
      box.appendChild(h('h3', { text: '목소리' }));
      box.appendChild(h('div', { class: 'row' }, [
        btn('📱 기기 목소리', data.voice === 'device' ? 'on' : '', function () { data.voice = 'device'; persist(); draw(); }, { 'data-voice': 'device' }),
        btn('🤖 AI 목소리', data.voice === 'ai' ? 'on' : '', function () {
          data.voice = 'ai'; persist(); draw();
          SL.loadModel().then(function () { speak('안녕! 그림책 공방이에요.'); }).catch(function () { });
        }, { 'data-voice': 'ai' })
      ]));
      var vi = SL.voiceInfo();
      if (data.voice === 'device') {
        box.appendChild(h('p', { class: 'small', text: vi.local ? '이 기기 안의 한국어 목소리로 읽어요. (' + vi.picked + ')' : vi.ko ? '기기 안 한국어 목소리가 없어 인터넷 목소리를 써요. 기기 설정에서 한국어 음성을 내려받으면 인터넷 없이 읽을 수 있어요.' : '한국어 목소리를 찾지 못했어요. 기기 설정에서 한국어 음성을 설치해 주세요. 설치 전에는 글자만 짚어 줘요.' }));
      } else {
        box.appendChild(h('p', { class: 'small', text: 'AI 목소리는 컴퓨터가 만든 목소리예요. 처음 한 번 약 180MB를 내려받고(Wi-Fi 권장), 그 뒤에는 인터넷 없이 이 기기 안에서 읽어요.' }));
        box.appendChild(status);
        var names = { F1: '여자 1', F2: '여자 2', F3: '여자 3', F4: '여자 4', F5: '여자 5', M1: '남자 1', M2: '남자 2', M3: '남자 3', M4: '남자 4', M5: '남자 5' };
        box.appendChild(h('div', { class: 'row' }, Object.keys(names).map(function (k) {
          return btn(names[k], data.style === k ? 'on' : '', function () { data.style = k; persist(); draw(); if (SL.model.state === 'ready') speak('안녕! 이 목소리로 읽어 줄게요.'); }, { 'data-style': k });
        })));
        if (SL.model.state === 'off' || SL.model.state === 'error') SL.loadModel().catch(function () { });
      }
      box.appendChild(btn('🔊 미리 듣기', '', function () { speak('옛날 옛적, 작은 마을에 토끼가 살았어요.'); }));
      box.appendChild(h('h3', { text: '알아 두세요' }));
      box.appendChild(h('p', { class: 'small', text: '만든 책은 이 기기의 브라우저 안에만 저장돼요. 브라우저 기록을 지우면 책도 지워져요.' }));
      box.appendChild(h('p', { class: 'small', text: '그림은 이모지로 그려서 기기(아이패드·안드로이드·윈도우)마다 조금씩 다르게 보여요.' }));
      box.appendChild(h('p', { class: 'small' }, ['AI 목소리: Supertonic 3 (Supertone Inc., ', h('a', { href: 'licenses/OpenRAIL-M.txt', target: '_blank', rel: 'noopener', text: 'OpenRAIL-M' }), ') · 음성 엔진: ONNX Runtime Web (', h('a', { href: 'licenses/onnxruntime-MIT.txt', target: '_blank', rel: 'noopener', text: 'MIT' }), ')']));
      box.appendChild(h('div', { class: 'row' }, [btn('닫기', 'primary', function () { closeModal(); off(); }, { 'data-act': 'close-settings' })]));
      status.textContent = SL.model.state === 'error' ? SL.model.msg + ' (' + SL.model.err.slice(0, 120) + ')' : SL.model.msg;
    }
    box = modal([], off);
    draw();
  }

  /* ---------- 시작 ---------- */
  /* 두 손가락 확대로 화면이 망가지지 않게 (iOS) */
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
  /* visualViewport 로 높이를 한 번 더 맞춘다 (주소창·키보드) */
  if (window.visualViewport) {
    var fitVV = function () { document.documentElement.style.setProperty('--app-h', Math.round(window.visualViewport.height) + 'px'); document.documentElement.classList.add('vv'); };
    window.visualViewport.addEventListener('resize', fitVV);
    fitVV();
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { }); } catch (e) { }
  if (data.voice === 'ai') SL.loadModel().catch(function () { });

  /* 오프라인 캐시. 새 버전이 오면 읽는 중이 아닐 때만 새로 고친다 */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch(function (e) { console.warn('오프라인 준비 실패', e); });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      if (reading) pendingReload = true; else location.reload();
    });
  }

  /* 테스트에서 화면을 직접 부를 수 있게 */
  SL.ui = { shelf: shelf, worlds: worlds, plan: planScreen, read: read, data: function () { return data; }, reload: function () { data = SL.store.load(); } };
  shelf();
})(window.SL);
