#!/bin/bash
# 図解 HTML にコメントウィジェットの script タグを注入して surge.sh に公開する。
#
#   使い方: deploy-diagram.sh <HTMLファイル> [スラッグ]
#
# ウィジェットの配信元 URL とトークンは、セットアップスキルが
# リポジトリルートに生成する fb-tool-url.txt / fb-api-token.txt から読む。
set -e

HTML_FILE="${1:?使い方: deploy-diagram.sh <HTMLファイル> [スラッグ]}"
SLUG="${2:-}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if ! command -v node &>/dev/null; then
    echo -e "${RED}エラー: Node.js がインストールされていません${NC}" >&2
    echo "Node.js をインストールしてから、もう一度試してください。" >&2
    exit 1
fi

if [ ! -f "$HTML_FILE" ]; then
    echo -e "${RED}エラー: $HTML_FILE が見つかりません${NC}" >&2
    echo "先に図解を生成してください。" >&2
    exit 1
fi

if [ -n "$SLUG" ]; then
    DOMAIN="diagram-${SLUG}.surge.sh"
else
    DOMAIN="diagram-$(date +%y%m%d%H%M).surge.sh"
fi

# このスクリプトは <ルート>/.claude/skills/creating-visual-explainers/scripts/ に置かれる前提。
# 4階層上 = このスキル一式が置かれているリポジトリのルート
ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"

FB_URL_FILE="$ROOT_DIR/fb-tool-url.txt"
if [ ! -f "$FB_URL_FILE" ]; then
    echo -e "${RED}エラー: fb-tool-url.txt が見つかりません${NC}" >&2
    echo "チャット欄で「セットアップして」と伝えてください。" >&2
    exit 1
fi
FB_URL=$(cat "$FB_URL_FILE")

FB_TOKEN_FILE="$ROOT_DIR/fb-api-token.txt"
if [ ! -f "$FB_TOKEN_FILE" ]; then
    echo -e "${RED}エラー: fb-api-token.txt が見つかりません${NC}" >&2
    echo "セットアップが完了していない可能性があります。チャット欄で「セットアップして」と伝えてください。" >&2
    exit 1
fi
API_TOKEN=$(cat "$FB_TOKEN_FILE")

if [[ ! "$FB_URL" =~ ^https:// ]]; then
    echo -e "${RED}エラー: fb-tool-url.txt の URL が https:// で始まっていません${NC}" >&2
    exit 1
fi
if [[ "$FB_URL" =~ [\\|\&$'\n'] ]]; then
    echo -e "${RED}エラー: fb-tool-url.txt に不正な文字が含まれています${NC}" >&2
    exit 1
fi
if [[ "$API_TOKEN" =~ [\\|\&$'\n'\ ] ]]; then
    echo -e "${RED}エラー: fb-api-token.txt に不正な文字が含まれています${NC}" >&2
    exit 1
fi

if ! grep -q '</body>' "$HTML_FILE"; then
    echo -e "${RED}エラー: $HTML_FILE に </body> タグが見つかりません${NC}" >&2
    echo "HTML ファイルの構造が壊れている可能性があります。" >&2
    exit 1
fi

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

SNIPPET="<script src=\"${FB_URL}/widget.js\" data-token=\"${API_TOKEN}\"></script></body>"

# 最後の </body> だけを置換する。図解の題材が HTML やコードだと本文中にも
# </body> が現れうるため、一括置換すると script タグが複数挿し込まれて壊れる。
awk -v snippet="$SNIPPET" '
  { line[NR] = $0; if (index($0, "</body>")) last = NR }
  END {
    for (i = 1; i <= NR; i++) {
      if (i == last) {
        # 該当行の最後の </body> を置換する（sub は先頭一致なので位置を自力で求める）
        s = line[i]; pos = 0; from = 1
        while ((p = index(substr(s, from), "</body>")) > 0) {
          pos = from + p - 1
          from = pos + 7
        }
        printf "%s%s%s\n", substr(s, 1, pos - 1), snippet, substr(s, pos + 7)
      } else {
        print line[i]
      }
    }
  }
' "$HTML_FILE" > "$TEMP_DIR/index.html"

printf "User-agent: *\nDisallow: /\n" > "$TEMP_DIR/robots.txt"

echo -e "${YELLOW}公開中...${NC}"
npx --yes surge "$TEMP_DIR" --domain "$DOMAIN"

touch "$ROOT_DIR/deploy-history.log"
echo "$(date '+%Y-%m-%d %H:%M:%S') | https://${DOMAIN}" >> "$ROOT_DIR/deploy-history.log"

echo ""
echo -e "${GREEN}完了！${NC}"
echo "URL: https://${DOMAIN}"

if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "https://${DOMAIN}" | pbcopy
    echo -e "${GREEN}URLをクリップボードにコピーしました${NC}"
    open "https://${DOMAIN}"
elif command -v clip.exe &>/dev/null; then
    echo -n "https://${DOMAIN}" | clip.exe
    echo -e "${GREEN}URLをクリップボードにコピーしました${NC}"
    start "https://${DOMAIN}" 2>/dev/null || true
elif command -v xdg-open &>/dev/null; then
    xdg-open "https://${DOMAIN}"
fi

echo -e "${YELLOW}削除するとき: npx surge teardown ${DOMAIN}${NC}"
