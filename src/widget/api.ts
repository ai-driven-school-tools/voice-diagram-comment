import { authHeaders } from '../shared/api-client';

let apiBase = '';
let apiToken = '';

export function initApi(base: string, token: string): void {
  apiBase = base;
  apiToken = token;
}

export function api(method: string, params: Record<string, unknown>): Promise<unknown> {
  let url = apiBase + '/api/comments';
  const hdrs = authHeaders(apiToken);
  const opts: RequestInit = { method, headers: hdrs };
  if (method === 'GET') {
    url += '?slug=' + encodeURIComponent(params.slug as string);
  } else if (method === 'DELETE') {
    url += '?id=' + encodeURIComponent(params.id as string);
  } else {
    opts.body = JSON.stringify(params);
  }
  return fetch(url, opts).then((r) => r.json());
}

export interface VoiceTargetInput {
  index: number;
  text: string;      // その要素に表示されている文字
  heading: string;   // 直前の見出し（どのセクションの中か）
  isHeading: boolean; // 見出し要素そのものか
}

export interface VoiceResult {
  target_index: number;  // 一致する要素がなければ -1
  quote: string;         // 判断の根拠になった発言
  comment: string;
  priority: string;
}

/**
 * 録音した音声(base64) + ページ上の要素一覧を /api/voice-analyze に送り、
 * Gemini が「文字起こし＋要素への振り分け」した結果を受け取る。
 */
export function voiceApi(
  audioBase64: string,
  mimeType: string,
  targets: VoiceTargetInput[],
): Promise<{ results?: VoiceResult[]; error?: string }> {
  return fetch(apiBase + '/api/voice-analyze', {
    method: 'POST',
    headers: authHeaders(apiToken),
    body: JSON.stringify({ audioBase64, mimeType, targets }),
  }).then((r) => r.json());
}
