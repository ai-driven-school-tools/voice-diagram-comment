---
name: setting-up-comment-tool
description: 音声図解コメントツールの初期セットアップ（Vercel・Neon・Gemini APIキー）を対話的にガイドするスキル。「セットアップして」「セットアップの続きをして」「コメントツールをセットアップして」「フィードバック機能を設定して」「音声図解コメントツールを使えるようにして」と依頼された際、および「コメントが保存されません」などセットアップ起因のトラブル調査を求められた際に使用する。
---

# Setting Up Comment Tool

図解に対するコメント機能（テキスト引用・ピン・音声）を使えるようにする初期セットアップ。Vercel（ホスティング）・Neon Postgres（データベース）・Gemini APIキー（音声解析）の設定を対話的にガイドする。

**実行するのは1回だけ。** セットアップ完了後は、図解を作ってsurge.shにデプロイするだけで自動的にコメント機能が付く。

## 用語の定義

- **ツールフォルダ**: このツール本体（`package.json` の name が `voice-diagram-comment-tool` のフォルダ）。`npm` / `vercel` コマンドはすべてここで実行する
- **リポジトリルート**: `.claude` フォルダがある階層。`fb-tool-url.txt` / `fb-api-token.txt` はここに保存する（デプロイスクリプトがここから読むため）

## Step 0: ツールフォルダの特定

1. ワークスペースのルートに `package.json` があり、name が `voice-diagram-comment-tool` なら、ルートがツールフォルダ（単体利用）
2. なければ、ワークスペース内から name が `voice-diagram-comment-tool` の `package.json` を探す（別リポジトリに組み込んだ利用。フォルダ名は通常 `voice-diagram-comment`）
3. 見つからない場合、以下を伝えて終了:

> ツール本体のフォルダが見つかりません。「voice-diagram-comment」（音声図解コメントツール）フォルダがこのリポジトリ内にあるか確認してください。

## 前提確認

### Node.js

```bash
node --version
```

バージョン番号が表示された → 次に進む。
`command not found` → `.claude/skills/creating-visual-explainers/references/node-install-guide.md` の手順でインストールを案内する。

### Vercel CLI

```bash
vercel --version
```

バージョン番号が表示された → 次に進む。
`command not found` → 以下を実行:

```bash
npm install -g vercel
```

## ワークフロー

以降のコマンドは、明記がない限り**ツールフォルダで実行する**。

### Step 1: 依存関係のインストール

```bash
npm install
```

### Step 2: Vercelにログイン

```bash
vercel login
```

ブラウザが開く。以下を伝える:

> ブラウザでVercelのログイン画面が開きます。
> アカウントを持っていない場合は「Sign Up」から無料アカウントを作成してください。
> メールアドレスまたはGitHubアカウントで登録できます。
> ログインが完了したら、ターミナルに戻ってください。

### Step 3: Vercelに初回デプロイ

先にデプロイしてVercelプロジェクトを作成する（環境変数の設定にはプロジェクトが必要なため）。

自動命名に任せると名前の衝突などで不正になることがある。最初にプロジェクト名を明示してリンクする:

```bash
vercel link --yes --project voice-diagram-comment-tool
```

（同名プロジェクトが既にある等でエラーになったら、`voice-comment-tool-2` のように名前を変えて再実行する）

続いて本番デプロイ:

```bash
vercel --yes --prod
```

デプロイが完了すると以下の2つのURLが出力される。両方を控えておく:

- **Inspect URL**: `https://vercel.com/{slug}/{project}/...` 形式（Step 6 で使う）
- **Production URL**: `https://xxx.vercel.app` 形式（最終的なツールURL）

この時点では環境変数が未設定なのでツールはまだ動かない。そのまま次に進む。

### Step 4: APIトークンの生成と設定

APIを保護するためのトークンを生成し、Vercelの環境変数に設定する。

```bash
openssl rand -hex 16
```

**Windows（PowerShell）の場合:**

```powershell
[System.Guid]::NewGuid().ToString("N")
```

表示された文字列がトークン。これを環境変数として設定する:

```bash
echo "生成したトークン" | vercel env add API_TOKEN production
```

「生成したトークン」は実際に生成した値に置き換える。`vercel env add` が対話式プロンプトを出さずに値を受け取るよう、パイプで渡す。

同じトークンを**リポジトリルート**の `fb-api-token.txt` に保存する（1行、トークンのみ）。

### Step 5: Gemini APIキーの設定

音声フィードバック（喋った内容をAIが聞き取って図解にピンを配置する機能）に使うAPIキーを設定する。

**APIキーの値をチャットで受け取らない。** ユーザー自身にVercelの管理画面で設定してもらう。会話履歴にキーが残るのを避けるため、`vercel env add` でキーを受け取る方法は使わない。

まずキーの発行を案内する:

> 音声フィードバックには Google の Gemini というAIを使います。無料のAPIキーを発行しましょう。
>
> 1. ブラウザで https://aistudio.google.com/apikey を開く
> 2. Googleアカウントでログイン
> 3. 「APIキーを作成」（Create API key）をクリック
> 4. 表示されたキー（`AIza...` で始まる文字列）をコピー
>
> 無料枠の範囲で使えます。クレジットカードの登録は不要です。
> コピーしたキーは次に案内するVercelの画面に貼り付けます。このチャット欄には貼らないでください。

次に、ユーザーをVercelの環境変数設定画面まで誘導する。

**到達させたい状態**: 対象プロジェクトの環境変数設定に `GEMINI_API_KEY` が Production 環境で登録されていること。

**誘導の手がかり**（Vercelの画面構成は変わるため、URLパスや画面の文言を決め打ちしない）:

- Step 3 の Inspect URL からデプロイID部分を削れば、プロジェクトのダッシュボードURLになる（Step 6 と同じ要領）。まずそこを開いてもらうと、プロジェクトを探す手間がない
- 環境変数の設定は、直近の構成ではプロジェクト画面の左サイドバーの `Environment Variables` から入る。見つからない場合は Settings 配下も探してもらう
- 画面上部のセレクタが `All Projects` になっているとチーム横断の一覧になり、追加ボタンが表示されない。対象プロジェクトが選ばれた状態か確認させる
- 追加ボタンは画面右上の `Add Environment Variable`。パネルが開いたら `Type` は `Secret`（既定のまま）、`Key` に `GEMINI_API_KEY`、`Value` に発行したキー、`Environments` は `Production`（既定のまま）で保存

ユーザーに見えている画面が上記と違う場合は、**何が見えているかを聞きながら環境変数の設定画面まで誘導する**。上の手順をそのまま押し付けない。

設定できたら、値を見ずに登録の有無だけ確認する:

```bash
vercel env ls
```

`GEMINI_API_KEY` が Production に表示されていれば完了。このコマンドは変数名と対象環境だけを返すため、キーの値はAI側に渡らない。表示されない場合は、保存が完了しているか・対象プロジェクトが合っているかを確認する。

環境変数は保存しただけでは反映されない。反映は Step 8 の再デプロイで行う。

**ユーザーがキーをチャット欄に貼ってしまった場合**: そのキーは会話履歴に残るため、Google AI Studio で削除して新しく発行し直すよう案内する。削除した時点で元のキーは使えなくなる。発行は無料なので費用はかからない。

### Step 6: データベースの追加

Step 3 の Inspect URL からデプロイID部分（末尾のランダム文字列）を削り、`/stores` を付けて Storage ページの直接URLを組み立てる。

例: Inspect URL が `https://vercel.com/your-projects/voice-diagram-comment-tool/abc123xyz` なら
→ `https://vercel.com/your-projects/voice-diagram-comment-tool/stores`

ユーザーにブラウザでの操作を案内する。以下の `{StorageページURL}` を組み立てたURLに置き換えて伝える:

> コメントを保存するデータベースを追加します。ブラウザで以下のURLを開いてください。
>
> {StorageページURL}
>
> ページが開いたら、以下の操作をしてください。
>
> 1. 「Create Database」をクリック
> 2. 「Neon Postgres」を選択
> 3. プランは「Free」を選択（無料、クレジットカード不要）
> 4. 「Create」をクリック
> 5. 次の画面で:
>    - 「Search Projects」からプロジェクトを選択
>    - 「Custom Prefix」の欄を `DATABASE` に変更
>    - 「Connect」をクリック
>
> 完了したら教えてください。

### Step 7: 環境変数の取得とマイグレーション

```bash
vercel env pull .env.local
```

テーブルを作成:

```bash
npm run db:migrate
```

`Migration complete.` と表示されれば成功。

### Step 8: 再デプロイ

環境変数を反映するため、もう一度デプロイする。

```bash
vercel --prod
```

### Step 9: URLを保存する

ツールの**固定URL**（`https://プロジェクト名.vercel.app` 形式。通常は `https://voice-diagram-comment-tool.vercel.app`）を、**リポジトリルート**の `fb-tool-url.txt` に書き出す。URLのみを1行で保存する。

**注意**: `vercel --prod` の出力に表示されるランダム文字列入りのURL（例: `https://voice-diagram-comment-tool-a1b2c3-xxx.vercel.app`）は保存しない。デプロイ固有URLはVercelの保護機能により外部から読めないことがある。

保存したら、公開ページから widget.js に到達できることを確認する:

```bash
curl -s -o /dev/null -w "%{http_code}" "$(cat fb-tool-url.txt)/widget.js"
```

**Windows（PowerShell）の場合:**

```powershell
(Invoke-WebRequest "$((Get-Content fb-tool-url.txt).Trim())/widget.js").StatusCode
```

`200` ならOK。`404` や `401` が返る場合は、Vercelダッシュボードのプロジェクト → Settings → Domains に表示されているドメインを確認し、そのURLで `fb-tool-url.txt` を保存し直して再確認する。

### Step 10: 音声解析APIの通し検証

widget.js は静的ファイルなので、これだけではAPI（サーバーレス関数）が動いている保証にならない。無音の音声データを実際に `/api/voice-analyze` へ送り、Gemini まで通ることを確認する。

まず、16kHz・モノラル・1秒の無音WAVを生成してbase64化し、リクエストボディを組み立てる（**リポジトリルート**で実行）:

```bash
node -e '
const sr = 16000, dataLen = sr * 2; // 16bit mono 1秒
const b = Buffer.alloc(44 + dataLen);
b.write("RIFF", 0); b.writeUInt32LE(36 + dataLen, 4); b.write("WAVE", 8);
b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
b.write("data", 36); b.writeUInt32LE(dataLen, 40);
const body = {
  audioBase64: b.toString("base64"),
  mimeType: "audio/wav",
  targets: [{ index: 0, text: "テスト", heading: "テスト", isHeading: true }],
};
require("fs").writeFileSync("/tmp/fb-voice-check.json", JSON.stringify(body));
'
```

**Windows（PowerShell）の場合**: 上と同じ `node -e` スクリプトを実行し、出力先だけ `$env:TEMP + "\\fb-voice-check.json"` に読み替える（`node -e` はWindowsでも動く）。

続いて、APIトークンを付けてPOSTする:

```bash
curl -s -w "\n%{http_code}" -X POST "$(cat fb-tool-url.txt)/api/voice-analyze" \
  -H "Authorization: Bearer $(cat fb-api-token.txt)" \
  -H "Content-Type: application/json" \
  --data @/tmp/fb-voice-check.json
```

結果の判定:

- **HTTP 200 で `{"results":[]}`**（無音なので空配列）→ 音声解析まで通しで動いている。セットアップ成功
- **HTTP 404** → APIルートがデプロイされていない。Vercelのビルド設定の問題（エラー対応の「音声の解析に失敗しました」を参照）
- **`Gemini エラー` を含む応答** → Geminiのモデル名またはAPIキーの問題（エラー対応の「Gemini エラー (404)」を参照）
- **HTTP 403** → `fb-api-token.txt` の値と Vercel の `API_TOKEN` が食い違っている。Step 4 をやり直す

### Step 11: 完了報告

リポジトリルートに `fb-tool-url.txt` と `fb-api-token.txt` があることを確認し、以下を伝える:

```
セットアップ完了

あなたのコメントツール URL:
https://xxx.vercel.app

以降「図解を作って」と伝えるだけで、コメント機能付きの図解が公開されます。

公開した図解では、3通りの方法でフィードバックできます:
- テキストをマウスで選択してコメント
- 好きな場所にピンを刺してコメント
- マイクに向かって喋るだけ（AIが該当箇所にピンを自動配置）

APIはトークンで保護されています。図解のデプロイ時に自動で埋め込まれるため、
追加の操作は不要です。
```

`fb-tool-url.txt` / `fb-api-token.txt` / `.env.local` はGitにコミットしない（このフォルダの `.gitignore` で除外済み。別リポジトリに組み込んでいる場合は、そのリポジトリの `.gitignore` にも追加するよう案内する）。

## エラー対応

エラーメッセージをそのまま見せず、何が起きていて何をすれば解決するかを平易に説明する。

- **`vercel: command not found`** → `npm install -g vercel` を実行
- **`DATABASE_URL is not set`** → Step 6のデータベース追加が完了しているか確認。完了していれば `vercel env pull .env.local` を再実行
- **マイグレーション失敗** → ツールフォルダの `.env.local` に `DATABASE_URL` が含まれているか確認
- **音声フィードバックで「GEMINI_API_KEY が未設定です」** → Step 5が完了しているか `vercel env ls` で確認し、設定後に `vercel --prod` で再デプロイ
- **「音声の解析に失敗しました」** → まず `/api/voice-analyze` が404を返していないか確認する（`curl -s -o /dev/null -w "%{http_code}" -X POST "$(cat fb-tool-url.txt)/api/voice-analyze"` — 404以外＝APIは存在する）。404ならAPIルートがデプロイされていない。原因はVercelのビルド設定: `vercel.json` に `buildCommand` を直接書くとVercelがNext.jsを認識できず、APIが生成されない。ツールフォルダの `vercel.json` が `{"framework": "nextjs"}` のみで、`package.json` に `vercel-build` スクリプトがあることを確認し、`vercel --prod` で再デプロイする
- **「Gemini エラー (404)」** → 指定中のGeminiモデルが新規APIキーでは利用不可になっている（例: `gemini-2.5-flash` は新規ユーザーに提供終了）。`echo "gemini-flash-latest" | vercel env add GEMINI_MODEL production` で環境変数を設定し、`vercel --prod` で再デプロイする（ツールが最新版なら既定値が `gemini-flash-latest` のためこのエラーは起きない）
- **「コメントが保存されません」と相談された** → 順に切り分ける: ①Step 9の到達確認（widget.js が200か）②`vercel env ls` で `DATABASE_URL` と `API_TOKEN` が production にあるか ③マイグレーション済みか（`vercel env pull .env.local` → `npm run db:migrate`）④環境変数を後から足した場合は `vercel --prod` で再デプロイしたか

## 依存

- ツールフォルダの `package.json` — 依存関係と `db:migrate` スクリプト
- ツールフォルダの `scripts/migrate.ts` — DBマイグレーションスクリプト
- `.claude/skills/creating-visual-explainers/references/node-install-guide.md` — Node.jsインストール手順
- `.claude/skills/creating-visual-explainers/scripts/deploy-diagram.sh` — `fb-tool-url.txt` / `fb-api-token.txt` の読み取り側
