# 課題レポートPDFの開発・配置

## Webの設定

Next.jsサーバーに次の値を設定する。`NEXT_PUBLIC_` は付けない。

```dotenv
PDF_COMPILER_URL=https://hackerserver.japaneast.cloudapp.azure.com
PDF_COMPILER_API_KEY=<VMの専用コンパイラーと同じ32バイト以上のランダム秘密値>
```

既存の `AI_EXECUTION` はそのままとする。PDFだけのために `relay` に変えない。Vercel管理者がまず `feature/pdf-latex` のPreview環境へ設定する。環境変数は新しいデプロイで適用される。ローカルにある今回の変更は、GitHubへpushしてから新しいPreviewを作成する。古いコミットをRedeployしても今回の機能は含まれない。

ローカルでは `APP_ENV=local` に限り `http://127.0.0.1:8001` を指定できる。コンパイラーを起動するにはbackendの依存関係とLuaLaTeX（luatexja、原ノ味フォントを含む）が必要。

```sh
cd backend
# BACKEND_API_KEYを環境変数で設定。WebのPDF_COMPILER_API_KEYと一致させる。
uv run uvicorn app.reports_api:app --host 127.0.0.1 --port 8001
```

サーバー設定を変えた後はNext.jsを再起動する。

## Azure VM

Ubuntu 24.04の既存VMを使用する。Azureの受信規則でTCP 80/443が必要。SSHの既存設定はそのまま。8001をインターネットに公開しない。

1. `backend` のソース、`pyproject.toml`、`uv.lock`、`Dockerfile.report`、`report-warmup.tex`、`compose.report.yaml`、`Caddyfile.report`、`scripts/` をVM専用フォルダーへ転送する。秘密鍵、ローカル `.env`、`.venv` は転送しない。
2. 初回のみ `bash scripts/install-report-docker.sh` を実行する。Docker公式aptリポジトリを追加し、EngineとComposeをインストールする。既存ランタイムを検出したら停止する。
3. `bash scripts/start-report-service.sh` を実行する。`.env.report` を初回のみ生成し、権限600で保存する。キーをログに表示しない。専用Composeプロジェクト `math-notebook-pdf` を起動する。
4. 外部から `https://hackerserver.japaneast.cloudapp.azure.com/api/v1/health` が200になることを確認する。コンパイラーの8001はコンテナ内部だけで待ち受け、ホストにも公開しない。
5. `.env.report` の `BACKEND_API_KEY` を安全な経路でWeb設定へ渡す。チャット、Git、スクリーンショットに貼らない。ユーザーやブラウザに配布しない。
6. 認証なしのコンパイル要求が403になることと、Webの認証済み要求で実際のPDFが返ることを確認する。

証明書が取得できない場合はDNSとAzureの80/443受信規則を確認する。HTTPへフォールバックしない。

```sh
# 状態・ログ（本文やキーをログへ出す変更はしない）
sudo docker compose -p math-notebook-pdf -f compose.report.yaml ps
sudo docker compose -p math-notebook-pdf -f compose.report.yaml logs --tail=50
# 停止（証明書ボリュームとキーは残す）
sudo docker compose -p math-notebook-pdf -f compose.report.yaml down
```

## 検証

```sh
cd frontend
pnpm exec tsx --test tests/unit/latex-export.test.ts tests/unit/pdf-export.test.ts
pnpm exec tsx scripts/pdf-report-smoke.ts ../tmp/pdfs/latex-report
# 生成先で lualatex --no-shell-escape --nosocket -interaction=nonstopmode -halt-on-error report.tex
# 設定済み開発サーバーとコンパイラーを起動したうえで:
PDF_E2E_COMPILER=1 pnpm exec playwright test tests/e2e/pdf-export.spec.ts --workers=1
cd ../backend
uv run pytest
```

E2Eの実コンパイルケースは `PDF_E2E_COMPILER=1` のときだけ実行する。既存のブラウザPDFとエラー表示は設定なしでテストできる。PDFはPopplerで画像化し、日本語、数式、余白、改ページを目視確認する。テンプレートに由来するレイアウトであり、元サンプルの解答や外部画像は含めない。

参考: [Docker公式Ubuntu導入手順](https://docs.docker.com/engine/install/ubuntu/)、[Caddy Compose](https://caddyserver.com/docs/running#docker-compose)、[Vercel応答サイズ制限](https://vercel.com/docs/errors/function_response_payload_too_large)。
