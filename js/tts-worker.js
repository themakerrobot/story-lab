// AI 목소리 워커: 모델 준비와 합성을 화면 스레드 밖에서 돌려, 무거운 계산 중에도 쪽 넘김이 멈추지 않게 한다.
// yjworks/story-play 의 tts-worker.js 를 바탕으로 함. 주고받는 말은 tts-client.js 참고
import { SupertonicTTS } from './tts.js';

const tts = new SupertonicTTS();
const cancelled = new Set();
const post = (msg, transfer) => self.postMessage(msg, transfer || []);

self.onmessage = async ({ data }) => {
  const { type, id } = data;
  try {
    if (type === 'load') {
      await tts.load((msg) => post({ type: 'status', msg }));
      post({ type: 'ready', id, backend: tts.backend, source: tts.source, sampleRate: tts.sampleRate });
    } else if (type === 'style') {
      await tts.style(data.voice);
      post({ type: 'done', id });
    } else if (type === 'synth') {
      const signal = { get aborted() { return cancelled.has(id); } };
      const pcm = await tts.synth(data.text, { ...data.opts, signal });
      cancelled.delete(id);
      post({ type: 'audio', id, pcm }, [pcm.buffer]);
    } else if (type === 'cancel') {
      cancelled.add(id);
    }
  } catch (e) {
    cancelled.delete(id);
    post({ type: 'error', id, name: e?.name || 'Error', message: e?.message || String(e) });
  }
};
