import type { Priority } from '../shared/types';
import { state } from './state';
import { addPin, renderPins, elementToPinCoords, anchorFromElement, type PinAnchor } from './pin';
import { voiceApi, type VoiceResult } from './api';

interface Target {
  index: number;
  text: string;      // その要素に表示されている文字
  heading: string;   // 直前の見出し（Gemini に渡す文脈）
  isHeading: boolean; // 見出し要素そのものか
  x: number;         // ピン座標系（%）
  y: number;         // ピン座標系（px）
  anchor: PinAnchor;  // 要素アンカー（レスポンシブ追従）
}

let mediaRecorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let stream: MediaStream | null = null;
let onChange: () => void = () => {};

/** 録音状態が変わったときに UI を再描画させるためのコールバックを登録する。 */
export function setVoiceOnChange(cb: () => void): void {
  onChange = cb;
}

function getContainer(): HTMLElement {
  return document.querySelector('main') || document.body;
}

const BLOCK_SELECTOR = 'div,p,li,td,th,dt,dd,figcaption,blockquote,h1,h2,h3,h4,h5,h6';
const HEADING_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
const WIDGET_UI = '#fb-sidebar,#fb-toggle,#fb-pin-popup,.fb-pin-marker,.fb-pin-tooltip,.fb-voice-toast';
const MIN_TEXT = 2;     // 「1」のような装飾番号を除く
const MAX_TEXT = 120;   // これより長いものは「まとまり」ではなく本文の塊とみなす
const MAX_TARGETS = 600;

/**
 * 音声の指摘を紐づける候補要素を抽出する。
 *
 * 見出しだけを候補にすると、図解の中身（カードのラベルや短い説明文）を
 * 名指しされても一番近い見出しにしか置けない。そこで「テキストを持つ最小の
 * ブロック」＝それ以上分解できない表示単位を候補にする。
 * 各候補には直前の見出しを添えて、Gemini がどのセクションの話か判断できるようにする。
 */
export function extractTargets(): Target[] {
  const container = getContainer();

  // テキストを持つブロックのうち、内側に別のブロックを含まないもの＝最小単位
  const blocks = (Array.from(container.querySelectorAll(BLOCK_SELECTOR)) as HTMLElement[]).filter(
    (el) => (el.textContent || '').trim() && !el.closest(WIDGET_UI),
  );
  const leaves = new Set(blocks.filter((el) => !blocks.some((o) => o !== el && el.contains(o))));

  const targets: Target[] = [];
  let heading = '';

  // 文書順に走査して「直前の見出し」を引き継ぎながら候補を積む
  (Array.from(container.querySelectorAll('*')) as HTMLElement[]).forEach((el) => {
    const isHeading = HEADING_TAGS.includes(el.tagName);
    if (isHeading) {
      const t = normalize(el.textContent || '');
      if (t) heading = t;
    }
    if (!leaves.has(el) || targets.length >= MAX_TARGETS) return;

    const text = normalize(el.textContent || '');
    if (text.length < MIN_TEXT || text.length > MAX_TEXT) return;

    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return; // 非表示・つぶれた要素

    const { x, y } = elementToPinCoords(el);
    targets.push({
      index: targets.length,
      text,
      // 見出し自身は自分の文言と重複するので文脈を持たせない
      heading: isHeading ? '' : heading,
      isHeading,
      x,
      y,
      anchor: anchorFromElement(el),
    });
  });

  return targets;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function toggleRecording(): void {
  if (state.voiceProcessing) return;
  if (state.voiceRecording) {
    stopRecording();
  } else {
    void startRecording();
  }
}

export async function startRecording(): Promise<void> {
  if (state.voiceRecording || state.voiceProcessing) return;
  state.voiceError = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    state.voiceError = 'マイクへのアクセスが許可されませんでした';
    onChange();
    return;
  }

  chunks = [];
  const mime = pickMime();
  mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    void handleStop();
  };
  mediaRecorder.start();

  state.voiceRecording = true;
  onChange();
}

export function stopRecording(): void {
  if (!state.voiceRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  state.voiceRecording = false;
  state.voiceProcessing = true;
  onChange();
}

async function handleStop(): Promise<void> {
  // マイクを解放
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;

  const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
  chunks = [];

  const targets = extractTargets();
  if (targets.length === 0) {
    state.voiceError = 'ピンを置ける要素が見つかりませんでした';
    state.voiceProcessing = false;
    onChange();
    return;
  }
  if (targets.length >= MAX_TARGETS) {
    // 上限で打ち切ると後半にピンを置けない。黙って効かないより伝える。
    state.voiceError = `ページが大きいため、先頭${MAX_TARGETS}箇所のみを対象にしています`;
  }

  try {
    // 録音(webm/mp4等) を Gemini が確実に扱える 16kHz モノラル WAV に変換して送る
    const base64 = await blobToWavBase64(blob);
    const resp = await voiceApi(
      base64,
      'audio/wav',
      targets.map((t) => ({ index: t.index, text: t.text, heading: t.heading, isHeading: t.isHeading })),
    );
    if (resp.error) {
      state.voiceError = resp.error;
    } else {
      placePins(resp.results || [], targets);
    }
  } catch {
    state.voiceError = '音声の解析に失敗しました';
  } finally {
    state.voiceProcessing = false;
    onChange();
  }
}

function placePins(results: VoiceResult[], targets: Target[]): void {
  if (!Array.isArray(results) || results.length === 0) {
    state.voiceError = 'フィードバックを聞き取れませんでした。もう一度お試しください';
    return;
  }
  let misplaced = 0;
  results.forEach((r) => {
    let target = targets.find((t) => t.index === r.target_index);
    if (!target) {
      // Gemini が該当なし(-1)や範囲外を返した場合。発言に含まれる語句と
      // 要素のテキストを突き合わせて置き場所を探す。
      target = findByText(`${r.quote || ''} ${r.comment || ''}`, targets);
    }
    if (!target) {
      // それでも決まらなければ捨てずに先頭へ。位置は当てにならないと伝える。
      target = targets[0];
      misplaced++;
    }
    if (!target) return;
    addPin(target.x, target.y, r.comment, normalizePriority(r.priority), target.anchor);
  });
  if (misplaced > 0) {
    state.voiceError = `${misplaced}件は場所を特定できませんでした（先頭に置いています。ドラッグで移動できます）`;
  }
  renderPins();
}

const MATCH_THRESHOLD = 0.34;
const MATCH_MIN_LEN = 4;

/**
 * 発言テキストに最も近い要素を、2文字単位の一致率で探す。
 *
 * 一致率は短い方を分母にするため、「0点」「講義」のような2〜3文字の要素は
 * たまたま含まれるだけで満点になってしまう。照合対象はある程度の長さを持つ
 * 要素に絞り、同点なら情報量の多い（長い）方を選ぶ。
 */
function findByText(query: string, targets: Target[]): Target | undefined {
  const q = bigrams(query);
  if (q.size === 0) return undefined;
  let best: Target | undefined;
  let bestScore = MATCH_THRESHOLD;
  targets.forEach((t) => {
    if (t.text.length < MATCH_MIN_LEN) return;
    const score = overlap(q, bigrams(t.text));
    if (score > bestScore || (best && score === bestScore && t.text.length > best.text.length)) {
      bestScore = score;
      best = t;
    }
  });
  return best;
}

function bigrams(s: string): Set<string> {
  const t = s.replace(/\s+/g, '').toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** 短い方に対する一致率。要素テキストは短いので Jaccard より当たりやすい。 */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  a.forEach((g) => { if (b.has(g)) hit++; });
  return hit / Math.min(a.size, b.size);
}

function normalizePriority(p: string): Priority {
  return p === 'must' || p === 'better' || p === 'want' ? p : 'better';
}

/** MediaRecorder が対応する音声形式を優先順に選ぶ。 */
function pickMime(): string {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  for (const c of cands) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return '';
}

/**
 * 録音 Blob を 16kHz モノラルの WAV (base64) に変換する。
 * Gemini の対応音声形式（wav/mp3/aiff/aac/ogg/flac）に確実に乗せ、
 * かつ 16kHz モノラルに落としてペイロードを小さくする。
 */
async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuf = await blob.arrayBuffer();
  const AudioCtx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuf);
  } finally {
    void ctx.close();
  }

  const targetRate = 16000;
  const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
  // チャンネル数1の出力に繋ぐと自動でモノラルにダウンミックスされる
  const offline = new OfflineAudioContext(1, length, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();

  const wav = encodeWav(rendered.getChannelData(0), targetRate);
  return arrayBufferToBase64(wav);
}

/** Float32 PCM を 16bit モノラル WAV (ArrayBuffer) にエンコードする。 */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);     // PCM チャンクサイズ
  view.setUint16(20, 1, true);      // PCM
  view.setUint16(22, 1, true);      // モノラル
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate = rate * blockAlign
  view.setUint16(32, 2, true);      // blockAlign = ch * bytesPerSample
  view.setUint16(34, 16, true);     // bitsPerSample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
