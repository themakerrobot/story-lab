// 화면 쪽 AI 목소리 창구. 가능하면 tts-worker.js(별도 스레드)에서 돌리고, 워커를 못 쓰면 화면 스레드에서 직접 돌린다.
// yjworks/story-play 의 tts-client.js 를 바탕으로 함. core.js 는 createTTS() 가 돌려주는 객체의 load, synth, sampleRate 만 쓴다.
export const VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];

class WorkerTTS {
  constructor(worker) {
    this.worker = worker;
    this.inWorker = true;
    this.seq = 0;
    this.jobs = new Map();
    this.onStatus = null;
    worker.onmessage = ({ data }) => this.receive(data);
    worker.onerror = (e) => {
      const err = new Error(`AI 목소리 워커 오류: ${e.message || '알 수 없음'}`);
      for (const j of this.jobs.values()) j.reject(err);
      this.jobs.clear();
    };
  }

  receive(m) {
    if (m.type === 'status') { this.onStatus?.(m.msg); return; }
    const job = this.jobs.get(m.id);
    if (!job) return;
    this.jobs.delete(m.id);
    if (m.type === 'error') {
      job.reject(m.name === 'AbortError' ? new DOMException(m.message, 'AbortError') : Object.assign(new Error(m.message), { name: m.name }));
    } else job.resolve(m);
  }

  call(type, payload = {}) {
    const id = ++this.seq;
    return {
      id,
      promise: new Promise((resolve, reject) => {
        this.jobs.set(id, { resolve, reject });
        this.worker.postMessage({ type, id, ...payload });
      }),
    };
  }

  async load(onStatus, { single = false } = {}) {
    this.onStatus = onStatus;
    const r = await this.call('load', { single }).promise;
    Object.assign(this, { backend: r.backend, source: r.source, sampleRate: r.sampleRate });
  }

  // 멈춘 워커를 버린다. 기다리던 일은 모두 실패로 끝낸다
  terminate() {
    this.worker.terminate();
    const err = new Error('AI 목소리 준비가 멈춰 다시 시작해요');
    for (const j of this.jobs.values()) j.reject(err);
    this.jobs.clear();
  }

  async style(voice) { await this.call('style', { voice }).promise; }

  synth(text, { signal, ...opts } = {}) {
    if (signal?.aborted) return Promise.reject(new DOMException('취소됨', 'AbortError'));
    const { id, promise } = this.call('synth', { text, opts });
    signal?.addEventListener?.('abort', () => this.worker.postMessage({ type: 'cancel', id }), { once: true });
    return promise.then((m) => m.pcm);
  }
}

export async function createTTS() {
  try {
    const worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
    return new WorkerTTS(worker);
  } catch (e) {
    console.warn('[tts] 워커를 만들 수 없어 화면 스레드에서 실행', e);
    const { SupertonicTTS } = await import('./tts.js');
    const tts = new SupertonicTTS();
    tts.inWorker = false;
    return tts;
  }
}
