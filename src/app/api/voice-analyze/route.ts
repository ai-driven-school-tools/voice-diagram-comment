import { NextRequest, NextResponse } from 'next/server';

// 音声ファイルを base64 で受けるため body サイズ上限を緩める
export const maxDuration = 60;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders() });
}

function verifyToken(request: NextRequest): boolean {
  const token = process.env.API_TOKEN;
  // ローカル開発ではトークン無しで動かせるようにする。本番で未設定なら、
  // 設定ミスで Gemini を誰でも叩ける状態になるより落ちた方が安全。
  if (!token) return process.env.NODE_ENV !== 'production';
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  return auth.slice(7) === token;
}

interface Target {
  index: number;
  text: string;
  heading: string;
  isHeading?: boolean;
}

// gemini-flash-latest は常に最新の flash 系モデルを指す公式エイリアス。
// 固定バージョン名（例: gemini-2.5-flash）は新規APIキーで使えなくなることがある。
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

// Gemini に JSON 配列で返させるためのスキーマ
const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      target_index: { type: 'INTEGER' },
      quote: { type: 'STRING' },
      comment: { type: 'STRING' },
      priority: { type: 'STRING', enum: ['must', 'better', 'want'] },
    },
    required: ['target_index', 'quote', 'comment', 'priority'],
  },
};

function buildPrompt(targets: Target[]): string {
  const list = targets
    .map((t) => {
      const context = t.isHeading ? '見出し' : t.heading || '（見出しなし）';
      return `${t.index}\t[${context}]\t${t.text}`;
    })
    .join('\n');
  return [
    'あなたは図解レビューのフィードバック解析AIです。',
    'ユーザーが音声で話したフィードバックを聞き取り、図解のどの部分に対する指摘かを1つずつ特定してください。',
    '',
    '# 図解の要素一覧',
    '各行は「index<TAB>[分類]<TAB>その要素に表示されている文字」です。',
    '[分類] が「見出し」の行はセクションの見出しそのもの、それ以外はその名前のセクションに属する本文・ラベルです。',
    'ピンはあなたが選んだ要素の真上に立ちます。',
    list,
    '',
    '# 指示',
    '- 音声を聞き、指摘・要望・感想を1件ずつ抽出する',
    '- quote には、その指摘の根拠になった発言を音声のまま短く書き出す',
    '- target_index は、話者が実際に言及した語句と最も一致する要素を選ぶ',
    '- 話者が具体的な文言（カードのラベル・数字・固有名詞など）を口にしたら、見出しではなくその文言そのものの要素を選ぶ',
    '- 具体的な文言がなく話題だけ分かる場合は、そのセクションの見出し要素を選ぶ',
    '- どの要素にも結び付けられない場合だけ target_index に -1 を入れる',
    '- comment はユーザーの意図を簡潔にまとめた日本語にする',
    '- priority は次の基準で割り当てる: 修正が必須=must / 改善してほしい=better / 軽微な要望や肯定的な発言=want',
    '- 「ここはOK」「良い」などの肯定的な発言も want として記録する',
    '- 指摘が複数あれば配列で複数返す。何も聞き取れなければ空配列を返す',
  ].join('\n');
}

export async function POST(request: NextRequest) {
  if (!verifyToken(request)) return json({ error: 'Unauthorized' }, 403);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY が未設定です' }, 500);
  }

  let body: { audioBase64?: string; mimeType?: string; targets?: Target[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'リクエストボディが不正です' }, 400);
  }

  const { audioBase64, mimeType, targets } = body;
  if (!audioBase64) return json({ error: '音声データがありません' }, 400);
  if (!Array.isArray(targets) || targets.length === 0) {
    return json({ error: 'ページの要素情報がありません' }, 400);
  }

  // Gemini は codecs パラメータ付き mimeType を嫌うことがあるためベース型に正規化
  const audioMime = (mimeType || 'audio/webm').split(';')[0];

  const geminiBody = {
    contents: [
      {
        parts: [
          { text: buildPrompt(targets) },
          { inlineData: { mimeType: audioMime, data: audioBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  let geminiRes: Response;
  try {
    geminiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(geminiBody),
    });
  } catch {
    return json({ error: 'Gemini への接続に失敗しました' }, 502);
  }

  if (!geminiRes.ok) {
    const detail = await geminiRes.text().catch(() => '');
    return json({ error: `Gemini エラー (${geminiRes.status})`, detail }, 502);
  }

  const data = await geminiRes.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return json({ error: 'Gemini から有効な応答が得られませんでした' }, 502);
  }

  let results: unknown;
  try {
    results = JSON.parse(text);
  } catch {
    return json({ error: 'Gemini 応答の JSON パースに失敗しました', detail: text }, 502);
  }

  return json({ results });
}
