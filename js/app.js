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
    var s = h('div', { class: 'screen scr-' + name, 'data-screen': name }, kids);
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

  /* 머리말 줄 (-lab 공통: 흰 줄 + 아래 선). left: 뒤로 버튼 등 */
  function head(left, titleEl, right) {
    return h('div', { class: 'bar head' }, [].concat(left || [], [titleEl], right || []));
  }
  function backBtn(on, label) { return btn('◀', 'icon', on, { 'aria-label': label || '뒤로', 'data-act': 'back' }); }
  function titleOf(text, ic) { return h('h1', { class: 'title grow' }, [ic ? h('span', { class: 'ic', text: ic }) : null, text]); }

  /* ---------- 책장: 작업대 + 나무 책장 ---------- */
  function shelf() {
    var books = h('div', { class: 'books', 'data-shelf': '' });
    data.books.forEach(function (b) {
      var pages = SL.buildBook(b);
      var sc = SL.renderScene(pages[0].sc, { cover: true });
      books.appendChild(h('div', { class: 'book', 'data-book': b.id }, [
        h('button', { class: 'open', type: 'button', 'aria-label': b.title + ' 읽기', onclick: function () { read(b, 0); } }, [
          h('div', { class: 'cover' }, [sc]),
          h('div', { class: 'bt', text: b.title }),
          h('div', { class: 'ba', text: '지은이 ' + (b.author || '나') })
        ]),
        btn('🗑️', 'icon del', function () {
          confirmBox('"' + b.title + '" 책을 지울까요?', '🗑️ 지우기', function () {
            data.books = data.books.filter(function (x) { return x.id !== b.id; });
            persist(); shelf();
          });
        }, { 'aria-label': b.title + ' 지우기' })
      ]));
    });
    if (!data.books.length) {
      for (var g = 0; g < 3; g++) books.appendChild(h('div', { class: 'book ghost', 'aria-hidden': 'true' }, [h('div', { class: 'cover' })]));
      books.appendChild(h('div', { class: 'shelf-empty', text: '아직 꽂힌 책이 없어요. 작업대에서 첫 그림책을 만들어 봐요!' }));
    }
    var bench = h('section', { class: 'bench', 'aria-label': '작업대' }, [
      h('div', { class: 'board', 'aria-hidden': 'true' }, [h('div', { class: 'tools' }, ['🖍️', '✂️', '📐', '🎨', '📎'].map(function (e) { return h('span', { text: e }); }))]),
      h('div', { class: 'in' }, [
        h('div', { class: 'eyebrow', text: '작업대' }),
        h('h2', { text: '오늘은 어떤 그림책을 만들까요?' }),
        btn('✏️ 새 그림책 만들기', 'primary big block', worlds, { 'data-act': 'new' }),
        h('ol', { class: 'steps4' }, [['📦', '이야기 상자 고르기'], ['📐', '설계도 정하기'], ['🃏', '이야기 카드 고르기'], ['📕', '제본하고 읽어 주기']].map(function (x) {
          return h('li', {}, [h('b', { text: x[0] }), x[1]]);
        }))
      ])
    ]);
    var bookcase = h('section', { class: 'bookcase', 'aria-label': '내 책장' }, [
      h('div', { class: 'plate' }, [h('b', { text: '📚 내 책장' }), h('span', { text: data.books.length ? data.books.length + '권' : '비어 있어요' })]),
      books
    ]);
    screen('shelf', [
      head(null, h('div', { class: 'grow sign' }, [h('span', { class: 'mark', text: '📚', 'aria-hidden': 'true' }), h('h1', { class: 'title', text: '그림책 공방' })]),
        [btn('⚙️', 'icon ghost', settings, { 'aria-label': '설정' })]),
      h('div', { class: 'scroll' }, [h('div', { class: 'wrap home' }, [bench, bookcase])])
    ]);
  }

  /* ---------- 이야기 상자 ---------- */
  function worlds() {
    var g = h('div', { class: 'boxes' });
    D.WORLDS.concat([{ id: '*', ic: '🎲', t: '아무거나', d: '무엇이 나올까요?' }]).forEach(function (w, i) {
      g.appendChild(h('button', { class: 'box lid-' + (i + 1), type: 'button', 'data-world': w.id, onclick: function () {
        planScreen(w.id === '*' ? SL.pick(D.WORLDS).id : w.id);
      } }, [h('span', { class: 'ce', text: w.ic }), h('span', { class: 'cn', text: w.t }), h('span', { class: 'cd', text: w.d })]));
    });
    screen('worlds', [
      head([backBtn(shelf, '책장으로')], titleOf('이야기 상자')),
      h('div', { class: 'scroll' }, [h('div', { class: 'wrap' }, [
        h('div', { class: 'screen-head' }, [h('div', {}, [h('div', { class: 'prompt', text: '어떤 이야기를 만들까요?' }), h('div', { class: 'hint', text: '상자를 열면 그 이야기에 맞는 장소·친구·사건 카드가 들어 있어요.' })])]),
        g
      ])])
    ]);
    speak('어떤 이야기를 만들까요?');
  }

  /* ---------- 설계도: 인물·장소·사건 수 ---------- */
  var custom = { cast: 3, places: 2, events: 2, villain: false, deco: true };
  function planScreen(ep) {
    var w = D.WORLD[ep];
    function statLine(cfg) {
      var e = S.estimate(cfg, ep);
      return '인물 ' + cfg.cast + ' · 장소 ' + Math.min(cfg.places, cfg.events) + ' · 사건 ' + cfg.events + (cfg.villain ? ' · 말썽꾼' : '') + ' — 카드 ' + e.picks + '장, 약 ' + e.pages + '쪽';
    }
    var pins = h('div', { class: 'pins' });
    D.PRESETS.forEach(function (p) {
      pins.appendChild(h('button', { class: 'pin', type: 'button', 'data-preset': p.id, onclick: function () { start(ep, p); } }, [
        h('span', { class: 'ce', text: p.e }), h('span', { class: 'cn', text: p.t + ' · ' + p.age }), h('span', { class: 'stat', text: statLine(p) })
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
      dials.appendChild(h('div', { class: 'dtitle', text: '🎛️ 내 맘대로 설계' }));
      dials.appendChild(stepper('👫 등장인물', 'cast', 1, 4));
      dials.appendChild(stepper('🗺️ 장소', 'places', 1, 3));
      dials.appendChild(stepper('⚡ 사건', 'events', 1, 3));
      dials.appendChild(h('div', { class: 'note', text: '등장인물은 주인공을 포함한 수예요. 장소는 사건 수보다 많을 수 없어요.' }));
      dials.appendChild(toggle('😈 말썽꾼', 'villain'));
      dials.appendChild(toggle('🎨 꾸미기 카드', 'deco'));
      dials.appendChild(h('div', { class: 'note', text: '꾸미기 카드: 성격 · 가방 속 물건 · 때 · 기분 · 바람의 결과' }));
      dials.appendChild(h('div', { class: 'stat', text: statLine(cfgOf()) }));
      dials.appendChild(btn('▶ 이 설계로 시작', 'primary big block', function () { start(ep, cfgOf()); }, { 'data-act': 'custom-start' }));
    }
    drawDials();
    screen('plan', [
      head([backBtn(worlds, '이야기 상자로')], titleOf(w.t, w.ic)),
      h('div', { class: 'scroll' }, [h('div', { class: 'wrap' }, [h('div', { class: 'blueprint' }, [
        h('h2', { text: '📐 이야기 설계도' }),
        h('div', { class: 'sub', text: '얼마나 큰 이야기를 만들까요? 인물·장소·사건이 많을수록 이야기가 길어지고 갈래가 많아져요.' }),
        h('div', { class: 'bp-grid' }, [pins, dials])
      ])])])
    ]);
    speak('얼마나 큰 이야기를 만들까요?');
  }
  function start(ep, cfg) { pick(S.newBook(ep, cfg), 0); }

  /* 원고: 지금까지 고른 카드로 만든 쪽을 원고지에 보여 준다 */
  function manuscript(book, i) {
    var pages = S.draft(book, i);
    var paper = h('div', { class: 'ms-paper', 'aria-label': '지금까지 쓴 이야기' }, [h('h3', { text: '📝 지금까지 쓴 이야기' })]);
    if (!pages.length) paper.appendChild(h('div', { class: 'ms-empty', text: '카드를 고르면 여기에 이야기가 한 줄씩 써져요.' }));
    pages.forEach(function (p, k) { paper.appendChild(h('p', { class: 'ms-p p-' + p.part + (k === pages.length - 1 ? ' last' : ''), text: SL.splitEmoji(p.t).text })); });
    var last = pages.length ? SL.splitEmoji(pages[pages.length - 1].t).text : '카드를 고르면 이야기가 써져요.';
    var strip = h('div', { class: 'ms-strip' }, [h('span', { class: 'lab', text: '📝 원고' }), h('span', { class: 'txt', text: last })]);
    return { box: h('aside', { class: 'manuscript' }, [paper]), strip: strip };
  }

  /* ---------- 작업대: 이야기 카드 고르기 ---------- */
  function pick(book, i) {
    var steps = S.plan(book.cfg, book.ep), step = steps[i];
    /* 앞 단계를 다시 고르면 뒤에 고른 것은 비운다 (뒤 카드의 조건이 깨질 수 있으므로) */
    steps.slice(i).forEach(function (s) { delete book.picks[s.key]; });
    var q = S.question(book, i);
    var opts = S.optionsAt(book, i);
    var dots = h('div', { class: 'dots grow', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(i + 1), 'aria-label': '카드 ' + (i + 1) + ' / ' + steps.length });
    steps.forEach(function (s, k) {
      dots.appendChild(h('span', { class: 'dot ' + partOf(s) + (k < i ? ' done' : '') + (k === i ? ' now' : ''), text: k < i ? S.pickEmoji(book, k) : '' }));
    });
    function choose(c) {
      book.picks[step.key] = c.id;
      if (step.kind === 'hero') nameScreen(book, c, i + 1);
      else if (i + 1 < steps.length) pick(book, i + 1);
      else finish(book);
    }
    var g = h('div', { class: 'grid ' + partOf(step), 'data-step': step.key });
    opts.forEach(function (c) {
      g.appendChild(h('button', { class: 'card', type: 'button', 'data-card': c.id, onclick: function () { choose(c); } }, [
        h('span', { class: 'ce', text: c.e, 'aria-hidden': 'true' }), h('span', { class: 'cn', text: c.n })
      ]));
    });
    var ms = manuscript(book, i);
    screen('pick', [
      head([backBtn(function () { if (i === 0) planScreen(book.ep); else pick(book, i - 1); })], dots, [h('span', { class: 'chip ' + partOf(step), text: D.PART[step.part] })]),
      ms.strip,
      h('div', { class: 'desk' }, [
        ms.box,
        h('main', { class: 'tray' }, [h('div', { class: 'tray-in' }, [
          h('div', { class: 'qhead' }, [h('div', { class: 'prompt', text: q }), btn('🔊', 'icon white', function () { speak(q); }, { 'aria-label': '질문 다시 듣기' })]),
          g
        ])])
      ]),
      h('div', { class: 'bar bottom' }, [btn('🎲 골라 줘', 'blue', function () { choose(SL.pick(opts)); }, { 'data-act': 'random' })])
    ]);
    var msp = document.querySelector('.manuscript');
    if (msp) msp.scrollTop = msp.scrollHeight;
    speak(q);
  }

  /* ---------- 이름표: 주인공을 고른 바로 다음 ----------
     이름을 지으면 뒤의 질문·문장·읽어 주기가 모두 그 이름으로 나온다. 안 지어도 된다 */
  function nameScreen(book, hero, next) {
    var input = h('input', { id: 'f-hero-name', type: 'text', maxlength: '8', value: book.name || '', placeholder: '이름 쓰기', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': '주인공 이름' });
    var preview = h('div', { class: 'who', 'data-name-preview': '' });
    function upd() {
      var n = SL.cleanInput(input.value, 8);
      preview.textContent = n ? '"옛날 옛적에 ' + SL.J(hero.n + ' ' + n, '이/가') + ' 살았어요."' : '이름이 없으면 "' + hero.n + '"(이)라고 불러요. (8자까지)';
    }
    function go(useName) { book.name = useName ? SL.cleanInput(input.value, 8) : ''; pick(book, next); }
    input.addEventListener('input', upd);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(true); } });
    screen('name', [
      head([backBtn(function () { pick(book, next - 1); }, '주인공 다시 고르기')], titleOf('이름표', '🏷️')),
      h('div', { class: 'scroll' }, [h('div', { class: 'wrap' }, [h('div', { class: 'nametag form' }, [
        h('div', { class: 'top', text: '안녕, 내 이름은' }),
        h('div', { class: 'in' }, [
          h('div', { class: 'face', text: hero.e, 'aria-hidden': 'true' }),
          input, preview,
          btn('👍 이 이름으로 할래요', 'primary big block', function () { go(true); }, { 'data-act': 'name-ok' }),
          btn('이름 없이 할래요', 'block', function () { go(false); }, { 'data-act': 'name-skip' })
        ])
      ])])])
    ]);
    upd();
    speak(hero.n + '의 이름을 지어 줄까요?');
  }

  /* ---------- 제본(마무리) ---------- */
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
      ca.textContent = '지은이 ' + (book.author || '나');
    }
    fName[1].addEventListener('input', refresh);
    fTitle[1].addEventListener('input', function () { titleTouched = true; refresh(); });
    fAuthor[1].addEventListener('input', refresh);
    screen('finish', [
      head([backBtn(function () { pick(book, S.plan(book.cfg, book.ep).length - 1); }, '카드 다시 고르기')], titleOf('제본하기', '📕')),
      h('div', { class: 'scroll' }, [h('div', { class: 'wrap bind' }, [
        mock,
        h('div', { class: 'paper-card form' }, [h('div', { class: 'eyebrow', text: '거의 다 됐어요!' }), h('div', { class: 'prompt', text: '표지를 꾸며요' })].concat(fName, fTitle, fAuthor, [
          h('div', { class: 'ex', text: st.hero ? '이름을 비워 두면 "' + st.hero.n + '"(이)라고 불러요. 지은이는 다음에도 기억해 둘게요.' : '' }),
          btn('📕 그림책 완성!', 'primary big block', function () { complete(book); }, { 'data-act': 'complete' })
        ]))
      ])])
    ]);
    refresh();
    speak('표지를 꾸며요. 책 제목과 지은이를 써요');
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
     기기 목소리는 높낮이(pitch)로, AI 목소리는 목소리 10가지 중 하나로 구분한다. 책마다 저장한다 */
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
  function defaultVoices(book) {
    var d = {}, tones = ['higher', 'low', 'high', 'normal'], ais = ['F3', 'M2', 'F4', 'M4', 'F5', 'M5'], fi = 0;
    var narrAi = data.style || 'F1';
    var pickAi = function (want) { return want === narrAi ? (want === 'F1' ? 'F5' : 'F1') : want; };
    rolesOf(book).forEach(function (r) {
      if (r.key === 'narr') d.narr = { tone: 'normal', ai: narrAi };
      else if (r.key === 'hero') d.hero = { tone: 'high', ai: pickAi('F2') };
      else if (r.key === 'v') d.v = { tone: 'deep', ai: pickAi('M3') };
      else { d[r.key] = { tone: tones[fi % tones.length], ai: pickAi(ais[fi % ais.length]) }; fi++; }
    });
    return d;
  }
  function voiceOf(book, who) {
    var def = defaultVoices(book), mine = book.voices || {};
    var v = mine[who] || def[who] || mine.narr || def.narr || { tone: 'normal', ai: data.style };
    return { rate: data.rate, voice: data.voice, style: v.ai || data.style, pitch: SL.toneOf(v.tone) };
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
    var prevB = btn('◀', 'icon white', function () { go(idx - 1); }, { 'aria-label': '앞 쪽', 'data-act': 'prev' });
    var nextB = btn('▶', 'icon white', function () { go(idx + 1); }, { 'aria-label': '다음 쪽', 'data-act': 'next' });

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
        var text = list[k], at = 0;
        for (var a = 0; a < k; a++) at += quotesIn(list[a]);
        mark(k);
        var nx = list[k + 1] || (sentencesOf(pages[idx + 1] || {})[0]);
        if (nx) { var np = SL.speechParts(nx, list[k + 1] ? pages[idx].spk : (pages[idx + 1] || {}).spk, list[k + 1] ? at + quotesIn(text) : 0).parts[0]; SL.prefetch(np.t, voiceOf(book, np.who)); }
        sayLine(book, text, pages[idx].spk, at, function () { if (my !== runId) return; k++; next(); }, function () { return my === runId; });
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
    function updBadge() { badge.textContent = data.voice === 'ai' && SL.model.state === 'ready' ? '🤖 AI 목소리' : data.voice === 'ai' && SL.model.state === 'loading' ? '🤖 준비 중…' : ''; }
    var offModel = SL.onModel(updBadge);

    screen('read', [
      h('div', { class: 'bar head' }, [btn('✕', 'icon ghost', shelf, { 'aria-label': '책장으로', 'data-act': 'close' }), h('div', { class: 'grow title read-t', text: book.title }), badge,
        btn('🎨', 'icon white', function () { stopPlay(); decorEditor(book, pages[idx], function () { pages = SL.buildBook(book); render(0); }); }, { 'aria-label': '꾸미기 (배경·그림·목소리)', 'data-act': 'decorate' }), playBtn]),
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

  /* ---------- 꾸미기: 배경 · 그림(인물 이모지·스티커) · 목소리 ---------- */
  var BG_NAMES = { meadow: '들판', night: '밤 마을', forest: '숲', beach: '바닷가', island: '무인도', space: '우주', moon: '달', mars: '화성', starland: '별나라', candy: '사탕 행성', ice: '얼음 행성', rainbow: '무지개', sea: '바닷속', castle: '성', room: '방', party: '파티', school: '마법 교실', mountain: '산', volcano: '화산', jungle: '정글', field: '운동장', circus: '서커스' };
  var PALETTE = [['동물', '🐰 🐻 🦊 🐸 🐱 🐶 🐼 🐨 🐯 🦁 🐵 🐧 🐥 🦄 🐉 🦖 🦕 🐢 🐙 🐬 🐳 🦋 🐝 🐞 🦉 🐿️ 🐘 🦒'],
    ['사람·요정', '👧 👦 👶 👵 👴 🧒 🧚 🧜‍♀️ 🧙 🤖 👽 👻 🦸 🧑‍🚀 👸 🤴'],
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
        var ai = data.voice === 'ai';
        box.appendChild(h('p', { class: 'note-box', text: ai ? '🤖 AI 목소리 10가지 중에서 골라요. 읽어 주는 사람은 대사를 뺀 글을 읽어요.' : '📱 기기 목소리는 높낮이로 인물을 구분해요. AI 목소리는 ⚙️ 설정에서 켤 수 있어요.' }));
        var list = h('div', { class: 'roles' });
        rolesOf(book).forEach(function (r) {
          var v = voices[r.key] || (voices[r.key] = { tone: 'normal', ai: data.style });
          var choices = ai ? SL.STYLES.map(function (x) { return btn(x[1], v.ai === x[0] ? 'on' : '', function () { v.ai = x[0]; draw(); }, { 'data-vk': r.key, 'data-ai-style': x[0] }); })
            : SL.TONES.map(function (x) { return btn(x[1], v.tone === x[0] ? 'on' : '', function () { v.tone = x[0]; draw(); }, { 'data-vk': r.key, 'data-tone': x[0] }); });
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
