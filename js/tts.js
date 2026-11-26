// 그림책 공방 AI 목소리: Supertonic 3 (INT8) 를 브라우저 안(ONNX Runtime Web, WASM)에서 돌린다.
// yjworks/story-play 의 tts.js 를 바탕으로 함. 그 파일은 supertone-inc/supertonic web/helper.js (MIT) 를 다시 쓴 것.
// 바꾼 점: ONNX Runtime 을 jsDelivr 에서 먼저 받고, 안 되면 같은 사이트의 vendor/ort/ 사본을 씀(파일 내용은 sha256 으로 같음을 확인).
//          모델은 leeyunjai/edge-lab 의 tts-int8 폴더를 커밋 고정(71800e5)으로 HF 에서 직접 받음 → GitHub Pages 전송량을 쓰지 않음.
//          8비트 연산은 GPU(WebGPU)로 돌리면 오히려 느려서 WASM(CPU)만 씀.

const ORT_VER = '1.22.0';
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
const ORT_LOCAL = new URL('../vendor/ort/', import.meta.url).href;
const ORT_FILES = { mjs: 'ort-wasm-simd-threaded.jsep.mjs', wasm: 'ort-wasm-simd-threaded.jsep.wasm' };

// 모델 위치. 위에서부터 시도하고, 파일이 없거나 구성이 다르면 다음으로 넘어감.
// INT8_REV: 모델 파일을 다시 올리면 그 커밋 해시로 바꿀 것 → 주소가 바뀌어 기기마다 새 파일을 받고 예전 파일은 정리됨
const INT8_REV = '71800e5';
const hf = (repo, rev, path = '') => `https://huggingface.co/${repo}/resolve/${rev}${path ? `/${path}` : ''}`;
const SOURCES = [
  { name: 'edge-lab 8비트', base: hf('leeyunjai/edge-lab', INT8_REV, 'tts-int8') },
  { name: 'edge-lab 8비트(main)', base: hf('leeyunjai/edge-lab', 'main', 'tts-int8') },
];
const CACHE_NAME = 'storylab-tts';

let ort = null;
// ONNX Runtime 을 CDN → 같은 사이트 순으로 불러온다. wasm 바이너리는 Cache Storage 에 보관해 오프라인에서도 씀
async function loadOrt(onStatus) {
  if (ort) return ort;
  const tried = [];
  for (const base of [ORT_CDN, ORT_LOCAL]) {
    try {
      onStatus?.('음성 엔진 파일을 불러오는 중');
      const mod = await import(`${base}ort.webgpu.min.mjs`);
      const wasm = await fetchCached(`${base}${ORT_FILES.wasm}`, (n, total, cached) => {
        if (!cached) onStatus?.(`음성 엔진 내려받는 중 ${(n / 1048576).toFixed(1)}${total ? ` / ${(total / 1048576).toFixed(1)}` : ''} MB`);
      });
      mod.env.wasm.wasmPaths = { mjs: `${base}${ORT_FILES.mjs}`, wasm: `${base}${ORT_FILES.wasm}` };
      mod.env.wasm.wasmBinary = wasm;
      mod.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      ort = mod;
      console.info(`[tts] ONNX Runtime: ${base === ORT_CDN ? 'jsDelivr' : '같은 사이트'}`);
      return ort;
    } catch (e) {
      tried.push(`${base}: ${e.message}`);
      console.warn('[tts] ONNX Runtime 불러오기 실패, 다음 위치로', base, e);
    }
  }
  throw new Error(`음성 엔진을 불러오지 못했어요. ${tried.join(' / ')}`);
}

const AVAILABLE_LANGS = ['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi',
  'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi', 'na'];

export const VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];

async function openCache() {
  try { return await caches.open(CACHE_NAME); } catch (_) { return null; }
}

// 한 번 받은 파일은 Cache Storage에 보관 → 다음 방문부터 네트워크 없이 로드.
// 큰 모델 파일은 받는 즉시 디스크(Cache Storage)로 흘려 보내고, 다 받은 뒤 한 번만 메모리로 읽음.
// (메모리에 조각·합본·복사본을 동시에 들고 있으면 iPhone Safari처럼 탭 메모리가 작은 곳에서 실패함)
async function fetchCached(url, onProgress) {
  const cache = await openCache();
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      const buf = await hit.arrayBuffer();
      onProgress?.(buf.byteLength, buf.byteLength, true);
      return buf;
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패 (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (cache && res.body && typeof TransformStream === 'function') {
    let got = 0;
    const counter = new TransformStream({
      transform(chunk, ctl) {
        got += chunk.byteLength;
        onProgress?.(got, total, false);
        ctl.enqueue(chunk);
      },
    });
    try {
      const type = res.headers.get('content-type') || 'application/octet-stream';
      await cache.put(url, new Response(res.body.pipeThrough(counter), { headers: { 'content-type': type } }));
      const hit = await cache.match(url);
      if (hit) return await hit.arrayBuffer();
    } catch (e) {
      // 저장 공간 부족 등으로 캐시에 못 쓰면, 캐시 없이 다시 받아 메모리로 읽음
      console.warn('[tts] 캐시에 저장하지 못해 메모리로 받음', url, e);
      try { await cache.delete(url); } catch (_) { /* ignore */ }
      const again = await fetch(url);
      if (!again.ok) throw new Error(`다운로드 실패 (${again.status}): ${url}`);
      return readAll(again, total, onProgress);
    }
  }
  return readAll(res, total, onProgress);
}

// 캐시 없이 받을 때: 크기를 알면 한 번에 자리를 잡아 채움(합치기 복사 없음)
async function readAll(res, total, onProgress) {
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  let out = total ? new Uint8Array(total) : null;
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (out && got + value.byteLength <= out.byteLength) out.set(value, got);
    else { if (out) { parts.push(out.subarray(0, got)); out = null; } parts.push(value); }
    got += value.byteLength;
    onProgress?.(got, total, false);
  }
  if (out) return got === out.byteLength ? out.buffer : out.slice(0, got).buffer;
  const joined = new Uint8Array(got);
  let off = 0;
  for (const p of parts) { joined.set(p, off); off += p.byteLength; }
  return joined.buffer;
}

async function fetchJSON(url) {
  const buf = await fetchCached(url);
  return JSON.parse(new TextDecoder().decode(buf));
}

class UnicodeProcessor {
  constructor(indexer) { this.indexer = indexer; }

  preprocess(text, lang) {
    text = text.normalize('NFKD');
    text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, '');
    const rep = {
      '–': '-', '‑': '-', '—': '-', '_': ' ', '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'",
      '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ',
    };
    for (const [k, v] of Object.entries(rep)) text = text.replaceAll(k, v);
    text = text.replace(/[♥☆♡©\\]/g, '');
    for (const [k, v] of Object.entries({ '@': ' at ', 'e.g.,': 'for example, ', 'i.e.,': 'that is, ' })) {
      text = text.replaceAll(k, v);
    }
    text = text.replace(/ ([,.!?;:'])/g, '$1');
    while (text.includes('""')) text = text.replace('""', '"');
    while (text.includes("''")) text = text.replace("''", "'");
    text = text.replace(/\s+/g, ' ').trim();
    if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) text += '.';
    if (!AVAILABLE_LANGS.includes(lang)) throw new Error(`지원하지 않는 언어: ${lang}`);
    return `<${lang}>${text}</${lang}>`;
  }

  encode(text, lang) {
    const t = this.preprocess(text, lang);
    const ids = [];
    for (const ch of t) {
      const cp = ch.codePointAt(0);
      ids.push(cp < this.indexer.length ? this.indexer[cp] : -1);
    }
    return ids;
  }
}

function chunkText(text, maxLen) {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > maxLen) { chunks.push(cur); cur = s; }
    else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function gaussian() {
  const u1 = Math.max(1e-4, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export class SupertonicTTS {
  constructor() {
    this.onnxDir = null;
    this.voiceDir = null;
    this.source = null;
    this.cfgs = null;
    this.proc = null;
    this.sessions = null;
    this.backend = null;
    this.styles = new Map();
    this.lock = Promise.resolve(); // session.run 직렬화
  }

  get sampleRate() { return this.cfgs.ae.sample_rate; }

  async load(onStatus) {
    const t0 = performance.now();
    try { await navigator.storage?.persist?.(); } catch (_) { /* 지원 안 함 */ }
    await loadOrt(onStatus);
    const names = [
      ['dp', 'duration_predictor.onnx'],
      ['enc', 'text_encoder.onnx'],
      ['vec', 'vector_estimator.onnx'],
      ['voc', 'vocoder.onnx'],
    ];
    const tried = [];
    for (const src of SOURCES) {
      const onnxDir = `${src.base}/onnx`;
      try {
        onStatus?.('AI 목소리 설정을 불러오는 중');
        const cfgs = await fetchJSON(`${onnxDir}/tts.json`);
        if (!cfgs?.ae?.sample_rate || !cfgs?.ttl?.latent_dim) throw new Error('tts.json 형식이 다름');
        const indexer = await fetchJSON(`${onnxDir}/unicode_indexer.json`);
        this.cfgs = cfgs;
        this.proc = new UnicodeProcessor(indexer);
        this.onnxDir = onnxDir;
        this.voiceDir = `${src.base}/voice_styles`;
        this.source = src.name;
      } catch (e) {
        tried.push(`${onnxDir}: ${e.message}`);
        console.warn(`[tts] 모델 위치 건너뜀: ${onnxDir}`, e);
        continue;
      }
      // 모델 파일을 하나씩 받아(또는 캐시에서 읽어) 바로 세션을 만들고, 버퍼는 곧바로 놓아 줌
      const s = {};
      try {
        for (let i = 0; i < names.length; i++) {
          const [key, file] = names[i];
          let buf = await fetchCached(`${this.onnxDir}/${file}`, (n, total, cached) => {
            const mb = (x) => (x / 1048576).toFixed(1);
            onStatus?.(cached
              ? `저장된 AI 목소리를 불러오는 중 (${i + 1}/4)`
              : `AI 목소리 내려받는 중 (${i + 1}/4) ${total ? `${mb(n)} / ${mb(total)}` : mb(n)} MB`);
          });
          onStatus?.(`AI 목소리 준비 중 (${i + 1}/4)`);
          s[key] = await ort.InferenceSession.create(new Uint8Array(buf), {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
          });
          buf = null;
        }
        this.sessions = s;
        this.backend = 'WASM';
        break;
      } catch (e) {
        for (const done of Object.values(s)) { try { await done.release(); } catch (_) { /* ignore */ } }
        tried.push(`${onnxDir}: ${e.message}`);
        console.warn(`[tts] ${src.name} 모델을 열지 못해 다음 위치로`, e);
        if (/다운로드 실패|Failed to fetch|Load failed|NetworkError/i.test(e?.message || '')) throw e;
      }
    }
    if (!this.sessions) throw new Error(`AI 목소리 모델을 찾지 못했어요. ${tried.join(' / ')}`);
    await this.style(VOICES[0]);
    // 지금 쓰는 파일이 아닌 예전 모델 파일(다른 리비전 등)은 기기 저장소에서 지움
    try {
      const cache = await openCache();
      const inUse = new Set(names.map(([, file]) => `${this.onnxDir}/${file}`));
      for (const req of (await cache?.keys()) || []) {
        if (req.url.endsWith('.onnx') && !inUse.has(req.url)) await cache.delete(req);
      }
    } catch (_) { /* 정리 실패는 무시 */ }
    this.loadSeconds = (performance.now() - t0) / 1000;
    console.info(`[tts] 로딩 ${this.loadSeconds.toFixed(1)}s, ${this.source}, threads=${ort.env.wasm.numThreads}, crossOriginIsolated=${self.crossOriginIsolated}`);
  }

  async style(name) {
    if (this.styles.has(name)) return this.styles.get(name);
    const j = await fetchJSON(`${this.voiceDir}/${name}.json`);
    const td = j.style_ttl.dims;
    const dd = j.style_dp.dims;
    const st = {
      ttl: new ort.Tensor('float32', Float32Array.from(j.style_ttl.data.flat(Infinity)), [1, td[1], td[2]]),
      dp: new ort.Tensor('float32', Float32Array.from(j.style_dp.data.flat(Infinity)), [1, dd[1], dd[2]]),
    };
    this.styles.set(name, st);
    return st;
  }

  // check: 모델 실행 사이마다 부름. 취소됐으면 AbortError 를 던져 합성 중인 문장도 중간에 멈춤.
  async _infer(text, lang, st, steps, speed, check = async () => {}) {
    const { dp, enc, vec, voc } = this.sessions;
    const ids = this.proc.encode(text, lang);
    const L = ids.length;
    const textIds = new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, L]);
    const textMask = new ort.Tensor('float32', new Float32Array(L).fill(1), [1, 1, L]);

    await check();
    const dOut = await dp.run({ text_ids: textIds, style_dp: st.dp, text_mask: textMask });
    const dur = dOut.duration.data[0] / speed;

    const eOut = await enc.run({ text_ids: textIds, style_ttl: st.ttl, text_mask: textMask });
    const textEmb = eOut.text_emb;

    const sr = this.cfgs.ae.sample_rate;
    const chunk = this.cfgs.ae.base_chunk_size * this.cfgs.ttl.chunk_compress_factor;
    const dim = this.cfgs.ttl.latent_dim * this.cfgs.ttl.chunk_compress_factor;
    const wavLen = Math.floor(dur * sr);
    const T = Math.max(1, Math.ceil(wavLen / chunk));

    let xt = new Float32Array(dim * T);
    for (let i = 0; i < xt.length; i++) xt[i] = gaussian();
    const latentMask = new ort.Tensor('float32', new Float32Array(T).fill(1), [1, 1, T]);
    const totalStep = new ort.Tensor('float32', new Float32Array([steps]), [1]);

    for (let s = 0; s < steps; s++) {
      await check();
      const out = await vec.run({
        noisy_latent: new ort.Tensor('float32', xt, [1, dim, T]),
        text_emb: textEmb,
        style_ttl: st.ttl,
        latent_mask: latentMask,
        text_mask: textMask,
        current_step: new ort.Tensor('float32', new Float32Array([s]), [1]),
        total_step: totalStep,
      });
      xt = new Float32Array(out.denoised_latent.data);
    }

    await check();
    const vOut = await voc.run({ latent: new ort.Tensor('float32', xt, [1, dim, T]) });
    const wav = vOut.wav_tts.data;
    return wav.slice(0, Math.min(wav.length, wavLen || wav.length));
  }

  // 한 줄(대사)을 합성해 Float32Array(PCM, sampleRate) 반환.
  // signal 이 abort 되면 시작 전인 작업은 건너뛰고, 합성 중인 작업도 모델 실행 사이에서 멈춤
  // (다른 이야기로 바꾸거나 목소리·품질을 바꿨을 때 낡은 합성이 줄을 막지 않도록).
  synth(text, { voice = 'F1', lang = 'ko', steps = 8, speed = 1.05, gap = 0.25, signal, onStart } = {}) {
    const job = this.lock.then(async () => {
      // 앞 작업이 끝나면 곧바로(마이크로태스크로) 다음 작업이 시작돼서, 그 사이 도착한 취소 메시지가 처리될 틈이 없음.
      // 한 번 이벤트 루프에 양보해 취소 메시지를 먼저 받은 뒤 확인함(워커에서 취소한 문장을 헛되이 합성하던 문제).
      const check = async () => {
        await new Promise((r) => setTimeout(r, 0));
        if (signal?.aborted) throw new DOMException('취소됨', 'AbortError');
      };
      await check();
      onStart?.();
      const t0 = performance.now();
      const st = await this.style(voice);
      const maxLen = lang === 'ko' || lang === 'ja' ? 120 : 300;
      const parts = [];
      for (const c of chunkText(text, maxLen)) parts.push(await this._infer(c, lang, st, steps, speed, check));
      const silence = Math.floor(gap * this.sampleRate);
      const total = parts.reduce((a, p) => a + p.length, 0) + silence * Math.max(0, parts.length - 1);
      const out = new Float32Array(total);
      let off = 0;
      parts.forEach((p, i) => { out.set(p, off); off += p.length + (i < parts.length - 1 ? silence : 0); });
      const sec = (performance.now() - t0) / 1000;
      const audio = out.length / this.sampleRate;
      console.info(`[tts] ${this.backend} ${lang} steps=${steps} voice=${voice} 합성 ${sec.toFixed(2)}s / 음성 ${audio.toFixed(2)}s `
        + `(RTF ${(sec / Math.max(audio, 0.01)).toFixed(2)}) "${text.slice(0, 20)}"`);
      return out;
    });
    this.lock = job.catch(() => {});
    return job;
  }
}
