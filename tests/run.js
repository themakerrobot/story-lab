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

/* 가짜 speechSynthesis. mode: normal(onend 옴) / silent(onend 안 옴, speaking=false) / stuck(onend 안 옴, 계속 speaking=true) / double(onend 두 번 + error) */
function fakeSpeech(mode) {
  return `(() => {
    window.__SL_TIME_SCALE = 0.02;
    const log = window.__spoken = []; const marks = window.__marks = [];
    let speaking = false;
    const synth = {
      get speaking() { return ${JSON.stringify(mode)} === 'stuck' ? speaking : speaking; },
      pending: false, paused: false,
      getVoices() { return [{ name: 'Fake Ko', lang: 'ko-KR', localService: true, default: true }]; },
      addEventListener() {}, removeEventListener() {},
      resume() {}, pause() {},
      cancel() { speaking = false; },
      speak(u) {
        log.push(u.text); (window.__pitch = window.__pitch || []).push(u.pitch || 1);
        const cur = document.querySelector('.s.cur');
        marks.push(cur ? cur.textContent : null);
        speaking = true;
        const mode = ${JSON.stringify(mode)};
        if (mode === 'normal') setTimeout(() => { speaking = false; u.onend && u.onend(); }, 15);
        else if (mode === 'double') setTimeout(() => { speaking = false; u.onend && u.onend(); u.onend && u.onend(); u.onerror && u.onerror({ error: 'synthesis-failed' }); }, 15);
        else if (mode === 'silent') setTimeout(() => { speaking = false; }, 10);
        /* stuck: 계속 말하는 중으로 남는다 */
      }
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
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
  browser = await chromium.launch();
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
    const q = await page.textContent('.prompt');
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

  await test('책장 작업대: 만드는 순서 단계를 누르면 이동, 주인공 16종(사람 6명)', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE);
    const steps = await page.$$('[data-step-go]');
    assert(steps.length === 4, '단계 버튼 수 ' + steps.length);
    for (const st of steps) { const b = await st.boundingBox(); assert(b.height >= 48, '단계 버튼이 48px 미만'); }
    await page.click('[data-step-go="1"]');
    assert(await page.$('[data-screen=worlds]'), '1단계를 눌러도 이야기 상자로 가지 않음');
    await page.click('[data-act=back]');
    await page.click('[data-step-go="4"]');
    assert(await page.$('[data-screen=worlds]'), '책이 없을 때 4단계가 새 책으로 가지 않음');
    await page.click('[data-world="adv"]'); await page.click('[data-preset="baby"]');
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
    await page.click('[data-act=close]');
    await page.click('[data-step-go="4"]');
    assert(await page.$('[data-screen=read]'), '4단계가 최근 책을 열지 않음');
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
      const expect = [b.title, '지은이 ' + b.author + '.'];
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
    r.spoken.forEach((s, i) => assert(r.marks[i] && norm(r.marks[i]).indexOf(norm(s)) >= 0, `짚은 문장이 다름: ${r.marks[i]} / ${s}`));
  });
  await test('읽어 주기: onend 가 오지 않는 엔진에서도 시간 대비로 넘어감', async () => {
    const r = await readTest('silent');
    assert(JSON.stringify(r.spoken) === JSON.stringify(r.expect), '읽은 순서가 다름 ' + r.spoken.length + '/' + r.expect.length);
  });
  await test('읽어 주기: 계속 말하는 중으로 남는 엔진도 최대 3배 뒤 넘어감', async () => {
    const r = await readTest('stuck');
    assert(JSON.stringify(r.spoken) === JSON.stringify(r.expect), '읽은 순서가 다름\n' + JSON.stringify(r.spoken) + '\n' + JSON.stringify(r.expect));
  });
  await test('읽어 주기: 완료가 두 번 와도 한 번만 처리', async () => {
    const r = await readTest('double');
    assert(JSON.stringify(r.spoken) === JSON.stringify(r.expect), '중복/누락 ' + r.spoken.length + '/' + r.expect.length);
  });
  await test('읽어 주기: 멈추기, 문장 터치, 쪽 넘기면 멈춤, 앱 숨기면 멈춤', async () => {
    const { ctx, page } = await newPage({ speech: 'stuck' });
    await page.goto(BASE);
    await makeBook(page, { preset: 'kid' });
    await page.waitForFunction(() => window.__spoken.length >= 1);
    await page.click('[data-act=play]'); /* 멈추기 */
    const n1 = await page.evaluate(() => window.__spoken.length);
    await page.waitForTimeout(400);
    assert((await page.evaluate(() => window.__spoken.length)) === n1, '멈췄는데 계속 읽음');
    assert((await page.$$('.s.cur')).length === 0, '멈췄는데 노란 표시가 남음');
    await page.click('[data-act=next]');
    await page.click('.txt .s >> nth=0');
    const last = await page.evaluate(() => window.__spoken[window.__spoken.length - 1]);
    const first = await page.textContent('.txt .s >> nth=0');
    assert(last === first.trim(), '터치한 문장을 읽지 않음');
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

  await test('목소리: 해설과 대사를 나눠 읽고, 인물마다 정한 목소리(높낮이)로 읽음', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await makeBook(page, { preset: 'baby', world: 'adv' });
    if ((await page.textContent('[data-act=play]')).indexOf('멈추기') >= 0) await page.click('[data-act=play]');
    for (let n = 0; n < 40 && (await page.textContent('[data-pno]')) !== '표지'; n++) await page.keyboard.press('ArrowLeft');
    await page.click('[data-act=decorate]');
    assert(await page.$('[data-role=narr]') && await page.$('[data-role=hero]'), '해설·주인공 목소리 칸이 없음');
    const friendRole = await page.$$eval('[data-role^="f:"]', (a) => a.map((x) => x.getAttribute('data-role')));
    assert(friendRole.length === 1, '친구 목소리 칸 수 ' + friendRole.length);
    await page.click('[data-role=hero] [data-tone=deep]');
    await page.click(`[data-role="${friendRole[0]}"] [data-tone=higher]`);
    await page.click('[data-act=deco-save]');
    await page.evaluate(() => { window.__spoken.length = 0; window.__pitch = []; });
    await page.click('[data-act=play]');
    await page.waitForFunction(() => document.querySelector('[data-pno]').textContent === '끝', null, { timeout: 30000 });
    const r = await page.evaluate(() => ({ s: window.__spoken.slice(), p: window.__pitch.slice() }));
    const iHero = r.s.findIndex((x) => x === '좋아, 출발!');
    assert(iHero >= 0 && r.p[iHero] === 0.6, '주인공 대사 높낮이 ' + r.p[iHero]);
    const iNarr = r.s.findIndex((x) => x.indexOf('살았어요') >= 0);
    assert(iNarr >= 0 && r.p[iNarr] === 1, '해설 높낮이 ' + r.p[iNarr]);
    assert(r.p.indexOf(1.6) >= 0, '친구 대사를 친구 목소리로 읽지 않음');
    track(page); await ctx.close();
  });

  /* 4. 반응형 */
  const SIZES = [[320, 568], [360, 640], [390, 844], [412, 360], [640, 320], [768, 1024], [1024, 768], [1180, 820], [1366, 768], [1920, 1080]];
  await test('반응형: ' + SIZES.map((s) => s.join('×')).join(', ') + ' 모든 화면', async () => {
    const { ctx, page } = await newPage({ speech: 'silent' });
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
    const r = await page.evaluate(() => ({ imgs: document.querySelectorAll('img').length, cover: document.querySelector('.read-t').textContent, txt: document.querySelector('.txt').textContent }));
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
      await page.goto(BASE);
      const r = await page.evaluate(async () => {
        const t0 = performance.now();
        await SL.loadModel();
        const t1 = performance.now();
        const pcm = await SL.model.tts.synth('콩이는 숲으로 갔어요.', { voice: 'F1', lang: 'ko', speed: 1.05 });
        return { load: (t1 - t0) / 1000, synth: (performance.now() - t1) / 1000, samples: pcm.length, rate: SL.model.tts.sampleRate, src: SL.model.tts.source, peak: Math.max(...Array.from(pcm.slice(0, 200000)).map(Math.abs)) };
      });
      console.log(`    ${r.src}: 로딩 ${r.load.toFixed(1)}s, 합성 ${r.synth.toFixed(1)}s, 소리 ${(r.samples / r.rate).toFixed(2)}s, 최대 진폭 ${r.peak.toFixed(3)}`);
      assert(r.samples / r.rate > 0.5 && r.peak > 0.01, '소리가 비어 있음');
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
