// 그림책 공방 자동 테스트: node tests/run.js
// python3 -m http.server 로 repo 를 띄우고 Playwright(Chromium)로 확인한다.
// AI 목소리(HF 모델 내려받기) 테스트는 네트워크가 필요해서 STORYLAB_MODEL=1 일 때만 돈다.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = process.env.STORYLAB_ROOT ? path.resolve(process.env.STORYLAB_ROOT) : path.join(__dirname, '..'); /* CI 는 배포본(_site)을 띄워 확인한다 */
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
let browser, server;

function waitServer() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      http.get(BASE, (r) => { r.resume(); resolve(); }).on('error', () => {
        if (Date.now() - t0 > 10000) reject(new Error('서버가 뜨지 않음')); else setTimeout(poll, 150);
      });
    })();
  });
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/* 가짜 AI 목소리 모델. 이 앱은 AI 목소리만 쓴다.
   mode: normal(짧은 소리를 바로 돌려줌) / fail(합성 실패) / hang(합성이 끝나지 않음) / none(모델 없음 = 목소리 준비 전)
   읽기 시작마다 core.js 가 보내는 'sl-say' 를 받아 읽은 문장·짚은 문장·목소리를 적는다 */
function fakeSpeech(mode) {
  return `(() => {
    window.__SL_TIME_SCALE = 0.02;
    window.__spoken = []; window.__marks = []; window.__styles = []; window.__silent = [];
    addEventListener('sl-say', (e) => {
      window.__spoken.push(e.detail.text); window.__styles.push(e.detail.style); window.__silent.push(e.detail.silent);
      const cur = document.querySelector('.s.cur'); window.__marks.push(cur ? cur.textContent : null);
    });
    const mode = ${JSON.stringify(mode)};
    if (mode !== 'none') window.__SL_FAKE_TTS = {
      sampleRate: 8000,
      synth: (t) => mode === 'fail' ? Promise.reject(new Error('가짜 합성 실패')) : mode === 'hang' ? new Promise(() => {}) : Promise.resolve(new Float32Array(Math.max(80, t.length * 20)).map((_, i) => Math.sin(i / 3) * 0.2))
    };
  })();`;
}

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, serviceWorkers: opts.sw ? 'allow' : 'block' });
  if (opts.speech !== false) await ctx.addInitScript(fakeSpeech(opts.speech || 'normal'));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('dialog', async (d) => { page.errors.push('dialog: ' + d.message()); await d.dismiss(); });
  return { ctx, page };
}

async function test(name, fn) {
  if (process.env.ONLY && name.indexOf(process.env.ONLY) < 0) return;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`✔ ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`✘ ${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

/* 새 책을 끝까지 만든다 (카드는 🎲 골라 줘로) */
async function makeBook(page, { world = 'adv', preset = 'baby', name = '콩', author = '하늘' } = {}) {
  await page.click('[data-act=new]');
  await page.click(`[data-world="${world}"]`);
  await page.click(`[data-preset="${preset}"]`);
  for (let n = 0; n < 60; n++) {
    const scr = await page.getAttribute('.screen', 'data-screen');
    if (scr === 'pick') await page.click('[data-act=random]');
    else if (scr === 'name') { await page.fill('#f-hero-name', name); await page.click('[data-act=name-ok]'); }
    else break;
  }
  assert(await page.$('[data-screen=finish]'), '마무리 화면에 오지 못함');
  await page.fill('#f-author', author);
  await page.click('[data-act=complete]');
  await page.waitForSelector('[data-screen=read]');
}

(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await waitServer();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const allErrors = [];
  const track = (p) => allErrors.push(...p.errors.map((e) => `[${p.url()}] ${e}`));

  /* 1. 책 생성 전수 검사 */
  await test('책 생성 전수 검사 (8종 × 설계 7가지 × 무작위, 이름 3종)', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    const r = await page.evaluate(() => {
      const SL = window.SL, D = SL.data, S = SL.story;
      const cfgs = D.PRESETS.concat([
        { cast: 1, places: 1, events: 1, detail: {} }, { cast: 4, places: 1, events: 1, villain: true, detail: D.FULL_DETAIL },
        { cast: 1, places: 3, events: 3, villain: true, detail: D.FULL_DETAIL }, { cast: 2, places: 2, events: 3, detail: { feel: 1 } }]);
      const names = [['콩', 1], ['토끼', 0], ['달', 8], ['', -1]];
      const fails = []; let books = 0, pages = 0, minOpt = 99, minWhere = '';
      const rnd = SL.rng(2024);
      const fail = (m) => { if (fails.length < 15) fails.push(m); };
      for (const w of D.WORLDS) for (const c of cfgs) for (let k = 0; k < 60; k++) {
        const b = S.newBook(w.id, c); b.seed = k + 1;
        const nm = names[k % 4]; b.name = nm[0];
        try {
          const steps = S.plan(b.cfg, b.ep);
          for (let i = 0; i < steps.length; i++) {
            const all = S.allOptionsAt(b, i);
            if (all.length < minOpt) { minOpt = all.length; minWhere = w.id + '/' + steps[i].key; }
            const shown = S.optionsAt(b, i, rnd);
            if (!shown.length) throw new Error('카드 없음 ' + steps[i].key);
            b.picks[steps[i].key] = SL.pick(shown, rnd).id;
          }
          const ps = S.compose(b); books++;
          const hero = S.stateAt(b, 1).hero;
          const seen = new Set();
          ps.forEach((p, pi) => {
            pages++;
            const where = `${w.id}/${JSON.stringify(c.detail ? Object.keys(c.detail) : [])}/${k} p${pi}: ${p.t}`;
            if (/undefined|null|\[object|NaN|\{|\}/.test(p.t)) fail('깨진 값 ' + where);
            if (SL.hasEmoji(p.t)) fail('이모지 남음 ' + where);
            const ss = SL.splitSentences(p.t);
            if (!ss.length || ss.some((s) => !s.trim() || !/[.!?…"']$/.test(s))) fail('빈 문장/끝맺음 ' + where + ' → ' + JSON.stringify(ss));
            if (!SL.BG[p.sc.bg]) fail('없는 배경 ' + p.sc.bg + ' ' + where);
            if (p.sc.cast[0] !== hero.e) fail('주인공 그림이 다름 ' + where);
            /* 친구가 등장한 뒤에는 계속 나온다 */
            seen.forEach((e) => { if (p.sc.cast.indexOf(e) < 0) fail('친구가 사라짐 ' + e + ' ' + where); });
            p.sc.cast.slice(1).forEach((e) => seen.add(e));
            if (p.sc.obj.length > 2) fail('물건 3개 이상 ' + where);
            /* 조사 */
            const n = nm[0];
            if (n) {
              const has = nm[1] > 0, rieul = nm[1] === 8;
              const bad = has ? [n + '는 ', n + '가 ', n + '를 ', n + '와 ', n + '라는'] : [n + '은 ', n + '이 ', n + '을 ', n + '과 ', n + '이라는'];
              if (rieul) bad.push(n + '으로');
              bad.forEach((x) => { if (p.t.indexOf(x) >= 0) fail('조사 틀림 "' + x + '" ' + where); });
            }
            if (/(은\/는|이\/가|을\/를|과\/와|으로\/로)/.test(p.t)) fail('조사가 안 골라짐 ' + where);
          });
          if (ps[ps.length - 1].part !== 'end') fail('마지막 쪽이 끝이 아님 ' + w.id);
        } catch (e) { fail(w.id + ' ' + JSON.stringify(c) + ' ' + e.message); }
      }
      return { books, pages, fails, minOpt, minWhere };
    });
    console.log(`    책 ${r.books}권, 쪽 ${r.pages}개, 가장 적은 카드 후보 ${r.minOpt}장 (${r.minWhere})`);
    assert(r.fails.length === 0, r.fails.join('\n'));
    assert(r.books === 8 * 7 * 60, '만든 책 수가 모자람 ' + r.books);
    assert(r.minOpt >= 2, '고를 카드가 2장보다 적은 단계가 있음: ' + r.minWhere);
    track(page); await ctx.close();
  });

  await test('조사 함수 (받침·ㄹ받침·숫자)', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    const r = await page.evaluate(() => [SL.J('콩', '이/가'), SL.J('토끼', '이/가'), SL.J('달', '으로/로'), SL.J('숲', '으로/로'), SL.J('바다', '으로/로'), SL.J('곰', '과/와'), SL.J('7', '을/를'), SL.J('3', '이/가'), SL.J('달', '이었어요/였어요')]);
    assert(JSON.stringify(r) === JSON.stringify(['콩이', '토끼가', '달로', '숲으로', '바다로', '곰과', '7을', '3이', '달이었어요']), JSON.stringify(r));
    track(page); await ctx.close();
  });

  await test('문장 나누기 · 이모지 분리', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    const r = await page.evaluate(() => ({
      a: SL.splitSentences('그때 토끼가 말했어요. "정말? 같이 가자!" 하고 웃었어요. 와… 신난다!'),
      b: SL.splitSentences('그는 3.5km를 걸었어요.'),
      c: SL.splitEmoji('토끼 🐰가 🧜‍♀️ 인어를 👍🏽 만났어요 🇰🇷!'),
    }));
    assert(JSON.stringify(r.a) === JSON.stringify(['그때 토끼가 말했어요.', '"정말? 같이 가자!" 하고 웃었어요.', '와…', '신난다!']), JSON.stringify(r.a));
    assert(r.b.length === 1, JSON.stringify(r.b));
    assert(r.c.text === '토끼 가 인어를 만났어요!' && r.c.emojis.length === 4, JSON.stringify(r.c));
    track(page); await ctx.close();
  });

  /* 2. 화면 흐름 */
  await test('화면 흐름: 새 책 → 종류 → 길이 → 이름 → 카드 → 마무리 → 읽기 → 끝 → 책장, 새로 고침, 지우기', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await page.click('[data-act=new]');
    await page.click('[data-world="space"]');
    await page.click('[data-preset="kid"]');
    await page.click('[data-step=hero] .card >> nth=0');
    await page.waitForSelector('[data-screen=name]');
    await page.fill('#f-hero-name', '달');
    await page.click('[data-act=name-ok]');
    const q = await page.textContent('.qt');
    assert(q.indexOf('달') >= 0, '이름이 질문에 안 나옴: ' + q);
    /* 뒤로 가기 */
    await page.click('[data-act=random]');
    await page.click('[data-act=back]');
    assert(await page.$('[data-step=trait]'), '뒤로 가기 실패');
    for (let n = 0; n < 40 && await page.$('[data-screen=pick]'); n++) await page.click('[data-act=random]');
    await page.waitForSelector('[data-screen=finish]');
    const t = await page.inputValue('#f-title');
    assert(t === '달의 우주 탐험', '자동 제목: ' + t);
    await page.fill('#f-author', '하늘');
    assert((await page.textContent('[data-cover-author]')) === '지은이 하늘', '표지 미리보기 갱신 안 됨');
    await page.click('[data-act=complete]');
    await page.waitForSelector('[data-screen=read]');
    await page.waitForFunction(() => window.__spoken.indexOf('달의 우주 탐험') >= 0);
    if ((await page.textContent('[data-act=play]')).indexOf('멈추기') >= 0) await page.click('[data-act=play]'); /* 자동 읽기를 멈춘다 */
    for (let n = 0; n < 40 && (await page.textContent('[data-pno]')) !== '표지'; n++) await page.keyboard.press('ArrowLeft');
    assert((await page.textContent('[data-pno]')) === '표지', '첫 쪽이 표지가 아님');
    for (let n = 0; n < 40; n++) { if ((await page.textContent('[data-pno]')) === '끝') break; await page.keyboard.press('ArrowRight'); }
    assert(await page.$('[data-kind=end] .the-end'), '끝 쪽 없음');
    await page.click('[data-act=shelf]');
    assert((await page.$$('[data-book]')).length === 1, '책장에 1권이 아님');
    await page.reload();
    await page.waitForSelector('[data-book]');
    assert((await page.$$('[data-book]')).length === 1, '새로 고친 뒤 책이 없음');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('storylab-v1')));
    assert(stored.v === 1 && stored.author === '하늘' && stored.books[0].title === '달의 우주 탐험' && stored.books[0].picks && stored.books[0].pages.length > 5, '저장 형식');
    /* 지우기: 그만두기 → 남아 있음, 지우기 → 없어짐 */
    await page.click('[data-book] .del'); await page.click('[data-act=no]');
    assert((await page.$$('[data-book]')).length === 1, '그만두기 했는데 지워짐');
    await page.click('[data-book] .del'); await page.click('[data-act=yes]');
    assert((await page.$$('[data-book]')).length === 0, '지워지지 않음');
    await page.reload();
    assert((await page.$$('[data-book]')).length === 0, '새로 고친 뒤 지운 책이 다시 나옴');
    track(page); await ctx.close();
  });

  await test('AI 목소리 준비 진행률: 앱을 열 때 자동으로 불러오면 상단바·준비 칸이 0%에서 멈추지 않고 완료까지 바뀜', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 412, height: 915 } });
    /* 한 번 준비해 둔 기기처럼: aiReady 를 켜고, 모델 준비는 천천히 진행 소식을 보낸다 */
    await ctx.addInitScript(() => {
      try { if (!localStorage.getItem('storylab-v1')) localStorage.setItem('storylab-v1', JSON.stringify({ v: 1, author: '', rate: 1, style: 'F1', aiReady: true, books: [] })); } catch (e) { }
      window.__SL_FAKE_TTS.load = (onStatus) => new Promise((resolve) => {
        let i = 0;
        const t = setInterval(() => {
          i++;
          if (i <= 4) onStatus(`AI 목소리 내려받는 중 (${i}/4) 5.0 / 10.0 MB`);
          else { clearInterval(t); resolve(); }
        }, 300);
      });
    });
    await page.goto(BASE);
    const seen = new Set();
    for (let n = 0; n < 40; n++) {
      seen.add(await page.textContent('[data-voice-state]'));
      if ((await page.textContent('[data-voice-state]')).indexOf('AI 목소리') >= 0) break;
      await page.waitForTimeout(100);
    }
    const head = await page.textContent('[data-voice-state]');
    assert(head.indexOf('AI 목소리') >= 0, '상단바가 준비 완료로 바뀌지 않음: ' + head + ' / 본 값 ' + [...seen].join(','));
    assert([...seen].some((x) => /[1-9]\d*%/.test(x)), '진행률이 0%에서 움직이지 않음: ' + [...seen].join(','));
    assert(!(await page.$('[data-voice-panel][data-state=loading]')), '첫 화면 준비 칸이 준비 중에 멈춤');
    /* 다른 화면에 갔다 와도 구독이 살아 있는지: 책장 → 처음 화면 */
    await page.click('[data-nav=shelf]'); await page.click('.brand');
    assert((await page.textContent('[data-voice-state]')).indexOf('AI 목소리') >= 0, '화면을 옮긴 뒤 상단바 상태가 틀림');
    track(page); await ctx.close();
  });

  await test('첫 화면 학습지: 1 이야기 짓기 · 2 책장 · 3 국어 놀이, 메뉴 탭, 주인공 16종(사람 6명)', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE);
    assert((await page.$$('.srow')).length === 3, '학습지 줄 수');
    assert((await page.$$('[data-home-world]')).length === 8, '이야기 상자 칸 수');
    for (const k of ['learn-echo', 'learn-words', 'learn-map', 'learn-quiz']) assert(await page.$(`.srow [data-act="${k}"]`), k + ' 칸 없음');
    /* 책이 없으면 국어 놀이는 새 책 만들기로 안내 */
    await page.click('.srow [data-act="learn-map"]');
    assert(await page.$('[data-screen=worlds]'), '책이 없을 때 이야기 지도가 새 책으로 가지 않음');
    await page.click('[data-nav=shelf]'); assert(await page.$('[data-screen=shelfpage]'), '책장 탭');
    await page.click('[data-nav=learn]'); assert(await page.$('[data-screen=learn]'), '국어 놀이 탭');
    await page.click('[data-nav=guide]'); assert((await page.$$('[data-screen=guide] .guide-row')).length === 5, '사용 가이드 칸 수');
    assert(await page.$('[data-nav=guide].on'), '가이드 단추가 켜짐 표시가 안 됨');
    assert((await page.title()) === 'Story Lab — 그림책 공방', '페이지 제목 ' + (await page.title()));
    await page.click('.brand'); assert(await page.$('[data-screen=shelf]'), '로고를 누르면 처음 화면');
    await page.click('[data-home-world="adv"]');
    assert(await page.$('[data-screen=plan]'), '첫 화면 이야기 상자 칸이 설계도로 가지 않음');
    await page.click('[data-preset="baby"]');
    const heroes = await page.$$eval('[data-step=hero] .card .cn', (a) => a.map((x) => x.textContent));
    assert(heroes.length === 16, '주인공 수 ' + heroes.length);
    ['소녀', '소년', '아주머니', '아저씨', '할머니', '할아버지'].forEach((n) => assert(heroes.indexOf(n) >= 0, n + ' 없음'));
    await page.click('[data-step=hero] .card >> text=할머니');
    await page.click('[data-act=name-skip]');
    for (let n = 0; n < 20 && await page.$('[data-screen=pick]'); n++) await page.click('[data-act=random]');
    await page.click('[data-act=complete]');
    await page.waitForSelector('[data-screen=read]');
    const first = await page.evaluate(() => JSON.parse(localStorage.getItem('storylab-v1')).books[0].pages[0].t);
    assert(first.indexOf('할머니가 살았어요') >= 0, '할머니 소개 문장: ' + first);
    track(page); await ctx.close();
  });

  await test('순서도 보기(옵션): 처음→사건→해결→끝 칸, 고른 칸을 눌러 다시 고르기, 카드로 돌아가기', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE);
    await page.click('[data-act=new]'); await page.click('[data-world="adv"]'); await page.click('[data-preset="kid"]');
    await page.click('[data-act=random]'); await page.click('[data-act=name-skip]');
    for (let n = 0; n < 4; n++) await page.click('[data-act=random]');
    await page.click('[data-act=view-flow]');
    const steps = await page.$$('[data-flow-step]');
    const plan = await page.evaluate(() => SL.story.plan(SL.data.PRESETS[1], 'adv').length);
    assert(steps.length === plan, '순서도 칸 수 ' + steps.length + ' / ' + plan);
    const parts = await page.$$eval('.flow .fpart', (a) => a.map((x) => x.textContent));
    assert(JSON.stringify(parts) === JSON.stringify(['처음', '사건', '해결', '사건', '해결', '끝']), '마디 ' + JSON.stringify(parts));
    const done = await page.$$eval('.fstep:not(.todo):not(.now)', (a) => a.length);
    assert(done === 5, '고른 칸 수 ' + done);
    assert(await page.$('.fstep.todo[disabled]'), '아직 안 고른 칸이 눌림');
    /* 2번째 칸(성격)을 다시 고르기 */
    await page.click('[data-flow-step="trait"]');
    assert((await page.$$eval('.fstep:not(.todo):not(.now)', (a) => a.length)) === 1, '다시 고를 때 뒤 칸이 비워지지 않음');
    assert(await page.$('[data-flow-step="trait"].now'), '다시 고를 칸이 지금 칸이 아님');
    await page.click('[data-act=view-cards]');
    assert(await page.$('[data-step=trait] .card'), '카드로 돌아가지 않음');
    track(page); await ctx.close();
  });

  await test('국어 놀이: 따라 읽기 · 낱말장 · 이야기 지도 · 이야기 돌아보기', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await makeBook(page, { preset: 'big', world: 'adv' });
    if ((await page.textContent('[data-act=play]')).indexOf('멈추기') >= 0) await page.click('[data-act=play]');
    /* 따라 읽기: 문장을 읽은 뒤 "따라 읽어 봐요"가 나오고 같은 문장이 파랗게 남는다 */
    await page.click('[data-act=echo]');
    for (let n = 0; n < 40 && (await page.textContent('[data-pno]')) !== '표지'; n++) await page.keyboard.press('ArrowLeft');
    await page.click('[data-act=next]');
    await page.click('[data-act=play]');
    await page.waitForFunction(() => document.querySelector('.s.echo') && document.querySelector('.echo-tip').textContent.indexOf('따라 읽어') >= 0, null, { timeout: 10000 });
    await page.click('[data-act=play]');
    await page.click('[data-act=close]');
    /* 낱말장 */
    await page.click('.srow [data-act="learn-words"]');
    const words = await page.$$eval('[data-word]', (a) => a.map((x) => x.getAttribute('data-word')));
    assert(words.length >= 3, '낱말 수 ' + words.length);
    assert(await page.$('.wordbook.c-green [data-word]'), '마음 낱말이 없음 (꾸미기 카드의 기분)');
    await page.click('[data-word] >> nth=0');
    await page.waitForFunction(() => window.__spoken.length > 0);
    /* 이야기 지도: 네 칸 모두 채워짐 */
    await page.click('[data-nav=learn]');
    await page.click('[data-act="learn-map"]');
    for (const part of ['start', 'event', 'solve', 'end']) assert((await page.$$(`[data-map-part="${part}"] .mp`)).length >= 1, part + ' 칸이 비었음');
    /* 이야기 돌아보기: 틀리면 다시, 맞으면 "참 잘했어요" (점수 없음) */
    await page.click('[data-nav=learn]');
    await page.click('[data-act="learn-quiz"]');
    const qn = (await page.$$('.qcard')).length;
    assert(qn >= 5, '질문 수 ' + qn);
    const wrong = await page.$('.qcard[data-q="0"] [data-opt]:not([data-right])');
    await wrong.click();
    assert(await page.$('.qcard[data-q="0"] .wrong[disabled]'), '틀린 답 표시');
    await page.click('.qcard[data-q="0"] [data-right]');
    assert((await page.textContent('.qcard[data-q="0"] .mark')).indexOf('잘했어요') >= 0, '맞힌 표시');
    assert(!(await page.textContent('.quiz')).match(/점수|등수|순위|\d+점/), '점수·순위 말이 나옴');
    track(page); await ctx.close();
  });

  await test('설계도: 내 맘대로 (인물·장소·사건·말썽꾼) 단계 수가 맞음', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await page.click('[data-act=new]'); await page.click('[data-world="detective"]');
    for (const k of ['cast', 'events', 'places']) for (let n = 0; n < 5; n++) { if (await page.isEnabled(`[data-plus="${k}"]`)) await page.click(`[data-plus="${k}"]`); }
    assert(!(await page.isEnabled('[data-plus="cast"]')), '최댓값에서 + 가 꺼지지 않음');
    await page.click('[data-toggle=villain]');
    const v = await page.evaluate(() => ({ cast: document.querySelector('[data-v=cast]').textContent, ev: document.querySelector('[data-v=events]').textContent, pl: document.querySelector('[data-v=places]').textContent }));
    assert(v.cast === '4' && v.ev === '3' && v.pl === '3', JSON.stringify(v));
    await page.click('[data-act=custom-start]');
    let picks = 0;
    for (let n = 0; n < 60; n++) {
      const scr = await page.getAttribute('.screen', 'data-screen');
      if (scr === 'pick') { await page.click('[data-act=random]'); picks++; } else if (scr === 'name') await page.click('[data-act=name-skip]'); else break;
    }
    const planned = await page.evaluate(() => SL.story.plan({ cast: 4, places: 3, events: 3, villain: true, detail: SL.data.FULL_DETAIL }, 'detective').length);
    assert(picks === planned && planned === 22, '고르기 수 ' + picks + ' / 계획 ' + planned);
    await page.click('[data-act=complete]');
    await page.waitForSelector('[data-screen=read]');
    track(page); await ctx.close();
  });

  /* 3. 읽어 주기 */
  async function readTest(mode) {
    const { ctx, page } = await newPage({ speech: mode });
    await page.goto(BASE);
    await makeBook(page, { preset: 'baby' });
    /* 완성하면 바로 읽기 시작 → 끝 쪽에서 멈춰야 한다 */
    await page.waitForFunction(() => document.querySelector('[data-pno]').textContent === '끝' && document.querySelector('[data-act=play]').textContent.indexOf('읽어 주기') >= 0, null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      const b = JSON.parse(localStorage.getItem('storylab-v1')).books[0];
      const expect = [b.title, SL.J(b.author, '이/가') + ' 지은 이야기예요.'];
      SL.buildBook(b).filter((p) => p.kind === 'text').forEach((p) => {
        let at = 0;
        SL.splitSentences(p.t).forEach((s) => { const r = SL.speechParts(s, p.spk, at); at = r.at; r.parts.forEach((x) => expect.push(x.t)); });
      });
      const n = expect.length;
      return { spoken: window.__spoken.slice(-n), marks: window.__marks.slice(-n), expect, ui: window.__spoken.length - n };
    });
    track(page); await ctx.close();
    return r;
  }
  await test('읽어 주기: 문장 짚기 순서, 자동 쪽 넘김, 끝 쪽에서 멈춤', async () => {
    const r = await readTest('normal');
    assert(JSON.stringify(r.spoken) === JSON.stringify(r.expect), '읽은 순서가 다름\n' + JSON.stringify(r.spoken) + '\n' + JSON.stringify(r.expect));
    const norm = (x) => x.replace(/\s+/g, ' ').replace(/[.]$/, '').trim();
    r.spoken.forEach((s, i) => assert(i === 1 /* 표지: "지은이 ○○"를 "○○이 지은 이야기예요"로 읽는다 */ || (r.marks[i] && norm(r.marks[i]).indexOf(norm(s)) >= 0), `짚은 문장이 다름: ${r.marks[i]} / ${s}`));
  });
  await test('읽어 주기: 합성이 실패해도 소리 없이 짚으며 끝까지 넘어감', async () => {
    const r = await readTest('fail');
    assert(JSON.stringify(r.spoken) === JSON.stringify(r.expect), '읽은 순서가 다름 ' + r.spoken.length + '/' + r.expect.length);
  });
  await test('읽어 주기: 합성이 끝나지 않아도 시간 대비로 넘어감', async () => {
    const r = await readTest('hang');
    assert(JSON.stringify(r.spoken) === JSON.stringify(r.expect), '읽은 순서가 다름\n' + JSON.stringify(r.spoken) + '\n' + JSON.stringify(r.expect));
  });
  await test('읽어 주기: AI 목소리 준비 전에도 문장을 짚으며 넘어감', async () => {
    const r = await readTest('none');
    assert(JSON.stringify(r.spoken) === JSON.stringify(r.expect), '중복/누락 ' + r.spoken.length + '/' + r.expect.length);
  });
  await test('읽어 주기: 멈추기, 문장 터치, 쪽 넘기면 멈춤, 앱 숨기면 멈춤', async () => {
    const { ctx, page } = await newPage({ speech: 'hang' });
    await page.goto(BASE);
    await makeBook(page, { preset: 'kid' });
    await page.waitForFunction(() => window.__spoken.length >= 1);
    if ((await page.textContent('[data-act=play]')).indexOf('멈추기') < 0) await page.click('[data-act=play]');
    await page.click('[data-act=play]'); /* 멈추기 */
    const n1 = await page.evaluate(() => window.__spoken.length);
    await page.waitForTimeout(400);
    assert((await page.evaluate(() => window.__spoken.length)) === n1, '멈췄는데 계속 읽음');
    assert((await page.$$('.s.cur')).length === 0, '멈췄는데 노란 표시가 남음');
    await page.click('[data-act=next]');
    const first = (await page.textContent('.txt .s >> nth=0')).trim();
    await page.click('.txt .s >> nth=0');
    await page.waitForFunction((f) => window.__spoken.indexOf(f) >= 0 || window.__spoken.some((x) => f.indexOf(x) >= 0), first, { timeout: 5000 });
    await page.click('[data-act=play]');
    await page.waitForTimeout(50);
    await page.click('[data-act=next]');
    assert((await page.textContent('[data-act=play]')).indexOf('읽어 주기') >= 0, '쪽을 넘겼는데 멈추지 않음');
    await page.click('[data-act=play]');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert((await page.textContent('[data-act=play]')).indexOf('읽어 주기') >= 0, '앱을 숨겼는데 멈추지 않음');
    /* 밀어서 넘기기: 짧게 밀면 그대로, 60px 넘게 가로로 밀면 넘어감 */
    const p0 = await page.textContent('[data-pno]');
    const box = await page.locator('.stage').boundingBox();
    const swipe = async (dx, dy) => { await page.mouse.move(box.x + box.width / 2, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + dx, box.y + 60 + dy, { steps: 4 }); await page.mouse.up(); };
    await swipe(-40, 0); assert((await page.textContent('[data-pno]')) === p0, '짧게 밀었는데 넘어감');
    await swipe(-90, 80); assert((await page.textContent('[data-pno]')) === p0, '비스듬히 밀었는데 넘어감');
    await swipe(-120, 10); assert((await page.textContent('[data-pno]')) !== p0, '밀어서 넘기기 안 됨');
    await page.keyboard.press('Escape');
    assert(await page.$('[data-screen=shelf]'), 'Esc 로 책장에 가지 않음');
    track(page); await ctx.close();
  });

  await test('꾸미기: 배경 바꾸기(그 쪽만), 인물 이모지 바꾸기(책 전체), 스티커 붙이기·떼기, 새로 고침 뒤 유지', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await makeBook(page, { preset: 'kid', world: 'adv' });
    if ((await page.textContent('[data-act=play]')).indexOf('멈추기') >= 0) await page.click('[data-act=play]');
    for (let n = 0; n < 40 && (await page.textContent('[data-pno]')) !== '표지'; n++) await page.keyboard.press('ArrowLeft');
    for (let n = 0; n < 3; n++) await page.click('[data-act=next]'); /* 3쪽: 장소 쪽 */
    const before = await page.getAttribute('.pg .scene', 'data-bg');
    const hero0 = await page.textContent('.pg .scene .ch.hero');
    await page.click('[data-act=decorate]');
    await page.click('[data-tab=bg]');
    const target = before === 'castle' ? 'candy' : 'castle';
    await page.click(`.bgopt[data-bg="${target}"]`);
    await page.click('[data-tm=night]');
    await page.click('[data-tab=art]');
    await page.click(`[data-char="${hero0}"]`);
    await page.click('[data-emo="🦄"]');
    await page.click('[data-act=add-sticker]');
    await page.click('[data-emo="🎈"]');
    await page.click('[data-act=deco-save]');
    assert((await page.getAttribute('.pg .scene', 'data-bg')) === target, '배경이 안 바뀜');
    assert((await page.getAttribute('.pg .scene', 'class')).indexOf('tm-night') >= 0, '밤으로 안 바뀜');
    assert((await page.textContent('.pg .scene .ch.hero')) === '🦄', '주인공 그림이 안 바뀜');
    const obs = await page.$$eval('.pg .scene .ob', (a) => a.map((x) => x.textContent));
    assert(obs.indexOf('🎈') >= 0 && obs.length <= 2, '스티커 ' + JSON.stringify(obs));
    await page.click('[data-act=next]');
    assert((await page.textContent('.pg .scene .ch.hero')) === '🦄', '다른 쪽 주인공이 안 바뀜(책 전체 적용)');
    await page.reload();
    await page.waitForSelector('[data-book]');
    await page.click('[data-book] .open');
    assert((await page.textContent('.pg .scene .ch.hero')) === '🦄', '표지에 안 바뀜');
    for (let n = 0; n < 3; n++) await page.click('[data-act=next]');
    assert((await page.getAttribute('.pg .scene', 'data-bg')) === target, '새로 고친 뒤 배경이 안 남음');
    await page.click('[data-act=decorate]'); await page.click('[data-tab=art]');
    const nObj = (await page.$$('[data-del-obj]')).length;
    await page.click('[data-del-obj="0"]');
    assert((await page.$$('[data-del-obj]')).length === nObj - 1, '스티커가 안 떼짐');
    await page.click('[data-act=deco-reset]'); await page.click('[data-act=deco-save]');
    assert((await page.getAttribute('.pg .scene', 'data-bg')) === before, '처음대로가 안 됨');
    track(page); await ctx.close();
  });

  await test('꾸미기: 인물·스티커를 끌어서 옮기기 (그 쪽만, 새로 고침 뒤 유지, 처음대로)', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await makeBook(page, { preset: 'baby', world: 'adv' });
    if ((await page.textContent('[data-act=play]')).indexOf('멈추기') >= 0) await page.click('[data-act=play]');
    for (let n = 0; n < 40 && (await page.textContent('[data-pno]')) !== '표지'; n++) await page.keyboard.press('ArrowLeft');
    await page.click('[data-act=next]'); await page.click('[data-act=next]');
    await page.click('[data-act=decorate]'); await page.click('[data-tab=art]');
    const sc = page.locator('[data-editable]');
    const box = await sc.boundingBox();
    const hero = sc.locator('[data-k=c0]');
    const hb = await hero.boundingBox();
    /* 주인공을 장면 오른쪽 위(70%, 30%)로 끈다 */
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3, { steps: 8 });
    await page.mouse.up();
    assert(await page.$('.btn.emo.on[data-char]'), '끈 인물이 골라지지 않음');
    await page.click('[data-act=deco-save]');
    const center = async () => page.evaluate(() => {
      const s = document.querySelector('.pg .scene').getBoundingClientRect(), h = document.querySelector('.pg .scene [data-k=c0]').getBoundingClientRect();
      return [((h.left + h.width / 2) - s.left) / s.width * 100, ((h.top + h.height / 2) - s.top) / s.height * 100];
    });
    let c = await center();
    assert(Math.abs(c[0] - 70) < 6 && Math.abs(c[1] - 30) < 8, '옮긴 위치가 다름 ' + c.map(Math.round));
    await page.click('[data-act=next]');
    c = await center();
    assert(c[0] < 40, '다른 쪽까지 옮겨짐 ' + c.map(Math.round));
    await page.reload();
    await page.waitForSelector('[data-book]');
    await page.click('[data-book] .open');
    await page.click('[data-act=next]'); await page.click('[data-act=next]');
    c = await center();
    assert(Math.abs(c[0] - 70) < 6 && Math.abs(c[1] - 30) < 8, '새로 고친 뒤 위치가 안 남음 ' + c.map(Math.round));
    await page.click('[data-act=decorate]'); await page.click('[data-tab=art]');
    await page.click('[data-act=deco-reset]'); await page.click('[data-act=deco-save]');
    c = await center();
    assert(c[0] < 40, '처음대로가 안 됨 ' + c.map(Math.round));
    track(page); await ctx.close();
  });

  await test('목소리: 해설과 대사를 나눠 읽고, 인물마다 정한 AI 목소리로 읽음', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await makeBook(page, { preset: 'baby', world: 'adv' });
    if ((await page.textContent('[data-act=play]')).indexOf('멈추기') >= 0) await page.click('[data-act=play]');
    for (let n = 0; n < 40 && (await page.textContent('[data-pno]')) !== '표지'; n++) await page.keyboard.press('ArrowLeft');
    await page.click('[data-act=decorate]');
    assert(await page.$('[data-role=narr]') && await page.$('[data-role=hero]'), '해설·주인공 목소리 칸이 없음');
    const friendRole = await page.$$eval('[data-role^="f:"]', (a) => a.map((x) => x.getAttribute('data-role')));
    assert(friendRole.length === 1, '친구 목소리 칸 수 ' + friendRole.length);
    await page.click('[data-role=hero] [data-ai-style=M5]');
    await page.click(`[data-role="${friendRole[0]}"] [data-ai-style=F4]`);
    await page.click('[data-role=narr] [data-ai-style=M1]');
    await page.click('[data-act=deco-save]');
    await page.evaluate(() => { window.__spoken.length = 0; window.__styles.length = 0; window.__silent.length = 0; });
    await page.click('[data-act=play]');
    await page.waitForFunction(() => document.querySelector('[data-pno]').textContent === '끝', null, { timeout: 30000 });
    const r = await page.evaluate(() => ({ s: window.__spoken.slice(), v: window.__styles.slice(), q: window.__silent.slice() }));
    assert(r.q.every((x) => x === false), 'AI 목소리로 읽지 않은 문장이 있음');
    const iHero = r.s.findIndex((x) => x === '좋아, 출발!');
    assert(iHero >= 0 && r.v[iHero] === 'M5', '주인공 대사 목소리 ' + r.v[iHero]);
    const iNarr = r.s.findIndex((x) => x.indexOf('살았어요') >= 0);
    assert(iNarr >= 0 && r.v[iNarr] === 'M1', '해설 목소리 ' + r.v[iNarr]);
    assert(r.v.indexOf('F4') >= 0, '친구 대사를 친구 목소리로 읽지 않음');
    track(page); await ctx.close();
  });

  await test('영상(MP4) 내려받기: 펼친 책 + 책장 넘기기 + AI 목소리 → H.264 MP4', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE);
    await makeBook(page, { preset: 'baby', world: 'space', name: '콩이', author: '하늘' });
    if ((await page.textContent('[data-act=play]')).indexOf('멈추기') >= 0) await page.click('[data-act=play]');
    await page.click('[data-act=video]');
    await page.click('[data-act=video-make]');
    await page.waitForSelector('[data-act=video-download]', { timeout: 120000 });
    const r = await page.evaluate(async () => {
      const a = document.querySelector('[data-act=video-download]');
      const buf = new Uint8Array(await (await fetch(a.href)).arrayBuffer());
      const txt = new TextDecoder('latin1').decode(buf);
      return { name: a.getAttribute('download'), size: buf.length, ftyp: txt.indexOf('ftyp') === 4, moov: txt.indexOf('moov') >= 0, avc: txt.indexOf('avc1') >= 0 || txt.indexOf('vp09') >= 0, audio: txt.indexOf('Opus') >= 0 || txt.indexOf('mp4a') >= 0, info: document.querySelector('.modal .small').textContent };
    });
    console.log(`    ${r.info}`);
    assert(r.name === '콩이의 우주 탐험.mp4', '파일 이름 ' + r.name);
    assert(r.size > 100000 && r.ftyp && r.moov && r.avc && r.audio, 'MP4 형식이 아님 ' + JSON.stringify(r));
    await page.click('[data-act=video-close]');
    track(page); await ctx.close();
  });

  await test('영상(MP4): AI 목소리 준비 전에는 준비하라고 안내', async () => {
    const { ctx, page } = await newPage({ speech: 'none' });
    await page.goto(BASE);
    await makeBook(page, { preset: 'baby' });
    if ((await page.textContent('[data-act=play]')).indexOf('멈추기') >= 0) await page.click('[data-act=play]');
    await page.click('[data-act=video]');
    assert(!(await page.$('[data-act=video-make]')), '목소리 없이 만들기 단추가 나옴');
    assert(await page.$('.modal [data-voice-panel]'), '목소리 준비 칸이 없음');
    track(page); await ctx.close();
  });

  /* 4. 반응형 */
  const SIZES = [[320, 568], [360, 640], [390, 844], [412, 360], [640, 320], [768, 1024], [1024, 768], [1180, 820], [1366, 768], [1920, 1080]];
  await test('반응형: ' + SIZES.map((s) => s.join('×')).join(', ') + ' 모든 화면', async () => {
    const { ctx, page } = await newPage({ speech: 'none' });
    await page.goto(BASE);
    await makeBook(page, { preset: 'big', world: 'sea', name: '바다별이콩콩콩' });
    await page.click('[data-act=play]');
    await page.click('[data-act=close]');
    const problems = [];
    const check = async (label) => {
      await page.waitForTimeout(60);
      const r = await page.evaluate(() => {
        const out = [], vw = document.documentElement.clientWidth, vh = window.innerHeight;
        if (document.documentElement.scrollWidth > vw + 1) out.push('가로 넘침(문서) ' + document.documentElement.scrollWidth + '>' + vw);
        document.querySelectorAll('.screen, .scroll, .txt, .grid, .bar').forEach((el) => { if (el.scrollWidth > el.clientWidth + 1) out.push('가로 넘침 ' + el.className + ' ' + el.scrollWidth + '>' + el.clientWidth); });
        document.querySelectorAll('button').forEach((b) => {
          const r = b.getBoundingClientRect();
          if (!r.width) return;
          if (r.left < -1 || r.right > vw + 1) out.push('버튼이 옆으로 나감 "' + b.textContent.slice(0, 12) + '" ' + Math.round(r.left) + '~' + Math.round(r.right));
          if (b.closest('.bar') && (r.top < -1 || r.bottom > vh + 1)) out.push('윗줄/아랫줄 버튼이 화면 밖 "' + b.textContent.slice(0, 12) + '" ' + Math.round(r.top) + '~' + Math.round(r.bottom) + ' / ' + vh);
          /* 상단바는 ai-lab 과 같은 치수(단추 30, 메뉴 36~40)를 따른다. 대신 화면 밖으로 나가거나 겹치면 안 된다 */
          if (b.closest('header.lab')) { if (r.height < 23 || r.width < 23) out.push('상단바 단추가 너무 작음 "' + b.textContent.slice(0, 12) + '" ' + Math.round(r.width) + '×' + Math.round(r.height)); return; }
          if (r.height < 47.5 || r.width < 47.5) out.push('터치 대상이 48px 미만 "' + b.textContent.slice(0, 12) + '" ' + Math.round(r.width) + '×' + Math.round(r.height));
        });
        return out;
      });
      r.forEach((x) => problems.push(label + ': ' + x));
    };
    for (const [w, hgt] of SIZES) {
      await page.setViewportSize({ width: w, height: hgt });
      const L = `${w}×${hgt}`;
      await page.evaluate(() => SL.ui.shelf()); await check(L + ' 책장');
      await page.click('[data-act=new]'); await check(L + ' 종류');
      await page.click('[data-world="magic"]'); await check(L + ' 설계도');
      await page.click('[data-act=custom-start]'); await check(L + ' 카드');
      await page.click('[data-act=random]'); await check(L + ' 이름');
      await page.click('[data-act=name-skip]');
      for (let n = 0; n < 40 && await page.$('[data-screen=pick]'); n++) await page.click('[data-act=random]');
      await check(L + ' 마무리');
      await page.evaluate(() => SL.ui.shelf());
      await page.click('[data-book] .open');
      await check(L + ' 읽기(표지)');
      await page.click('[data-act=next]'); await page.click('[data-act=next]'); await page.click('[data-act=next]');
      await check(L + ' 읽기(글)');
      await page.click('[data-act=decorate]'); await page.click('[data-tab=bg]'); await check(L + ' 꾸미기(배경)');
      await page.click('[data-tab=art]'); await page.click('[data-act=add-sticker]'); await check(L + ' 꾸미기(그림)');
      await page.click('[data-tab=voice]'); await check(L + ' 꾸미기(목소리)'); await page.click('[data-act=deco-cancel]');
      const bottomOk = await page.evaluate(() => {
        const b = document.querySelector('.bar.bottom').getBoundingClientRect();
        const s = document.querySelector('.pg .scene').getBoundingClientRect();
        return b.bottom <= window.innerHeight + 1 && b.top >= 0 && s.width > 50 && Math.abs(s.width / s.height - 4 / 3) < 0.02;
      });
      if (!bottomOk) problems.push(L + ': 읽기 화면 아래 버튼 줄이 안 보이거나 장면 비율이 4:3이 아님');
      for (let n = 0; n < 30; n++) { if ((await page.textContent('[data-pno]')) === '끝') break; await page.click('[data-act=next]'); }
      await check(L + ' 읽기(끝)');
      await page.click('[data-act=shelf]');
      await page.click('[data-act=new]'); await page.click('[data-world="sea"]'); await page.click('[data-act=custom-start]'); await page.evaluate(() => SL.ui.shelf());
    }
    await page.evaluate(() => SL.ui.shelf());
    await page.click('button[aria-label="설정"]'); await check('설정 창');
    assert(problems.length === 0, problems.slice(0, 25).join('\n') + (problems.length > 25 ? `\n…외 ${problems.length - 25}건` : ''));
    track(page); await ctx.close();
  });

  /* 5. XSS */
  await test('XSS: 이름·제목·지은이에 <img src=x onerror=alert(1)> 를 넣어도 글자로만 보임', async () => {
    const X = '<img src=x onerror=alert(1)>';
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await page.click('[data-act=new]'); await page.click('[data-world="adv"]'); await page.click('[data-preset="baby"]');
    await page.click('[data-act=random]');
    await page.fill('#f-hero-name', X); await page.click('[data-act=name-ok]');
    for (let n = 0; n < 20 && await page.$('[data-screen=pick]'); n++) await page.click('[data-act=random]');
    await page.fill('#f-title', X); await page.fill('#f-author', X);
    await page.click('[data-act=complete]');
    await page.waitForSelector('[data-screen=read]');
    /* 입력 칸 길이 제한을 넘는 전체 문자열도 저장소에 직접 넣어 확인 */
    await page.evaluate((X) => { const d = JSON.parse(localStorage.getItem('storylab-v1')); d.books[0].title = X; d.books[0].author = X; d.books[0].name = X; d.books[0].pages[0].t = X + ' 가 살았어요.'; localStorage.setItem('storylab-v1', JSON.stringify(d)); }, X);
    await page.reload();
    await page.waitForSelector('[data-book]');
    const shelfTxt = await page.textContent('[data-book] .bt');
    await page.click('[data-book] .open');
    await page.click('[data-act=next]');
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({ imgs: document.querySelectorAll('img[src="x"], [onerror]').length, cover: document.querySelector('.read-t').textContent, txt: document.querySelector('.txt').textContent }));
    assert(shelfTxt === X, '책장 제목이 글자로 안 보임: ' + shelfTxt);
    assert(r.imgs === 0, 'img 요소가 만들어짐');
    assert(r.cover === X && r.txt.indexOf('<img') >= 0, '글자로 안 보임 ' + JSON.stringify(r));
    assert(!page.errors.some((e) => e.startsWith('dialog')), 'alert 가 실행됨');
    track(page); await ctx.close();
  });

  await test('저장 실패(용량 부족) 때 알려 주고 읽기는 계속됨', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
    await makeBook(page, { preset: 'baby' });
    assert(await page.$('.toast'), '알림이 없음');
    assert(await page.$('[data-screen=read] [data-kind=cover]'), '읽기 화면이 아님');
    track(page); await ctx.close();
  });

  /* 6. 오프라인 */
  await test('오프라인: 서비스 워커 설치 후 네트워크를 끊어도 다시 열림', async () => {
    const { ctx, page } = await newPage({ sw: true });
    await page.goto(BASE);
    /* 빠진 파일이 있으면 서비스 워커 설치가 실패해 ready 가 오지 않는다 → 15초 안에 안 오면 실패 */
    await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('서비스 워커 설치 실패 (SHELL 파일이 빠졌을 수 있음)')), 15000))]));
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await makeBook(page, { preset: 'baby' });
    await page.click('[data-act=play]');
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('[data-screen=shelf] [data-book]');
    await page.click('[data-book] .open');
    await page.waitForSelector('[data-screen=read] .scene');
    const iso = await page.evaluate(() => self.crossOriginIsolated);
    console.log(`    오프라인 새로 고침 OK, crossOriginIsolated=${iso}`);
    await ctx.setOffline(false);
    page.errors = page.errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e));
    track(page); await ctx.close();
  });

  /* AI 목소리 (선택) */
  if (process.env.STORYLAB_MODEL === '1') {
    await test('AI 목소리: HF 모델을 받아 한국어 문장을 합성', async () => {
      /* 이 환경처럼 프록시를 거쳐야 밖으로 나가는 곳에서는 HTTPS_PROXY 를 Chromium 에 넘긴다 */
      const px = process.env.HTTPS_PROXY || process.env.https_proxy;
      const b2 = px ? await chromium.launch({ proxy: { server: px, bypass: '127.0.0.1,localhost' } }) : browser;
      const ctx = await b2.newContext();
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(e.message));
      /* 두 번째 방문처럼 서비스 워커가 페이지를 맡아 교차 출처 격리(여러 스레드)가 켜진 상태에서 확인한다 */
      await page.goto(BASE);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      assert(await page.evaluate(() => crossOriginIsolated), '두 번째 방문에서 교차 출처 격리가 안 켜짐');
      const r = await page.evaluate(async () => {
        const t0 = performance.now();
        await SL.loadModel();
        const t1 = performance.now();
        const pcm = await SL.model.tts.synth('콩이는 숲으로 갔어요.', { voice: 'F1', lang: 'ko', speed: 1.05 });
        return { load: (t1 - t0) / 1000, synth: (performance.now() - t1) / 1000, samples: pcm.length, rate: SL.model.tts.sampleRate, src: SL.model.tts.source, peak: Math.max(...Array.from(pcm.slice(0, 200000)).map(Math.abs)) };
      });
      console.log(`    ${r.src}: 로딩 ${r.load.toFixed(1)}s, 합성 ${r.synth.toFixed(1)}s, 소리 ${(r.samples / r.rate).toFixed(2)}s, 최대 진폭 ${r.peak.toFixed(3)}`);
      assert(r.samples / r.rate > 0.5 && r.peak > 0.01, '소리가 비어 있음');
      assert(r.load < 80, '여러 스레드로 준비하다 멈춤 (한 스레드로 다시 준비함) ' + r.load.toFixed(1) + 's');
      track(page); await ctx.close(); if (b2 !== browser) await b2.close();
    });
  }

  /* 7. 콘솔 오류 */
  await test('콘솔 오류 0개 (모든 테스트 통틀어)', async () => {
    assert(allErrors.length === 0, allErrors.slice(0, 10).join('\n'));
  });

  await browser.close();
  server.kill();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n결과: ${results.length}개 중 ${ok}개 통과${ok === results.length ? '' : `, ${results.length - ok}개 실패`}`);
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); try { server && server.kill(); } catch (_) { } process.exit(1); });
