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
    screenOffs.splice(0).forEach(function (off) { try { off(); } catch (e) { } });
    SL.stopSpeak();
    closeModal();
    app.textContent = '';
    var s = h('div', { class: 'screen scr-' + name, 'data-screen': name }, kids);
    app.appendChild(s);
    if (pendingReload && name !== 'read') { location.reload(); }
    return s;
  }
  function speakOpts() { return { rate: data.rate, style: data.style }; }
  /* 화면을 바꿀 때 풀어 줄 구독 (AI 목소리 상태 등) */
  var screenOffs = [];
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

  /* ---------- 상단바 (ai-lab 과 같은 구성: 로고·서비스명 | 메뉴 탭 | 상태·설정·전체 화면) ---------- */
  function labHeader(active) {
    function nav(label, on, key) {
      return h('button', { type: 'button', class: 'navlink' + (active === key ? ' on' : ''), 'data-nav': key, onclick: on }, [label]);
    }
    var voiceBtn = h('button', { type: 'button', class: 'hbtn wide', 'data-ic': '🎙️', 'data-voice-state': '', 'aria-label': 'AI 목소리', onclick: settings });
    function upd() {
      var st = SL.model.state;
      voiceBtn.textContent = st === 'ready' ? '🎙️ AI 목소리' : st === 'loading' ? '🎙️ ' + (SL.model.pct || 0) + '%' : '🔇 목소리 준비';
      voiceBtn.classList.toggle('off', st !== 'ready');
      voiceBtn.setAttribute('data-ic', st === 'ready' ? '🎙️' : '🔇');
    }
    screenOffs.push(SL.onModel(upd)); upd();
    var fsBtn = h('button', { type: 'button', class: 'hbtn', 'aria-label': '전체 화면', title: '전체 화면', onclick: function () {
      try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { }
    } }, ['⛶']);
    return h('header', { class: 'lab' }, [
      h('h1', {}, [h('button', { type: 'button', class: 'brand', 'aria-label': '처음 화면', onclick: shelf }, [h('img', { src: 'img/pibo-logo.png', alt: '' }), h('span', { class: 'brand-txt', text: '그림책 공방' })])]),
      nav('만들기', worlds, 'make'), nav('책장', shelfPage, 'shelf'), nav('국어 놀이', learnHub, 'learn'),
      h('span', { class: 'grow' }),
      voiceBtn,
      h('button', { type: 'button', class: 'hbtn', 'aria-label': '설정', title: '설정', onclick: settings }, ['⚙']),
      document.documentElement.requestFullscreen ? fsBtn : null
    ]);
  }
  /* 만들기 단계 표시줄 (킷 .steps): 1 이야기 상자 · 2 설계도 · 3 이야기 카드 · 4 제본 · 5 읽기 */
  var MAKE_STEPS = ['이야기 상자', '설계도', '이야기 카드', '제본', '읽기'];
  function stepsBar(now, back, actname) {
    var bar = h('div', { class: 'steps lab' }, [back ? btn('◀', 'icon ghost back', back, { 'aria-label': '뒤로', 'data-act': 'back' }) : null, actname ? h('span', { class: 'actname', text: actname }) : null]);
    MAKE_STEPS.forEach(function (n, i) {
      if (i) bar.appendChild(h('span', { class: 'stpline' }));
      bar.appendChild(h('span', { class: 'stp' + (i === now ? ' on' : i < now ? ' done' : '') }, [h('span', { class: 'cir', text: i < now ? '✓' : String(i + 1) }), h('span', { class: 'stt', text: n })]));
    });
    return bar;
  }
  function backBtn(on, label) { return btn('◀', 'icon', on, { 'aria-label': label || '뒤로', 'data-act': 'back' }); }
  function bookCell(b) {
    var pages = SL.buildBook(b);
    return h('div', { class: 'book', 'data-book': b.id }, [
      h('button', { class: 'open', type: 'button', 'aria-label': b.title + ' 읽기', onclick: function () { read(b, 0); } }, [
        h('div', { class: 'cover' }, [SL.renderScene(pages[0].sc, { cover: true })]),
        h('div', { class: 'bt', text: b.title }),
        h('div', { class: 'ba', text: b.author ? '지은이 ' + b.author : '내가 만든 그림책' })
      ]),
      btn('🗑', 'icon del', function () {
        confirmBox('"' + b.title + '" 책을 지울까요?', '지우기', function () {
          data.books = data.books.filter(function (x) { return x.id !== b.id; });
          persist(); shelf();
        });
      }, { 'aria-label': b.title + ' 지우기' })
    ]);
  }
  function needBook(fn) {
    if (!data.books.length) { toast('먼저 그림책을 하나 만들어요.'); worlds(); return; }
    fn(data.books[0]);
  }

  /* ---------- 첫 화면: 그림책 학습지 (1 이야기 짓기 · 2 내 책장 · 3 국어 놀이) ---------- */
  function shelf() {
    var worldCells = h('div', { class: 'cells four' });
    D.WORLDS.forEach(function (w, i) {
      var c = h('button', { type: 'button', class: 'cell', 'data-home-world': w.id, onclick: function () { planScreen(w.id); } }, [h('span', { class: 'ce', text: w.ic, 'aria-hidden': 'true' }), h('b', { text: w.t }), h('small', { text: w.d })]);
      if (i === 0 && !data.books.length) { c.appendChild(SL.ring()); c.appendChild(h('span', { class: 'note redpen', text: '여기서 시작!' })); }
      worldCells.appendChild(c);
    });
    var books = h('div', { class: 'cells', 'data-shelf': '' });
    data.books.slice(0, 6).forEach(function (b) { books.appendChild(bookCell(b)); });
    if (!data.books.length) books.appendChild(h('div', { class: 'shelf-empty', text: '아직 만든 그림책이 없어요. 1번 줄에서 이야기 상자를 골라 첫 그림책을 만들어 봐요.' }));
    var learn = h('div', { class: 'cells' }, [
      ['echo', '따라 읽기', '한 문장씩 듣고 따라 읽어요', function () { needBook(function (b) { read(b, 0, true, { echo: true }); }); }, 'learn-echo'],
      ['words', '낱말장', '흉내 내는 말 · 이어 주는 말', wordBook, 'learn-words'],
      ['map', '이야기 지도', '처음 · 사건 · 해결 · 끝', function () { needBook(storyMap); }, 'learn-map'],
      ['quiz', '이야기 돌아보기', '누가? 어디서? 어떻게?', function () { needBook(quiz); }, 'learn-quiz']
    ].map(function (x) { return h('button', { type: 'button', class: 'cell', 'data-act': x[4], onclick: x[3] }, [SL.icon(x[0]), h('b', { text: x[1] }), h('small', { text: x[2] })]); }));
    var sheet = h('div', { class: 'sheet' }, [
      h('div', { class: 'sheet-top' }, [h('h2', { text: '그림책 학습지' }), h('p', { text: '이야기를 짓고, 그림책으로 만들고, 소리 내어 읽어요.' }),
        h('div', { class: 'nm' }, [h('label', {}, ['이름', h('span', {})]), h('label', {}, ['날짜', h('span', {})])])]),
      SL.model.state === 'ready' ? null : voicePanel(false),
      h('div', { class: 'rows' }, [
        h('div', { class: 'srow c-red' }, [h('div', { class: 'slab' }, [h('span', { class: 'no', text: '1' }), h('div', {}, [h('b', { text: '이야기 짓기' }), h('small', { text: '이야기 상자를 고르면 카드로 이야기를 지어요.' }),
          btn('✏️ 새 그림책', 'primary', worlds, { 'data-act': 'new', style: 'margin-top:10px' })])]), worldCells]),
        h('div', { class: 'srow c-green' }, [h('div', { class: 'slab' }, [h('span', { class: 'no', text: '2' }), h('div', {}, [h('b', { text: '내 책장' }), h('small', { text: '만든 그림책을 눌러 읽어요.' }),
          h('em', { text: data.books.length ? data.books.length + '권' : '비어 있어요' })])]), books]),
        h('div', { class: 'srow c-blue' }, [h('div', { class: 'slab' }, [h('span', { class: 'no', text: '3' }), h('div', {}, [h('b', { text: '국어 놀이' }), h('small', { text: '내가 만든 책으로 말을 익혀요.' }),
          h('em', { text: '최근 책으로' })])]), learn])
      ])
    ]);
    screen('shelf', [labHeader(''), h('div', { class: 'scroll' }, [h('div', { class: 'sheet-wrap' }, [sheet])])]);
  }
  /* 책장 (전체 목록) */
  function shelfPage() {
    var books = h('div', { class: 'cells', 'data-shelf': '' });
    data.books.forEach(function (b) { books.appendChild(bookCell(b)); });
    if (!data.books.length) books.appendChild(h('div', { class: 'shelf-empty', text: '아직 만든 그림책이 없어요.' }));
    screen('shelfpage', [labHeader('shelf'), h('div', { class: 'scroll' }, [h('div', { class: 'sheet-wrap' }, [h('div', { class: 'sheet' }, [
      h('div', { class: 'sheet-top' }, [h('h2', { text: '내 책장' }), h('p', { text: data.books.length ? '그림책 ' + data.books.length + '권 · 눌러서 읽어요.' : '책을 만들면 여기에 꽂혀요.' })]),
      books
    ])])])]);
  }

  /* ---------- 1. 이야기 상자 ---------- */
  function worlds() {
    var cells = h('div', { class: 'cells four' });
    D.WORLDS.concat([{ id: '*', ic: '🎲', t: '아무거나', d: '무엇이 나올까요?' }]).forEach(function (w) {
      cells.appendChild(h('button', { class: 'cell', type: 'button', 'data-world': w.id, onclick: function () {
        planScreen(w.id === '*' ? SL.pick(D.WORLDS).id : w.id);
      } }, [h('span', { class: 'ce', text: w.ic, 'aria-hidden': 'true' }), h('b', { text: w.t }), h('small', { text: w.d })]));
    });
    screen('worlds', [labHeader('make'), stepsBar(0, shelf), h('div', { class: 'scroll' }, [h('div', { class: 'sheet-wrap' }, [h('div', { class: 'sheet' }, [
      h('div', { class: 'sheet-top' }, [h('h2', { text: '이야기 상자' }), h('p', { text: '어떤 이야기를 만들까요? 상자마다 장소·친구·사건 카드가 달라요.' })]),
      h('div', { class: 'rows' }, [h('div', { class: 'srow c-red', style: 'grid-template-columns:1fr' }, [cells])])
    ])])])]);
    speak('어떤 이야기를 만들까요?');
  }

  /* ---------- 2. 설계도: 인물·장소·사건 수 ---------- */
  var custom = { cast: 3, places: 2, events: 2, villain: false, deco: true };
  function planScreen(ep) {
    var w = D.WORLD[ep];
    function statLine(cfg) {
      var e = S.estimate(cfg, ep);
      return '인물 ' + cfg.cast + ' · 장소 ' + Math.min(cfg.places, cfg.events) + ' · 사건 ' + cfg.events + (cfg.villain ? ' · 말썽꾼' : '') + ' — 카드 ' + e.picks + '장, 약 ' + e.pages + '쪽';
    }
    var rows = h('div', { class: 'plan-rows' });
    D.PRESETS.forEach(function (p) {
      rows.appendChild(h('button', { class: 'mradio', type: 'button', 'data-preset': p.id, onclick: function () { start(ep, p); } }, [
        h('span', { class: 'ce', text: p.e, 'aria-hidden': 'true' }), h('span', { class: 'nm', text: p.t + ' · ' + p.age }), h('span', { class: 'mt', text: statLine(p) })
      ]));
    });
    var dials = h('div', { class: 'dials', 'data-custom': '' });
    function cfgOf() { return { cast: custom.cast, places: Math.min(custom.places, custom.events), events: custom.events, villain: custom.villain, detail: custom.deco ? D.FULL_DETAIL : {} }; }
    function drawDials() {
      dials.textContent = '';
      function fix() { if (custom.places > custom.events) custom.places = custom.events; }
      function stepper(label, key, lo, hi) {
        return h('div', { class: 'row' }, [h('span', { class: 'lab', text: label }), h('span', { class: 'stepper' }, [
          btn('−', 'icon', function () { custom[key] = Math.max(lo, custom[key] - 1); fix(); drawDials(); }, { 'aria-label': label + ' 줄이기', disabled: custom[key] <= lo }),
          h('span', { class: 'v', text: String(custom[key]), 'data-v': key, 'aria-live': 'polite' }),
          btn('+', 'icon', function () { custom[key] = Math.min(hi, custom[key] + 1); fix(); drawDials(); }, { 'aria-label': label + ' 늘리기', 'data-plus': key, disabled: custom[key] >= hi })
        ])]);
      }
      function toggle(label, key) {
        return h('div', { class: 'row' }, [h('span', { class: 'lab', text: label }),
          btn(custom[key] ? '켜짐' : '꺼짐', 'toggle' + (custom[key] ? ' on' : ''), function () { custom[key] = !custom[key]; drawDials(); }, { 'data-toggle': key, 'aria-pressed': custom[key] ? 'true' : 'false' })]);
      }
      dials.appendChild(stepper('등장인물 (주인공 포함)', 'cast', 1, 4));
      dials.appendChild(stepper('장소', 'places', 1, 3));
      dials.appendChild(stepper('사건', 'events', 1, 3));
      dials.appendChild(h('div', { class: 'stat', text: '장소는 사건 수보다 많을 수 없어요.' }));
      dials.appendChild(toggle('말썽꾼', 'villain'));
      dials.appendChild(toggle('꾸미기 카드 (성격·물건·때·기분·결과)', 'deco'));
      dials.appendChild(h('div', { class: 'note-box', text: statLine(cfgOf()) }));
      dials.appendChild(btn('이 설계로 시작', 'primary big block', function () { start(ep, cfgOf()); }, { 'data-act': 'custom-start' }));
    }
    drawDials();
    screen('plan', [labHeader('make'), stepsBar(1, worlds, w.t), h('div', { class: 'scroll' }, [h('div', { class: 'sheet-wrap' }, [h('div', { class: 'sheet' }, [
      h('div', { class: 'sheet-top' }, [h('h2', { text: '이야기 설계도' }), h('p', { text: '인물·장소·사건이 많을수록 이야기가 길어지고 갈래가 많아져요.' })]),
      h('div', { class: 'plan-grid', style: 'padding-top:12px' }, [
        h('div', {}, [h('div', { class: 'pb-label', style: 'font-size:15px;margin-top:6px', text: '나이에 맞게 고르기' }), rows]),
        h('div', { class: 'pan lab', style: 'margin-top:16px' }, [h('div', { class: 'ph', text: '내 맘대로 설계' }), h('div', { class: 'pb' }, [dials])])
      ])
    ])])])]);
    speak('얼마나 큰 이야기를 만들까요?');
  }
  function start(ep, cfg) { pick(S.newBook(ep, cfg), 0); }

  /* 원고: 지금까지 고른 카드로 만든 쪽을 원고지에 보여 준다 */
  function manuscript(book, i) {
    var pages = S.draft(book, i);
    var paper = h('div', { class: 'ms-paper', 'aria-label': '지금까지 쓴 이야기' });
    if (!pages.length) paper.appendChild(h('div', { class: 'ms-empty', text: '카드를 고르면 여기에 이야기가 한 줄씩 써져요.' }));
    pages.forEach(function (p, k) { paper.appendChild(h('p', { class: 'ms-p p-' + p.part + (k === pages.length - 1 ? ' last' : ''), text: SL.splitEmoji(p.t).text })); });
    var last = pages.length ? SL.splitEmoji(pages[pages.length - 1].t).text : '카드를 고르면 이야기가 써져요.';
    return {
      box: h('aside', { class: 'pan lab pan-side' }, [h('div', { class: 'ph', text: '원고 — 지금까지 쓴 이야기' }), h('div', { class: 'pb', style: 'padding:0' }, [paper])]),
      strip: h('div', { class: 'ms-strip' }, [h('span', { class: 'lab', text: '원고' }), h('span', { class: 'txt', text: last })])
    };
  }

  /* ---------- 3. 이야기 카드 고르기 (카드로 / 순서도로 — 보기는 옵션) ---------- */
  var KIND_N = { hero: '주인공', trait: '성격', goal: '바람', item: '가방 속 물건', time: '때', place: '장소', move: '다음 장소', meet: '친구', vil: '말썽꾼', ev: '사건', vev: '말썽꾼이 한 일', feel: '기분', sol: '해결', who: '범인', outcome: '바람의 결과', ending: '마지막 장면' };
  var pickView = 'cards';
  function chosenName(book, k) {
    var steps = S.plan(book.cfg, book.ep), id = book.picks[steps[k].key];
    if (id == null) return '';
    var all = S.allOptionsAt(book, k);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i].n;
    return '';
  }
  function flowView(book, i) {
    var steps = S.plan(book.cfg, book.ep), box = h('div', { class: 'flow', 'data-flow': '' }), lastPart = '';
    box.appendChild(h('div', { class: 'seq-node', text: '이야기 시작' }));
    steps.forEach(function (s, k) {
      box.appendChild(h('div', { class: 'seq-arrow' }));
      if (s.part !== lastPart) { box.appendChild(h('div', { class: 'fpart p-' + s.part, text: D.PART[s.part] })); lastPart = s.part; }
      var done = k < i, now = k === i;
      var el = h('button', { type: 'button', class: 'fstep p-' + s.part + (now ? ' now' : '') + (k > i ? ' todo' : ''), 'data-flow-step': s.key, disabled: k > i ? true : null, onclick: function () {
        if (now) { pickView = 'cards'; pick(book, i); return; }
        if (done) { if (k < i - 1) toast('이 카드를 다시 고르면, 뒤의 카드도 다시 골라요.'); pick(book, k); }
      } }, [
        h('span', { class: 'fe', text: done ? S.pickEmoji(book, k) : now ? '✏️' : '·' }),
        h('span', { class: 'grow' }, [h('div', { class: 'fk', text: KIND_N[s.kind] }), h('div', { class: 'fn', text: done ? chosenName(book, k) : now ? '지금 고를 차례예요' : '아직 안 골랐어요' })])
      ]);
      box.appendChild(el);
    });
    box.appendChild(h('div', { class: 'seq-arrow' }));
    box.appendChild(h('div', { class: 'seq-node', text: '그림책 완성' }));
    return box;
  }
  function pick(book, i) {
    var steps = S.plan(book.cfg, book.ep), step = steps[i];
    /* 앞 단계를 다시 고르면 뒤에 고른 것은 비운다 (뒤 카드의 조건이 깨질 수 있으므로) */
    steps.slice(i).forEach(function (s) { delete book.picks[s.key]; });
    var q = S.question(book, i);
    var opts = S.optionsAt(book, i);
    var dots = h('div', { class: 'dots grow', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(i + 1), 'aria-label': '카드 ' + (i + 1) + ' / ' + steps.length });
    steps.forEach(function (s, k) { dots.appendChild(h('span', { class: 'dot ' + partOf(s) + (k < i ? ' done' : '') + (k === i ? ' now' : ''), text: k < i ? S.pickEmoji(book, k) : '' })); });
    function choose(c) {
      book.picks[step.key] = c.id;
      if (step.kind === 'hero') nameScreen(book, c, i + 1);
      else if (i + 1 < steps.length) pick(book, i + 1);
      else finish(book);
    }
    var g = h('div', { class: 'grid', 'data-step': step.key });
    opts.forEach(function (c) {
      g.appendChild(h('button', { class: 'card ' + partOf(step), type: 'button', 'data-card': c.id, onclick: function () { choose(c); } }, [
        h('span', { class: 'ce', text: c.e, 'aria-hidden': 'true' }), h('span', { class: 'cn', text: c.n })
      ]));
    });
    var ms = manuscript(book, i);
    var body = pickView === 'flow' ? flowView(book, i) : g;
    screen('pick', [
      labHeader('make'),
      stepsBar(2, function () { if (i === 0) planScreen(book.ep); else pick(book, i - 1); }, D.WORLD[book.ep].t),
      ms.strip,
      h('div', { class: 'mk-main lab pick-main' }, [
        ms.box,
        h('main', { class: 'pan lab pan-wide' }, [
          h('div', { class: 'q' }, [h('span', { class: 'chip ' + partOf(step), text: D.PART[step.part] }), h('div', { class: 'qt', text: q }), btn('🔊', 'icon', function () { speak(q); }, { 'aria-label': '질문 다시 듣기' })]),
          h('div', { style: 'padding:0 16px 6px' }, [dots]),
          h('div', { class: 'pb' }, [body])
        ])
      ]),
      h('div', { class: 'bar' }, [
        btn('🃏 카드로', pickView === 'cards' ? 'on' : '', function () { pickView = 'cards'; pick(book, i); }, { 'data-act': 'view-cards', 'aria-pressed': pickView === 'cards' ? 'true' : 'false' }),
        btn('🔀 순서도로', pickView === 'flow' ? 'on' : '', function () { pickView = 'flow'; pick(book, i); }, { 'data-act': 'view-flow', 'aria-pressed': pickView === 'flow' ? 'true' : 'false' }),
        h('span', { class: 'sp' }),
        btn('🎲 골라 줘', 'blue', function () { choose(SL.pick(opts)); }, { 'data-act': 'random' })
      ])
    ]);
    var msp = document.querySelector('.pan-side .pb');
    if (msp) msp.scrollTop = msp.scrollHeight;
    speak(q);
  }

  /* ---------- 이름표: 주인공을 고른 바로 다음 ---------- */
  function nameScreen(book, hero, next) {
    var input = h('input', { id: 'f-hero-name', class: 'tagline', type: 'text', maxlength: '8', value: book.name || '', placeholder: '이름 쓰기', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': '주인공 이름' });
    var preview = h('div', { class: 'who', 'data-name-preview': '' });
    function upd() {
      var n = SL.cleanInput(input.value, 8);
      preview.textContent = n ? '"옛날 옛적에 ' + SL.J(hero.n + ' ' + n, '이/가') + ' 살았어요."' : '이름이 없으면 "' + hero.n + '"(이)라고 불러요. (8자까지)';
    }
    function go(useName) { book.name = useName ? SL.cleanInput(input.value, 8) : ''; pick(book, next); }
    input.addEventListener('input', upd);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(true); } });
    screen('name', [labHeader('make'), stepsBar(2, function () { pick(book, next - 1); }, D.WORLD[book.ep].t), h('div', { class: 'scroll' }, [h('div', { class: 'sheet-wrap' }, [h('div', { class: 'sheet' }, [
      h('div', { class: 'sheet-top' }, [h('h2', { text: '이름표' }), h('p', { text: hero.n + '의 이름을 지어 줄까요?' })]),
      h('div', { class: 'nametag form', style: 'padding-top:18px;width:100%' }, [
        h('div', { class: 'face', text: hero.e, 'aria-hidden': 'true' }),
        h('span', { class: 'redpen', style: 'justify-self:center', text: '안녕, 내 이름은' }),
        input, preview,
        btn('이 이름으로 할래요', 'primary big block', function () { go(true); }, { 'data-act': 'name-ok' }),
        btn('이름 없이 할래요', 'block', function () { go(false); }, { 'data-act': 'name-skip' })
      ])
    ])])])]);
    upd();
    speak(hero.n + '의 이름을 지어 줄까요?');
  }

  /* ---------- 4. 제본 ---------- */
  function finish(book) {
    var st = S.stateAt(book, 1);
    var titleTouched = false;
    book.author = book.author || data.author || '';
    function inp(label, max, value, ph, key) {
      return [h('label', { for: 'f-' + key, text: label }), h('input', { id: 'f-' + key, type: 'text', maxlength: String(max), value: value, placeholder: ph, autocomplete: 'off', enterkeyhint: 'done' })];
    }
    var fName = inp('주인공 이름 (8자까지, 안 써도 돼요)', 8, book.name, '예) 콩이', 'name');
    var fTitle = inp('책 제목 (24자까지)', 24, '', '', 'title');
    var fAuthor = inp('지은이 (10자까지)', 10, book.author, '예) 김하늘', 'author');
    var mock = h('div', { class: 'bookmock', 'data-cover': '' });
    var ct = h('div', { class: 'ct', 'data-cover-title': '' }), ca = h('div', { class: 'ca', 'data-cover-author': '' });
    mock.appendChild(SL.renderScene(SL.buildBook({ pages: S.compose(book) })[0].sc, { cover: true }));
    mock.appendChild(h('div', { class: 'plate' }, [ct, ca]));
    function refresh() {
      book.name = SL.cleanInput(fName[1].value, 8);
      if (!titleTouched) fTitle[1].value = S.autoTitle(book);
      book.title = SL.cleanInput(fTitle[1].value, 24) || S.autoTitle(book);
      book.author = SL.cleanInput(fAuthor[1].value, 10);
      ct.textContent = book.title;
      ca.textContent = book.author ? '지은이 ' + book.author : '지은이 칸을 채워 봐요';
    }
    fName[1].addEventListener('input', refresh);
    fTitle[1].addEventListener('input', function () { titleTouched = true; refresh(); });
    fAuthor[1].addEventListener('input', refresh);
    screen('finish', [labHeader('make'), stepsBar(3, function () { pick(book, S.plan(book.cfg, book.ep).length - 1); }, D.WORLD[book.ep].t), h('div', { class: 'scroll' }, [h('div', { class: 'sheet-wrap' }, [h('div', { class: 'sheet' }, [
      h('div', { class: 'sheet-top' }, [h('h2', { text: '제본하기' }), h('p', { text: '표지를 꾸미면 그림책이 완성돼요.' })]),
      h('div', { class: 'bind', style: 'padding-top:16px' }, [
        mock,
        h('div', { class: 'form' }, fName.concat(fTitle, fAuthor, [
          h('div', { class: 'ex', text: st.hero ? '이름을 비워 두면 "' + st.hero.n + '"(이)라고 불러요. 지은이는 다음에도 기억해 둘게요.' : '' }),
          btn('📕 그림책 완성!', 'primary big block', function () { complete(book); }, { 'data-act': 'complete' })
        ]))
      ])
    ])])])]);
    refresh();
    speak('표지를 꾸며요. 책 제목과 지은이를 써요');
  }

  /* ---------- 국어 놀이 ---------- */
  function learnHub() {
    var cells = h('div', { class: 'cells' }, [
      ['echo', '따라 읽기', '한 문장씩 듣고, 따라 읽을 시간을 줘요', function () { needBook(function (b) { read(b, 0, true, { echo: true }); }); }, 'learn-echo'],
      ['words', '낱말장', '내 책에 나온 흉내 내는 말 · 이어 주는 말 · 마음 낱말', wordBook, 'learn-words'],
      ['map', '이야기 지도', '처음 · 사건 · 해결 · 끝을 한 장에', function () { needBook(storyMap); }, 'learn-map'],
      ['quiz', '이야기 돌아보기', '누가? 어디서? 무슨 일? 어떻게?', function () { needBook(quiz); }, 'learn-quiz']
    ].map(function (x) { return h('button', { type: 'button', class: 'cell', 'data-act': x[4], onclick: x[3] }, [SL.icon(x[0]), h('b', { text: x[1] }), h('small', { text: x[2] })]); }));
    screen('learn', [labHeader('learn'), h('div', { class: 'scroll' }, [h('div', { class: 'sheet-wrap' }, [h('div', { class: 'sheet c-blue' }, [
      h('div', { class: 'sheet-top' }, [h('h2', { text: '국어 놀이' }), h('p', { text: data.books.length ? '가장 최근에 만든 "' + data.books[0].title + '"(으)로 해요.' : '먼저 그림책을 만들면 할 수 있어요.' })]),
      h('div', { class: 'rows' }, [h('div', { class: 'srow', style: 'grid-template-columns:1fr' }, [cells])])
    ])])])]);
  }
  function bookPicker(cur, go) {
    var sel = h('select', { 'aria-label': '책 고르기', 'data-book-pick': '' });
    data.books.forEach(function (b) { var o = h('option', { value: b.id, text: b.title }); if (b.id === cur.id) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { var b = data.books.filter(function (x) { return x.id === sel.value; })[0]; if (b) go(b); });
    return h('div', { class: 'pickbook' }, [h('span', { class: 'stat', text: '책' }), sel]);
  }
  function learnFrame(name, title, sub, kids) {
    screen(name, [labHeader('learn'), h('div', { class: 'scroll' }, [h('div', { class: 'sheet-wrap' }, [h('div', { class: 'sheet' }, [
      h('div', { class: 'sheet-top' }, [h('h2', { text: title }), h('p', { text: sub })]),
      h('div', { class: 'learn', style: 'padding-top:14px' }, kids)
    ])])])]);
  }
  /* 낱말장: 내 책들에 나온 흉내 내는 말 · 이어 주는 말 · 마음 낱말을 모은다 (누르면 낱말과 예문을 읽어 준다) */
  function wordBook() {
    var groups = { 'w-mime': {}, 'w-link': {} }, feels = {};
    data.books.forEach(function (b) {
      (b.pages || []).forEach(function (p) {
        SL.splitSentences(SL.splitEmoji(p.t).text).forEach(function (s) {
          SL.markWords(s).forEach(function (seg) {
            if (!seg.c) return;
            var g = groups[seg.c], w = g[seg.t] || (g[seg.t] = { n: 0, ex: s });
            w.n++;
          });
        });
      });
      Object.keys(b.picks || {}).forEach(function (k) {
        if (k.indexOf('feel') !== 0) return;
        var f = D.FEELS.filter(function (x) { return x.id === b.picks[k]; })[0];
        if (f) { var w = feels[f.n] || (feels[f.n] = { n: 0, ex: SL.fmt(f.t, { H: b.name || '주인공' }) }); w.n++; }
      });
    });
    function section(cls, title, sub, map) {
      var keys = Object.keys(map).sort(function (a, b) { return map[b].n - map[a].n; });
      var grid = h('div', { class: 'words' }, keys.map(function (w) {
        return h('button', { type: 'button', class: 'word', 'data-word': w, onclick: function () { speak(w + '. ' + map[w].ex); } }, [h('b', {}, [w, h('span', { class: 'n', text: map[w].n + '번' })]), h('span', { text: map[w].ex })]);
      }));
      return h('div', { class: 'wordbook ' + cls }, [h('h3', {}, [title, h('small', { text: sub })]), keys.length ? grid : h('div', { class: 'stat', text: '아직 없어요. 책을 더 만들어 봐요.' })]);
    }
    learnFrame('words', '낱말장', data.books.length ? '내 그림책 ' + data.books.length + '권에서 모았어요. 낱말을 누르면 예문과 함께 읽어 줘요.' : '그림책을 만들면 낱말이 모여요.', [
      section('c-red', '흉내 내는 말', '소리나 모양을 흉내 내요 (물결 밑줄)', groups['w-mime']),
      section('c-blue', '이어 주는 말', '문장과 문장을 이어 줘요 (파란 글자)', groups['w-link']),
      section('c-green', '마음 낱말', '주인공의 마음을 나타내요', feels)
    ]);
    speak('낱말장이에요. 낱말을 누르면 읽어 줄게요.');
  }
  /* 이야기 지도: 처음 · 사건 · 해결 · 끝 네 칸에 쪽을 나눠 담는다 */
  function storyMap(book) {
    var pages = SL.buildBook(book).filter(function (p) { return p.kind === 'text'; });
    var st = S.stateAt(book, S.plan(book.cfg, book.ep).length);
    var who = { start: '주인공: ' + (book.name || st.hero.n) + (st.goal ? ' · 바람: ' + st.goal.n : ''), event: st.vil ? '말썽꾼: ' + st.vil.n : '친구: ' + (st.friends.filter(function (f) { return !f.villain; }).map(function (f) { return f.n; }).join(', ') || '없음'), solve: '', end: '' };
    var cols = ['start', 'event', 'solve', 'end'].map(function (part, i) {
      var list = pages.filter(function (p) { return p.part === part; });
      return h('div', { class: 'p-' + part, 'data-map-part': part }, [h('h4', {}, [h('span', { class: 'no', text: String(i + 1) }), D.PART[part]])].concat(list.map(function (p) {
        var first = SL.splitSentences(p.t)[0] || p.t;
        return h('button', { type: 'button', class: 'mp', onclick: function () { speak(p.t); } }, [first]);
      }), [who[part] ? h('div', { class: 'who', text: who[part] }) : null]));
    });
    learnFrame('map', '이야기 지도', '"' + book.title + '" — 이야기는 처음 → 사건 → 해결 → 끝 순서로 흘러가요. 칸을 누르면 읽어 줘요.', [bookPicker(book, storyMap), h('div', { class: 'map' }, cols)]);
    speak('이야기 지도예요. 처음, 사건, 해결, 끝으로 나눠 봤어요.');
  }
  /* 이야기 돌아보기: 고른 카드로 질문을 만든다. 점수·순위는 없다 */
  function quiz(book) {
    var steps = S.plan(book.cfg, book.ep), st = S.stateAt(book, steps.length), r = SL.rng((book.seed >>> 0) + 11), qs = [];
    function others(list, right, n) { return SL.shuffle(list.filter(function (x) { return x.n !== right.n && x.e !== right.e; }), r).slice(0, n); }
    function add(q, right, pool) { qs.push({ q: q, opts: SL.shuffle([right].concat(others(pool, right, 2)), r), right: right.n }); }
    add('이 이야기의 주인공은 누구였나요?', { e: st.hero.e, n: book.name ? book.name + ' (' + st.hero.n + ')' : st.hero.n }, D.HEROES);
    var pl = D.PLACES[book.picks.place];
    if (pl) add('주인공은 처음에 어디로 갔나요?', { e: pl.e, n: pl.n }, D.WORLD[book.ep].places.map(function (id) { return { e: D.PLACES[id].e, n: D.PLACES[id].n }; }));
    var evStep = steps.filter(function (s) { return s.kind === 'ev' || s.kind === 'vev'; })[0];
    if (evStep) { var ev = D.EVENTS.concat(D.VEVENTS).filter(function (e) { return e.id === book.picks[evStep.key]; })[0]; if (ev) add('어떤 일이 생겼나요?', { e: ev.e, n: ev.n }, D.EVENTS); }
    var k = steps.findIndex(function (s) { return s.kind === 'sol'; });
    if (k >= 0) add('그 일을 어떻게 해결했나요?', { e: S.pickEmoji(book, k), n: chosenName(book, k) }, D.SOLVES);
    if (st.items.length) add('가방에 무엇을 챙겼나요?', { e: st.items[0].e, n: st.items[0].n }, D.ITEMS);
    var f = steps.findIndex(function (s) { return s.kind === 'feel'; });
    if (f >= 0) add('사건이 생겼을 때 주인공의 기분은 어땠나요?', { e: S.pickEmoji(book, f), n: chosenName(book, f) }, D.FEELS);
    var cards = qs.map(function (q, qi) {
      var fb = h('div', { class: 'fb' }), mark = h('span', { class: 'mark' });
      var card = h('div', { class: 'qcard', 'data-q': String(qi) }, [mark, h('div', { class: 'qq' }, [h('span', { class: 'no', text: String(qi + 1) }), q.q, btn('🔊', 'icon ghost', function () { speak(q.q); }, { 'aria-label': '질문 듣기' })])]);
      var opts = h('div', { class: 'opts' });
      q.opts.forEach(function (o) {
        var b = btn('', '', function () {
          if (card.dataset.done) return;
          if (o.n === q.right) {
            b.classList.add('right'); card.dataset.done = '1'; mark.className = 'mark redpen'; mark.textContent = '참 잘했어요';
            fb.textContent = '맞아요! ' + q.right + '.'; speak('맞아요! ' + q.right + '.');
          } else { b.classList.add('wrong'); b.disabled = true; fb.textContent = '다시 생각해 봐요. 이야기 지도를 보면 도움이 돼요.'; speak('다시 생각해 봐요.'); }
        }, { 'data-opt': o.n, 'data-right': o.n === q.right ? '1' : null });
        b.textContent = '';
        b.appendChild(h('span', { class: 'ce', text: o.e, 'aria-hidden': 'true' })); b.appendChild(document.createTextNode(o.n));
        opts.appendChild(b);
      });
      card.appendChild(opts); card.appendChild(fb);
      return card;
    });
    learnFrame('quiz', '이야기 돌아보기', '"' + book.title + '"을(를) 떠올리며 골라 봐요. 틀려도 괜찮아요.', [bookPicker(book, quiz), h('div', { class: 'quiz' }, cards)]);
    speak('이야기 돌아보기예요. ' + (qs[0] ? qs[0].q : ''));
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

  /* ---------- 등장인물 목소리 ----------
     읽어 주는 사람(해설): 대사를 뺀 글 전부. 따옴표 대사는 그 대사를 말한 인물의 목소리로 읽는다.
     AI 목소리 10가지 중 하나로 구분한다. 책마다 저장한다 */
  function rolesOf(book) {
    var roles = [{ key: 'narr', e: '📖', n: '읽어 주는 사람' }], sw = book.swap || {};
    var swe = function (e) { return sw[e] || e; };
    try {
      var st = S.stateAt(book, S.plan(book.cfg, book.ep).length);
      roles.push({ key: 'hero', e: swe(st.hero.e), n: book.name || st.hero.n });
      st.friends.forEach(function (f) { if (!f.villain) roles.push({ key: 'f:' + f.id, e: swe(f.e), n: f.n }); });
      if (st.vil) roles.push({ key: 'v', e: swe(st.vil.e), n: st.vil.n });
    } catch (e) { /* 예전 책: 해설만 */ }
    return roles;
  }
  /* 처음 목소리: 해설은 기본 목소리, 주인공·친구·말썽꾼은 서로 다른 목소리를 나눠 준다 */
  function defaultVoices(book) {
    var d = {}, ais = ['F3', 'M2', 'F4', 'M4', 'F5', 'M5'], fi = 0;
    var narrAi = data.style || 'F1';
    var pickAi = function (want) { return want === narrAi ? (want === 'F1' ? 'F5' : 'F1') : want; };
    rolesOf(book).forEach(function (r) {
      if (r.key === 'narr') d.narr = { ai: narrAi };
      else if (r.key === 'hero') d.hero = { ai: pickAi('F2') };
      else if (r.key === 'v') d.v = { ai: pickAi('M3') };
      else { d[r.key] = { ai: pickAi(ais[fi % ais.length]) }; fi++; }
    });
    return d;
  }
  function voiceOf(book, who) {
    var def = defaultVoices(book), mine = book.voices || {};
    var v = mine[who] || def[who] || mine.narr || def.narr || { ai: data.style };
    return { rate: data.rate, style: v.ai || data.style };
  }
  /* 문장 하나를 해설·대사로 나눠 차례로 읽는다. done 은 끝까지 읽었을 때 한 번 */
  function sayLine(book, sentence, who, at, done, isLive) {
    var parts = SL.speechParts(sentence, who, at).parts, k = 0;
    (function next() {
      if (!isLive()) return;
      if (k >= parts.length) { done(); return; }
      var p = parts[k++];
      SL.say(p.t, voiceOf(book, p.who), function () { next(); });
    })();
  }
  function quotesIn(t) { return Math.floor((String(t).match(/"/g) || []).length / 2); }

  /* ---------- 읽기 ---------- */
  /* opts.echo: 따라 읽기 — 한 문장을 읽어 준 뒤, 아이가 따라 읽을 시간(같은 길이)을 두고 넘어간다. 채점은 하지 않는다 */
  function read(book, startAt, auto, opts) {
    opts = opts || {};
    var echo = !!opts.echo;
    var pages;
    try { pages = SL.buildBook(book); }
    catch (e) { console.warn('책을 열지 못했어요', e); toast('이 책을 열지 못했어요.'); shelf(); return; }
    var textCount = pages.filter(function (p) { return p.kind === 'text'; }).length;
    var idx = Math.max(0, Math.min(pages.length - 1, startAt || 0));
    var playing = false, sentEls = [], cur = -1, runId = 0, pauseTimer = null;
    var stage = h('div', { class: 'stage' });
    var pno = h('div', { class: 'pno', 'data-pno': '' });
    var playBtn = btn('🔊 읽어 주기', 'primary', function () { if (playing) stopPlay(); else startPlay(); }, { 'data-act': 'play', 'data-ic': '🔊' });
    var badge = h('button', { type: 'button', class: 'hbtn wide', 'data-ai': '', 'data-ic': '🎙️', onclick: function () { stopPlay(); settings(); } });
    var echoBtn = btn('🔁 따라 읽기', echo ? 'on' : '', function () { echo = !echo; echoBtn.classList.toggle('on', echo); echoBtn.setAttribute('aria-pressed', echo ? 'true' : 'false'); if (playing) { stopPlay(); startPlay(); } }, { 'data-act': 'echo', 'data-ic': '🔁', 'aria-pressed': echo ? 'true' : 'false' });
    var echoTip = h('div', { class: 'echo-tip', 'aria-live': 'polite' });
    var prevB = btn('◀', 'icon white', function () { go(idx - 1); }, { 'aria-label': '앞 쪽', 'data-act': 'prev' });
    var nextB = btn('▶', 'icon white', function () { go(idx + 1); }, { 'aria-label': '다음 쪽', 'data-act': 'next' });

    function label(i) { var p = pages[i]; return p.kind === 'cover' ? '표지' : p.kind === 'end' ? '끝' : i + ' / ' + textCount; }
    function sentencesOf(p) {
      /* 표지: 제목, 그리고 "하늘이 지은 이야기예요." (지은이가 없으면 제목만) */
      if (p.kind === 'cover') return book.author ? [book.title, SL.J(book.author, '이/가') + ' 지은 이야기예요.'] : [book.title];
      if (p.kind === 'end') return [];
      return SL.splitSentences(p.t);
    }
    function render(dir) {
      var p = pages[idx];
      stage.textContent = '';
      var pg = h('div', { class: 'pg' + (dir ? (dir > 0 ? ' turn-next' : ' turn-prev') : ''), 'data-page': String(idx), 'data-kind': p.kind });
      pg.appendChild(SL.renderScene(p.sc, { cover: p.kind === 'cover' }));
      var txt = h('div', { class: 'txt' });
      sentEls = [];
      if (p.kind === 'cover') {
        var t1 = h('div', { class: 'cover-t s', text: book.title }), t2 = book.author ? h('div', { class: 'cover-a s', text: '지은이 ' + book.author }) : null;
        txt.appendChild(h('div', { class: 'once', text: '그림책 공방', 'aria-hidden': 'true' }));
        sentEls = t2 ? [t1, t2] : [t1];
        sentEls.forEach(function (x) { txt.appendChild(x); });
      } else if (p.kind === 'end') {
        txt.appendChild(h('div', { class: 'the-end', text: '끝' }));
        txt.appendChild(h('div', { class: 'end-sub', text: '"' + book.title + '"을(를) 끝까지 읽었어요.' }));
        txt.appendChild(h('div', { class: 'end-btns' }, [
          btn('↺ 처음부터', '', function () { go(0); }, { 'data-act': 'again' }),
          btn('이야기 돌아보기', '', function () { quiz(book); }, { 'data-act': 'to-quiz' }),
          btn('📚 책장으로', 'primary', shelf, { 'data-act': 'shelf' })
        ]));
        txt.appendChild(h('div', { class: 'legend' }, [
          h('span', { class: 'w-link', text: '파란 말' }), ' 이어 주는 말 · ', h('span', { class: 'w-mime', text: '물결 밑줄' }), ' 흉내 내는 말'
        ]));
      } else {
        sentencesOf(p).forEach(function (s, k) {
          var el = h('span', { class: 's', 'data-s': String(k) });
          var segs = SL.markWords(s);
          /* 쪽의 첫 글자를 빨간 펜으로 크게 (따옴표로 시작하면 하지 않는다) */
          if (k === 0 && segs.length && !segs[0].c && /^[가-힣]/.test(segs[0].t)) {
            var ch = Array.from(segs[0].t)[0];
            el.appendChild(h('span', { class: 'dropcap', text: ch, 'aria-hidden': 'true' }));
            segs[0] = { t: segs[0].t.slice(ch.length) };
          }
          segs.forEach(function (seg) { if (seg.t) el.appendChild(seg.c ? h('span', { class: seg.c, text: seg.t }) : document.createTextNode(seg.t)); });
          el.addEventListener('click', function () { readOne(k); });
          sentEls.push(el);
          txt.appendChild(el);
          txt.appendChild(document.createTextNode(' '));
        });
      }
      if (p.kind === 'cover') sentEls.forEach(function (el, k) { el.addEventListener('click', function () { readOne(k); }); });
      if (p.kind === 'text') txt.appendChild(echoTip);
      echoTip.textContent = '';
      pg.appendChild(txt);
      stage.appendChild(pg);
      pno.textContent = label(idx);
      prevB.disabled = idx === 0;
      nextB.disabled = idx === pages.length - 1;
      mark(-1);
    }
    function mark(k, isEcho) {
      cur = k;
      sentEls.forEach(function (el, i) { el.classList.toggle('cur', i === k && !isEcho); el.classList.toggle('echo', i === k && !!isEcho); });
      echoTip.textContent = isEcho ? '이제 따라 읽어 봐요' : '';
      if (k >= 0 && sentEls[k] && sentEls[k].scrollIntoView) { try { sentEls[k].scrollIntoView({ block: 'nearest' }); } catch (e) { } }
    }
    function halt() { runId++; clearTimeout(pauseTimer); SL.stopSpeak(); mark(-1); }
    function stopPlay() { playing = false; halt(); playBtn.textContent = '🔊 읽어 주기'; playBtn.setAttribute('data-ic', '🔊'); }
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
      playBtn.setAttribute('data-ic', '⏸');
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
        var text = list[k], at = 0;
        for (var a = 0; a < k; a++) at += quotesIn(list[a]);
        mark(k);
        var nx = list[k + 1] || (sentencesOf(pages[idx + 1] || {})[0]);
        if (nx) { var np = SL.speechParts(nx, list[k + 1] ? pages[idx].spk : (pages[idx + 1] || {}).spk, list[k + 1] ? at + quotesIn(text) : 0).parts[0]; SL.prefetch(np.t, voiceOf(book, np.who)); }
        sayLine(book, text, pages[idx].spk, at, function () {
          if (my !== runId) return;
          if (!echo || pages[idx].kind !== 'text') { k++; next(); return; }
          /* 따라 읽기: 같은 문장을 아이가 따라 읽을 시간 (읽은 길이만큼 + 1초) */
          mark(k, true);
          pauseTimer = setTimeout(function () { if (my !== runId) return; k++; next(); }, SL.expectMs(text, data.rate) + SL.ms(1000));
        }, function () { return my === runId; });
      }
      next();
    }
    /* 문장을 누르면 그 문장만 읽는다 */
    function readOne(k) {
      if (playing) stopPlay(); else halt();
      var list = sentencesOf(pages[idx]);
      if (!list[k]) return;
      var my = runId, at = 0;
      for (var a = 0; a < k; a++) at += quotesIn(list[a]);
      mark(k);
      sayLine(book, list[k], pages[idx].spk, at, function () { if (my === runId) mark(-1); }, function () { return my === runId; });
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
    function updBadge() {
      var st = SL.model.state;
      badge.textContent = st === 'ready' ? '🎙️ AI 목소리' : st === 'loading' ? '🎙️ ' + (SL.model.pct || 0) + '%' : '🔇 목소리 준비';
      badge.setAttribute('data-ic', st === 'ready' ? '🎙️' : '🔇');
      badge.classList.toggle('off', st !== 'ready');
    }
    var offModel = SL.onModel(updBadge);

    screen('read', [
      h('header', { class: 'lab' }, [btn('✕', 'icon ghost', shelf, { 'aria-label': '책장으로', 'data-act': 'close' }), h('div', { class: 'grow htitle read-t', text: book.title }), badge,
        h('button', { type: 'button', class: 'hbtn', 'aria-label': '꾸미기 (배경·그림·목소리)', title: '꾸미기', 'data-act': 'decorate', onclick: function () { stopPlay(); decorEditor(book, pages[idx], function () { pages = SL.buildBook(book); render(0); }); } }, ['🎨']),
        h('button', { type: 'button', class: 'hbtn', 'aria-label': '영상(MP4)으로 내려받기', title: '영상으로 내려받기', 'data-act': 'video', onclick: function () { stopPlay(); videoExport(book); } }, ['🎬'])]),
      stage,
      h('div', { class: 'bar bottom' }, [echoBtn, h('span', { class: 'sp' }), prevB, pno, nextB, h('span', { class: 'sp' }), playBtn])
    ]);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
    leaveRead = function () { stopPlay(); document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis); offModel(); reading = false; };
    reading = true;
    updBadge();
    render(0);
    if (auto) startPlay();
  }

  /* ---------- 꾸미기: 배경 · 그림(인물 이모지·스티커) · 목소리 ---------- */
  var BG_NAMES = { meadow: '들판', night: '밤 마을', forest: '숲', beach: '바닷가', island: '무인도', space: '우주', moon: '달', mars: '화성', starland: '별나라', candy: '사탕 행성', ice: '얼음 행성', rainbow: '무지개', sea: '바닷속', castle: '성', room: '방', party: '파티', school: '마법 교실', mountain: '산', volcano: '화산', jungle: '정글', field: '운동장', circus: '서커스' };
  var PALETTE = [['동물', '🐰 🐻 🦊 🐸 🐱 🐶 🐼 🐨 🐯 🦁 🐵 🐧 🐥 🦄 🐉 🦖 🦕 🐢 🐙 🐬 🐳 🦋 🐝 🐞 🦉 🐿️ 🐘 🦒'],
    ['사람·요정', '👧 👦 👩 👨 👶 👵 👴 🧒 🧚 🧜‍♀️ 🧙 🤖 👽 👻 🦸 🧑‍🚀 👸 🤴'],
    ['자연', '🌸 🌻 🌷 🌈 ⭐ 🌙 ☀️ ☁️ ❄️ 🔥 🌊 🍄 🌳 🍀 🌵 🪨'],
    ['물건', '🎈 🎁 🎂 🍪 🍎 🍓 🧸 ⚽ 🎸 🔦 🗺️ 🪄 👑 💎 🚀 ⛵ 🚗 🏠 📚 ✏️ 🎨 💌']];
  function decorEditor(book, page, onSave) {
    var isText = page.kind === 'text', k = page.k;
    var raw = isText ? (book.pages[k].sc || {}) : null;
    var deco = JSON.parse(JSON.stringify((book.deco || {})[k] || {}));
    var swap = JSON.parse(JSON.stringify(book.swap || {}));
    var voices = JSON.parse(JSON.stringify(book.voices || defaultVoices(book)));
    var tab = isText ? 'bg' : 'voice', sel = null;
    var box;
    function cur() {
      var sw = function (e) { return e && swap[e] ? swap[e] : e; };
      return { bg: deco.bg || raw.bg, tm: deco.tm || raw.tm, cast: (raw.cast || []).map(sw), vil: sw(raw.vil), obj: Array.isArray(deco.obj) ? deco.obj : (raw.obj || []), mood: raw.mood, guest: raw.guest, pos: deco.pos || null };
    }
    /* 미리보기 장면에서 인물·스티커를 끌어 옮긴다. 누르기만 하면 그 그림을 고른다 */
    function movable(scene) {
      scene.classList.add('editable');
      scene.setAttribute('data-editable', '');
      scene.addEventListener('pointerdown', function (e) {
        var el = e.target.closest ? e.target.closest('[data-k]') : null;
        if (!el || !scene.contains(el)) return;
        e.preventDefault();
        var key = el.dataset.k, rect = scene.getBoundingClientRect(), moved = false, sx = e.clientX, sy = e.clientY;
        var r0 = el.getBoundingClientRect();
        var ox = (r0.left + r0.width / 2) - e.clientX, oy = (r0.top + r0.height / 2) - e.clientY;
        try { scene.setPointerCapture(e.pointerId); } catch (er) { }
        el.classList.add('dragging');
        function at(ev) {
          var x = (ev.clientX + ox - rect.left) / rect.width * 100, y = (ev.clientY + oy - rect.top) / rect.height * 100;
          return [Math.round(Math.max(4, Math.min(96, x)) * 10) / 10, Math.round(Math.max(4, Math.min(96, y)) * 10) / 10];
        }
        function move(ev) {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true;
          if (!moved) return;
          var p = at(ev);
          el.style.left = p[0] + '%'; el.style.top = p[1] + '%'; el.style.right = 'auto'; el.style.bottom = 'auto';
          el.classList.add('moved');
        }
        function up(ev) {
          scene.removeEventListener('pointermove', move); scene.removeEventListener('pointerup', up); scene.removeEventListener('pointercancel', up);
          el.classList.remove('dragging');
          if (moved) { deco.pos = deco.pos || {}; deco.pos[key] = at(ev); }
          var all = chars();
          if (key[0] === 'c' && all[+key.slice(1)]) sel = { type: 'char', orig: all[+key.slice(1)] };
          else if (key === 'v' && raw.vil) sel = { type: 'char', orig: raw.vil };
          else if (key[0] === 'o') sel = { type: 'obj', i: +key.slice(1) };
          draw();
        }
        scene.addEventListener('pointermove', move); scene.addEventListener('pointerup', up); scene.addEventListener('pointercancel', up);
      });
      return scene;
    }
    function chars() { var a = (raw.cast || []).slice(); if (raw.vil) a.push(raw.vil); return a; }
    function apply(e) {
      if (!sel) return;
      if (sel.type === 'char') { if (e === sel.orig) delete swap[sel.orig]; else swap[sel.orig] = e; }
      else {
        var o = cur().obj.slice();
        if (sel.type === 'obj') o[sel.i] = e; else if (o.length < 2) { o.push(e); sel = { type: 'obj', i: o.length - 1 }; }
        if (deco.pos && sel.type === 'obj' && o.length === 1 && deco.pos.o1) delete deco.pos.o1;
        deco.obj = o;
      }
      draw();
    }
    function sample(r) { return r.key === 'narr' ? '옛날 옛적, 작은 마을에 토끼가 살았어요.' : '안녕! 나는 ' + SL.J(r.n, '이야/야') + '.'; }
    function draw() {
      box.textContent = '';
      box.appendChild(h('h2', { text: '🎨 꾸미기' }));
      box.appendChild(h('div', { class: 'deco-tabs', role: 'tablist' }, [['bg', '🖼️ 배경'], ['art', '🐰 그림'], ['voice', '🎭 목소리']].map(function (t) {
        return btn(t[1], tab === t[0] ? 'on' : '', function () { tab = t[0]; sel = null; draw(); }, { role: 'tab', 'aria-selected': tab === t[0] ? 'true' : 'false', 'data-tab': t[0] });
      })));
      if (tab !== 'voice' && !isText) {
        box.appendChild(h('p', { class: 'note-box', text: '배경과 그림은 글이 있는 쪽에서 꾸밀 수 있어요. 목소리는 여기서도 바꿀 수 있어요.' }));
      } else if (tab === 'bg') {
        var c = cur();
        box.appendChild(h('div', { class: 'deco-body' }, [
          h('div', { class: 'deco-prev' }, [SL.renderScene(c)]),
          h('div', { class: 'deco-side' }, [
            h('div', { class: 'deco-lab', text: '때' }),
            h('div', { class: 'row' }, [['day', '☀️ 낮'], ['eve', '🌇 저녁'], ['night', '🌙 밤']].map(function (t) {
              return btn(t[1], c.tm === t[0] ? 'on' : '', function () { deco.tm = t[0]; draw(); }, { 'data-tm': t[0] });
            })),
            h('div', { class: 'deco-lab', text: '배경 (이 쪽만 바뀌어요)' }),
            h('div', { class: 'bgpick' }, Object.keys(BG_NAMES).map(function (name) {
              var th = h('span', { class: 'bgthumb' }); th.innerHTML = SL.bgSVG(name); /* 미리 정해 둔 그림만 */
              return h('button', { type: 'button', class: 'bgopt' + (c.bg === name ? ' on' : ''), 'data-bg': name, 'aria-label': BG_NAMES[name], onclick: function () { deco.bg = name; draw(); } }, [th, h('span', { class: 'bgn', text: BG_NAMES[name] })]);
            }))
          ])
        ]));
      } else if (tab === 'art') {
        var c2 = cur();
        var who = h('div', { class: 'row' }, chars().map(function (orig) {
          var shown = swap[orig] || orig, on = sel && sel.type === 'char' && sel.orig === orig;
          return btn(shown, 'emo' + (on ? ' on' : ''), function () { sel = { type: 'char', orig: orig }; draw(); }, { 'data-char': orig, 'aria-label': '인물 바꾸기' });
        }));
        var stickers = h('div', { class: 'row' }, c2.obj.map(function (e, i) {
          var on = sel && sel.type === 'obj' && sel.i === i;
          return h('span', { class: 'stk' }, [
            btn(e, 'emo' + (on ? ' on' : ''), function () { sel = { type: 'obj', i: i }; draw(); }, { 'data-obj': String(i), 'aria-label': '스티커 바꾸기' }),
            btn('✕', 'icon x', function () {
              var o = c2.obj.slice(); o.splice(i, 1); deco.obj = o; sel = null;
              if (deco.pos) { if (i === 0 && deco.pos.o1) deco.pos.o0 = deco.pos.o1; else if (i === 0) delete deco.pos.o0; delete deco.pos.o1; }
              draw();
            }, { 'aria-label': '스티커 떼기', 'data-del-obj': String(i) })
          ]);
        }).concat(c2.obj.length < 2 ? [btn('＋ 스티커', 'add' + (sel && sel.type === 'add' ? ' on' : ''), function () { sel = { type: 'add' }; draw(); }, { 'data-act': 'add-sticker' })] : []));
        var pal = h('div', { class: 'palette' + (sel ? '' : ' dim') });
        PALETTE.forEach(function (g) {
          pal.appendChild(h('div', { class: 'deco-lab', text: g[0] }));
          pal.appendChild(h('div', { class: 'pal-row' }, g[1].split(' ').map(function (e) { return btn(e, 'emo', function () { apply(e); }, { 'data-emo': e, disabled: !sel }); })));
        });
        box.appendChild(h('div', { class: 'deco-body' }, [
          h('div', { class: 'deco-prev' }, [movable(SL.renderScene(c2)), h('div', { class: 'hint', text: '👆 그림을 끌어서 옮겨요. 누르면 바꿀 그림으로 골라져요.' })]),
          h('div', { class: 'deco-side' }, [
            h('div', { class: 'deco-lab', text: '인물 — 눌러서 고른 뒤 아래에서 바꿀 그림을 골라요 (책 전체)' }), who,
            h('div', { class: 'deco-lab', text: '스티커 — 이 쪽에만 붙어요 (2개까지)' }), stickers,
            h('div', { class: 'hint', text: sel ? '바꿀 그림을 골라요.' : '먼저 인물이나 스티커를 골라요.' }),
            pal
          ])
        ]));
      } else {
        box.appendChild(h('p', { class: 'note-box', text: '🎙️ AI 목소리 10가지 중에서 골라요. 읽어 주는 사람은 대사를 뺀 글을 읽고, 따옴표 대사는 그 인물의 목소리로 읽어요.' }));
        if (SL.model.state !== 'ready') box.appendChild(voicePanel(true));
        var list = h('div', { class: 'roles' });
        rolesOf(book).forEach(function (r) {
          var v = voices[r.key] || (voices[r.key] = { ai: data.style });
          var choices = SL.STYLES.map(function (x) { return btn(x[1], v.ai === x[0] ? 'on' : '', function () { v.ai = x[0]; draw(); }, { 'data-vk': r.key, 'data-ai-style': x[0] }); });
          list.appendChild(h('div', { class: 'role', 'data-role': r.key }, [
            h('div', { class: 'who' }, [h('span', { class: 'rem', text: r.e }), h('b', { text: r.n }),
              btn('▶ 들어 보기', 'white', function () { var tmp = book.voices; book.voices = voices; SL.say(sample(r), voiceOf(book, r.key)); book.voices = tmp; }, { 'data-listen': r.key })]),
            h('div', { class: 'row choices' }, choices)
          ]));
        });
        box.appendChild(list);
      }
      box.appendChild(h('div', { class: 'row deco-foot' }, [
        isText && tab !== 'voice' ? btn('↺ 이 쪽 처음대로', '', function () { deco = {}; draw(); }, { 'data-act': 'deco-reset' }) : null,
        btn('그만두기', '', function () { closeModal(); }, { 'data-act': 'deco-cancel' }),
        btn('✔ 다 꾸몄어요', 'primary', function () {
          book.deco = book.deco || {};
          if (isText) { if (Object.keys(deco).length) book.deco[k] = deco; else delete book.deco[k]; }
          book.swap = swap; book.voices = voices;
          persist(); closeModal(); onSave();
        }, { 'data-act': 'deco-save' })
      ]));
    }
    box = modal([]);
    box.classList.add('wide');
    draw();
  }

  function videoExport(book) { toast('영상 만들기를 준비하고 있어요.'); }

  /* ---------- 설정 ---------- */
  /* AI 목소리 준비 칸: 상태·진행률·준비 단추 (책장 작업대, 설정, 읽기 화면에서 같이 쓴다) */
  function voicePanel(compact) {
    var box = h('div', { class: 'voice-panel' + (compact ? ' compact' : ''), 'data-voice-panel': '' });
    function draw() {
      var m = SL.model;
      box.textContent = '';
      box.dataset.state = m.state;
      if (m.state === 'ready') {
        box.appendChild(h('div', { class: 'vp-t', text: '🎙️ AI 목소리 준비 완료' }));
        if (!compact) box.appendChild(h('div', { class: 'vp-s', text: '이 기기 안에서 읽어요. 인터넷이 없어도 돼요.' }));
        return;
      }
      if (m.state === 'loading') {
        box.appendChild(h('div', { class: 'vp-t', text: '🎙️ AI 목소리 준비 중… ' + (m.pct || 0) + '%' }));
        box.appendChild(h('div', { class: 'vp-bar', role: 'progressbar', 'aria-valuenow': String(m.pct || 0), 'aria-valuemin': '0', 'aria-valuemax': '100' }, [h('i', { style: 'width:' + (m.pct || 0) + '%' })]));
        if (!compact) box.appendChild(h('div', { class: 'vp-s', text: m.msg }));
        return;
      }
      box.appendChild(h('div', { class: 'vp-t', text: m.state === 'error' ? '🎙️ AI 목소리를 준비하지 못했어요' : '🎙️ 읽어 주려면 AI 목소리가 필요해요' }));
      if (!compact) box.appendChild(h('div', { class: 'vp-s', text: m.state === 'error' ? '인터넷 연결을 확인하고 다시 눌러 주세요.' : '처음 한 번 약 180MB를 내려받아요 (Wi-Fi 권장). 그 뒤에는 인터넷 없이 읽어요.' }));
      box.appendChild(btn(m.state === 'error' ? '↻ 다시 준비하기' : '🎙️ AI 목소리 준비하기', 'primary block', function () { prepareVoice(); }, { 'data-act': 'prepare-voice' }));
    }
    var off = SL.onModel(draw);
    draw();
    box._off = off;
    screenOffs.push(off);
    return box;
  }
  function prepareVoice() {
    return SL.loadModel().then(function () {
      if (!data.aiReady) { data.aiReady = true; persist(); }
      speak('안녕! 그림책 공방이에요. 이제 이야기를 읽어 줄게요.');
    }).catch(function (e) { console.warn('AI 목소리 준비 실패', e); });
  }

  function settings() {
    var box, panel;
    function draw() {
      if (panel && panel._off) panel._off();
      box.textContent = '';
      box.appendChild(h('h2', { text: '⚙️ 설정' }));
      box.appendChild(h('h3', { text: 'AI 목소리' }));
      panel = voicePanel(false);
      box.appendChild(panel);
      box.appendChild(h('h3', { text: '읽어 주는 사람의 기본 목소리' }));
      box.appendChild(h('div', { class: 'row' }, SL.STYLES.map(function (x) {
        return btn(x[1], data.style === x[0] ? 'on' : '', function () { data.style = x[0]; persist(); draw(); speak('안녕! 이 목소리로 읽어 줄게요.'); }, { 'data-style': x[0] });
      })));
      box.appendChild(h('p', { class: 'small', text: '등장인물 목소리는 읽기 화면의 🎨 꾸미기 → 🎭 목소리에서 책마다 정해요.' }));
      box.appendChild(h('h3', { text: '읽는 빠르기' }));
      box.appendChild(h('div', { class: 'row' }, [[0.8, '🐢 느리게'], [1, '🙂 보통'], [1.2, '🐇 빠르게']].map(function (r) {
        return btn(r[1], data.rate === r[0] ? 'on' : '', function () { data.rate = r[0]; persist(); draw(); speak('이 빠르기로 읽어 줄게요.'); }, { 'data-rate': String(r[0]) });
      })));
      box.appendChild(btn('🔊 미리 듣기', '', function () { speak('옛날 옛적, 작은 마을에 토끼가 살았어요.'); }));
      box.appendChild(h('h3', { text: '알아 두세요' }));
      box.appendChild(h('p', { class: 'small', text: 'AI 목소리는 컴퓨터가 만든 목소리예요.' }));
      box.appendChild(h('p', { class: 'small', text: '만든 책은 이 기기의 브라우저 안에만 저장돼요. 브라우저 기록을 지우면 책도 지워져요.' }));
      box.appendChild(h('p', { class: 'small', text: '그림은 이모지로 그려서 기기(아이패드·안드로이드·윈도우)마다 조금씩 다르게 보여요.' }));
      box.appendChild(h('p', { class: 'small' }, ['AI 목소리: Supertonic 3 (Supertone Inc., ', h('a', { href: 'licenses/OpenRAIL-M.txt', target: '_blank', rel: 'noopener', text: 'OpenRAIL-M' }), ') · 음성 엔진: ONNX Runtime Web (', h('a', { href: 'licenses/onnxruntime-MIT.txt', target: '_blank', rel: 'noopener', text: 'MIT' }), ')']));
      box.appendChild(h('div', { class: 'row' }, [btn('닫기', 'primary', function () { closeModal(); if (panel._off) panel._off(); }, { 'data-act': 'close-settings' })]));
    }
    box = modal([], function () { if (panel && panel._off) panel._off(); });
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
  /* 한 번 받아 둔 AI 목소리는 앱을 열 때 바로 불러온다 (캐시에서, 인터넷 없이) */
  if (data.aiReady || window.__SL_FAKE_TTS) SL.loadModel().catch(function () { });

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
