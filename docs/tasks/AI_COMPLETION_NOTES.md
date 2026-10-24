# AI数式補完 実装メモ

最終更新：2026-10-24（段階1 完了時点）。担当：AI数式補完（M-06）。

**方針（人間の決定）**：案A＝Python の suggest は作らない。既存の TypeScript 実装を仕上げる。基準設計書は `docs/design/v2.0-en.md` + `v2.1-deltas.md` + ADR。`docs/tasks/AI_COMPLETION_TASK.md`（v1.9 前提）は担当範囲の考え方と「他担当の領域に触らない」ルールだけを参照する。v1.9 前提の部分は失効しており、末尾の「履歴」にある。

**役割分担（チーム決定）**：機能ごとの縦割り。私は **③ AI数式補完担当**（2モード補完 API、CAS 事前検証連携、破線プレビュー UI、未解決エラー時のロック）。他の担当は ①＝筆記・Canvas・履歴、②＝CAS・復帰（修正）、④＝問題カード・PDF・LaTeX 出力、⑤＝共有基盤・QA。

**触ってよい（③）**
- `engine.ts` の補完まわりの関数：`requestSuggestion`、`scheduleSuggestion`、`cancelSuggestion`、`verifyCandidate`、`adopt`、`reject`、`suggestBlocker`、`canSuggest`、`isStale`、`maybeReleaseHeld`
- `notebook-store.ts` の候補に関する型と状態（`candidate`、`rejectedHashes`、`rejectedLatex` など）
- `ghost-line.tsx`、`frontend/src/server/ai/direct/` の suggest 関係、`frontend/src/core/candidates/`、`frontend/tests/unit/suggest/`、この NOTES
- i18n（`en.ts`、`ja.ts`）は **新しいキーの追加だけ**。既存キーの変更は不可

**触らない**
- ①：`engine.ts` の `addStroke`、`eraseStrokes`、`clearDraft`、`confirmLine`、`undo`／`redo`、コンストラクタ
- ②：`startRevision`、`markRecovery`、`model.ts`
- ④：`editProblem`、PDF・LaTeX 関係
- ⑤・共有：`package.json`、Playwright 設定、mock provider、`packages/contracts`、`client.ts`、gateway の共通処理
- 触らない関数でないと実現できない項目は飛ばし、「依頼事項」に書く。

## 現在の状態（段階1）

### 変更したファイル

| ファイル | 種別 | 内容 |
| --- | --- | --- |
| `frontend/src/server/ai/direct/candidate.ts` | 修正 | R6b：重複判定と `content_hash` を数式セグメントの `expr`＋`notation` だけで計算（`lineHash`／`candidateHash` を使用）。他の挙動は不変 |
| `frontend/src/core/candidates/hash.ts` | 新規 | `mathKey`、`lineHash`、`candidateHash` |
| `frontend/src/core/candidates/blocker.ts` | 新規 | `suggestBlockerOf`（`NotebookEngine.suggestBlocker` と同じ判定。入力は `notebook`・`casReady`・`candidate` の状態・`activeLine`）、`suggestModeOf`（`requestSuggestion` のモード選択。依頼外の追加で、テスト D2 のため） |
| `frontend/src/core/candidates/slot.ts` | 新規 | `matchesSlot`／`mismatchedFields`（`request_id`・`notebook_id`・`client_session_id`・`client_epoch`・`line_id`・`line_version`・`context_fingerprint` の 7 項目） |
| `frontend/src/core/candidates/rejection.ts` | 新規 | `rejectionKey(semanticHash, mode, target)`、`targetKindOf` |
| `frontend/tests/unit/suggest/` | 新規 | `fixtures.ts`、`candidate.test.ts`（A）、`service.test.ts`（B ＋ デモ台本の回帰）、`model.test.ts`（C）、`client.test.ts`（H）、`pure.test.ts`（上の純関数）、`pending-fixes.test.ts`（skip） |

`engine.ts` からは **まだ呼んでいない**（`core/candidates/` の純関数は未使用のまま。`candidate.ts` だけが `hash.ts` を使う）。

### テスト結果

| ファイル | 件数 | 通過 | 失敗 | skip |
| --- | --- | --- | --- | --- |
| `candidate.test.ts` | 11 | 11 | 0 | 0 |
| `pure.test.ts` | 22 | 22 | 0 | 0 |
| `model.test.ts` | 10 | 10 | 0 | 0 |
| `service.test.ts` | 13 | 13 | 0 | 0 |
| `client.test.ts` | 9 | 9 | 0 | 0 |
| `pending-fixes.test.ts` | 8 | 0 | 0 | 8 |
| **合計（`tests/unit/suggest/*.test.ts`）** | **73** | **65** | **0** | **8** |
| 既存 `tests/unit/history.test.ts`（変更なし） | 3 | 3 | 0 | 0 |

`tsc --noEmit`（frontend）はエラーなし。`eslint`（新規・変更ファイル）は警告・エラーなし。

**R6b の確認**：`candidate.ts` を変更前に戻すと `A6`・`A7b`・`A8` の 3 件が失敗し、変更後は通る（`git stash` で確認済み）。

**skip の 8 件**（`pending-fixes.test.ts`）：D3、G3、G4、G5、G6、G9、F3、I2。理由は各 `it.skip` の上のコメントに、どのファイルの誰の許可待ちかを含めて書いてある。

### 実行したコマンド

```sh
# 依存が無かったので一度だけ（lockfile は変わらない。node_modules は .gitignore 済み）
npx -y pnpm@10 install --frozen-lockfile --ignore-scripts

cd frontend
npx tsx --test --conditions=react-server tests/unit/suggest/*.test.ts      # 73 件（所要 約18秒）
npx tsx --test tests/unit/history.test.ts                                   # 既存 3 件
npx tsc --noEmit
npx eslint src/core/candidates tests/unit/suggest src/server/ai/direct/candidate.ts
```

### 試験結果

環境はすべて **mock（`LLM_PROVIDER=mock`、台本 AI）＋実 CAS（Pyodide 314.0.7 + SymPy、ブラウザ内）、ローカル（Windows 11、Chromium 1248、`next dev` :3100、認証はバイパス）**。コミット＝`0548c91`（`Riku_feature`）。live の LLM では未実施なので、live の合格としては数えない。

| ID | 結果 | 日時 | 環境（live / mock、provider/model、コミット） |
| --- | --- | --- | --- |
| `tests/unit/suggest/*.test.ts` 73 件（A・B・C・H・純関数・skip 8） | 65 通過／0 失敗／8 skip | 2026-10-24 | mock（単体、LLM 呼び出しなし）、ローカル、`0548c91` の作業ツリー |
| `tests/unit/history.test.ts` 3 件 | 3 通過 | 2026-10-24 | 同上 |
| E2E `checking.spec.ts` 8 件（再認識失敗、パーサー外の読み、Back to ink、wrong の復帰、右辺補完 `1 + 1 =`、wrong 候補の非表示、unknown の二重確認、Esc で却下） | 8 通過 | 2026-10-24 | mock、ローカル、`0548c91` |
| E2E `demo.spec.ts` 2 件（Schrödinger 台本の通し：誤ったステップの却下と訂正、unverified 採用、Undo/Redo） | 2 通過 | 2026-10-24 | mock、ローカル、`0548c91` |
| E2E 合計（`npx playwright test tests/e2e/demo.spec.ts tests/e2e/checking.spec.ts`） | **10 通過／0 失敗**（2.5 分） | 2026-10-24 | mock、ローカル、`0548c91` |

R6b（重複判定と `content_hash`）の変更後も、台本の通し（`demo.spec.ts`）と候補まわりの E2E は崩れていない。実行のために PC へ導入したもの：Playwright の Chromium、`pnpm@10.20.0`（`corepack enable` は `C:\Program Files
odejs` への書き込み権限で EPERM になったため `npm i -g` を使用）。

### `server-only` の回避

`npx tsx --test --conditions=react-server <ファイル>` で通る。条件なしだと `candidate.ts`・`direct/index.ts` を import するテストは読み込み時に例外で失敗する（`server-only` が投げる）。`@/…` の別名は tsx が `tsconfig.json` の `paths` で解決するので追加設定は不要。`package.json` の `test` script は変更していない（`history.test.ts` 固定のまま）。グロブ指定への変更は管理者の許可待ち。**`--conditions=react-server` を付けないと失敗する** 点を、script を変えるときに必ず反映すること。

### E2E への影響の確認

静的に確認した結果（実機の実行結果は下の「試験結果」）：
- `tests/e2e/helpers.ts` の `mockSuggestions` は `/api/v1/suggest` を丸ごと差し替え、`content_hash` も自前で作る。`finalizeCandidate` を通らないので影響なし。
- `tests/e2e/api.spec.ts` は mock プロバイダー経路（`MOCK_PROVIDER`）で、`finalizeCandidate` を呼ばない。影響なし。
- `tests/e2e/demo.spec.ts` だけが台本経路（`scriptedSuggestion` → `finalizeCandidate`）を通る。代わりに単体テストで台本を最後まで再現した（`service.test.ts` の「scripted demo」）：学生の 2 行を文脈に置き、AI の各ステップを採用していき、誤ったステップ（`rejected`）はハッシュを `rejected_hashes` に返す。結果は「全 AI ステップが 1 回ずつ、台本の順に出る。誤ったステップが先に出て、却下後に訂正版が出る」。`demo.ts` 自体の重複判定（`lineHashes`）は文章込みの別実装で、今回は変更していない。
- `demo.spec.ts` は後から実際に流して通過を確認した（下の「試験結果」）。

### 今回見つかったこと（コードは直していない）

- **R6a は確認済み**：IR 上限は提案にも効く（17 項の和、16×16 項で 256 ノード超のどちらも `NONE/IR_INVALID`）。
- **R10 の限界**：`hasUnresolvedWrong` は、修正行が単独で unknown なだけでは検出しない。`recoveries` の `UNRESOLVED` に依存する（`model.test.ts` C2 に明記）。
- **R3 の固定**：`DOMAIN_CHANGED` が継続可になっている現状をテストで固定した（`model.test.ts` C1）。CAS 担当の回答が出たら、変更と同時にテストも直す。
- テストが **`model.ts`（他担当）の現状を固定** している箇所は C1・C2 の 2 テストのみ。

### 次にやること（すべて許可待ち）

1. Canvas・履歴担当の許可 → `engine.ts`／`notebook-store.ts` の小さな PR（abort、HELD、空 hash）。その後、`suggestBlockerOf` 等を engine から呼ぶ PR。skip の D3・G3〜G6・G9・F3 を実テストにする（engine への fake CAS／api の注入が前提）。
2. UI 担当 → R12（未検証祖先の表示）、R27（HELD 中の案内）、R30（mock 表示）。I2 を有効化。
3. AI・API 接続担当 → `client.ts` で `Job.meta` を返す（R16）、BRIDGE の 403 化（R28）、AI-S の token／timeout の根拠（R29）。
4. 管理者 → `package.json` の `test` script をグロブ指定に（`--conditions=react-server` 付き）。

## 依頼事項（他担当へ・現在有効）

- [ ] Canvas・履歴担当：`engine.ts`／`notebook-store.ts` の変更範囲（R13・R14・R16・R17・R22・R27・R30、`getCas()`／`api` の注入、`suggestBlocker` 等の純関数化）の可否と進め方。小さく分けて PR を出す形で合意したい。「筆記が止まった」の定義（R14）。
- [ ] UI 担当：`ghost-line.tsx` に「局所変形は整合（未検証：行N）」と mock 表示（R12・R30）、HELD 中の案内文（R27）、`i18n` のキー追加。
- [ ] AI・API 接続担当：`client.ts` で `Job.meta` を呼び出し側に返す（R16）、BRIDGE の 403 化（R28）、AI-S の token／timeout（8192／40s）の根拠（R29）。
- [ ] CAS 担当：`CONTINUABLE_UNKNOWN` の `DOMAIN_CHANGED`（R3）。`Proof.mock` の意味（R30）。
- [ ] QA 担当：MT-10／GT-7 の「ok のみ」を ADR 0003 に合わせた読み替え（第1節）の承認。
- [ ] リポジトリ管理者：`frontend/package.json` の `test` script をグロブ指定に変更、`server-only` のテスト時の扱い。
- [x] `demo.spec.ts`・`checking.spec.ts` の実行（この PC で実施済み。結果は「試験結果」）。

## 参照：部品の対応表（現行リポジトリの事実）

指示書（v1.9 前提）の部品名との対応。現行リポジトリの事実として有効。


| 本書の名前 | リポジトリの実体 | 状態（既存 / fake / 未作成） |
| --- | --- | --- |
| CAS `verify_target(owner, context, target, parent_line_id)` | 無し（サーバー側）。ブラウザ側は `frontend/src/core/cas/controller.ts` の `CasController.verify(payload)` → `frontend/public/cas/worker.js` → `packages/cas-core/cas_core/api.py` の `verify(payload: dict)`。`owner` なし | **未作成（サーバー側）**／ブラウザ側は既存だが形が違う |
| `get_cached_verification(owner, verification_id, input_hash)` | 無し。`verification_id` はブラウザが `uuid()` で採番するだけ（`engine.ts` の `verified: { verification_id: uuid(), ... }`）。`CasController`/engine にメモリ上の `cache: Map<string, Proof>` があるのみ（owner 別・永続の cache ではない） | **未作成** |
| `llm_complete_json(task, system_prompt, user_payload, output_schema, ...)` | Python：`backend/app/llm/__init__.py` の `LlmProvider.generate_json(task, model, system, parts, schema, timeout_s)`（Protocol のみ、実装なし）。TS：`frontend/src/server/ai/direct/providers/{gemini,mock,types}.ts` の `generateJson` が実体 | Python は **未作成**／TS は **既存** |
| `register_job_kind` / `JobHandler` / `JobContext(owner, is_cancelled, set_phase)` | 無し。`backend/app/jobs/store.py` は `JobStore` の SQLite スキーマと再起動時 `WORKER_RESTARTED` 処理のみ。dispatcher・handler 登録なし | **未作成**（スキーマのみ既存） |
| `POST /api/v1/suggest`（ルート） | gateway：`frontend/src/server/gateway/index.ts` の `suggest` エントリ（`SuggestInputSchema`、`getAiService().suggest`、direct では終端済みの 202 job を返す）。FastAPI：`backend/app/api/v1.py` の `suggest` は 501 | gateway は **既存**／FastAPI は **未作成** |
| `GET/DELETE /jobs/{id}` | FastAPI は 404 固定のスタブ。フロントの `frontend/src/core/api/client.ts` `runJob` が `GET jobs/{id}` をポーリング（1s/2s/5s は実装済み）。cancel 呼び出しは無し | スタブ／ポーリングは **既存** |
| 冪等性キー | `frontend/src/server/gateway/idempotency.ts`（direct 用、インメモリ LRU） | 既存（TS のみ） |
| IR validator | TS：`packages/contracts/src/ir/validate.ts` `validateExpr`、`IR_LIMITS`。Python：無し（`cas_core/ir.py` は SymPy 変換で validator ではない） | TS **既存**／Python **未作成**（`validate_input_segments` 相当なし） |
| `to_latex(expr, notation)` | TS：`packages/contracts/src/ir/print.ts` `printSegmentLatex` / `printLatex`。Python：無し | TS **既存**／Python **未作成** |
| `canonical_json` | TS：`packages/contracts/src/hash.ts` `canonicalJson`、`hashOf`（`sha256:` 付き）。Python：無し | TS **既存**／Python **未作成** |
| フロント job クライアント `postJob/getJob/cancelJob` | `frontend/src/core/api/client.ts` の `api.suggest(meta, input, signal)`（`runJob` 内でキー採番・1回再送・ポーリング）。`postJob`/`getJob`/`cancelJob` という個別関数は無く、cancel（`DELETE /jobs/{id}`）も呼んでいない。`AbortSignal` で中断はできる | 一部 **既存**（形が違う、cancel なし） |
| `buildContext(notebook)` | 無し。`engine.requestSuggestion` が `SuggestInput.context` をその場で組み立てる。CAS 用は `frontend/src/core/cas/payload.ts` の `payloadForLine` / `payloadForCandidate`。`context.lines` は `{id, role, source, status, segments}` で、指示書/v1.9 の `verification_id`・`input_hash` を持たない | **未作成**（形が違う） |
| `computeContextFingerprint(notebook, lineId)` | `payload.ts` の `contextFingerprint(nb, sessionId, epoch)`（`lineId` 引数なし。ノート全体の `[id, version]` を使う） | **既存**（シグネチャ違い） |
| `getSemanticHash(notebook)` | `payload.ts` の `semanticHash(nb, payload)`（`payload` を取る。ノート単体からは呼べない） | **既存**（シグネチャ違い） |
| `getClientEpoch()` / `getClientSessionId()` | `useNotebook` ストアの `epoch`（`bumpEpoch()`）、`NotebookEngine.sessionId`（インスタンス `readonly`） | **既存**（関数ではなくストア値） |
| `reserveLineId()` | `frontend/src/core/ids.ts` の `shortId('L')`。`requestSuggestion` が NEXT_STEP の target を `draftAfter?.id ?? shortId('L')` で決める（空の下書き行があればそれを再利用） | **既存**（予約関数ではない。下書き行 ID の再利用が指示書と違う） |
| `useIsInking()` | 無し。engine が `addStroke` で候補を HELD にし、`maybeReleaseHeld`（`eraseStrokes`/`clearDraft` 後）で READY に戻す。「ペンが下りている間」ではなく「下書き行に筆跡がある間」 | **未作成**（別の仕組みで代替） |
| `pushCommand(cmd)` | `useNotebook.commit(type, mutate, lineId)`（`past`/`future` に `Command{type, lineId, before, after}` を積む）。`CommandType` に `ADOPT_CANDIDATE` / `REJECT_CANDIDATE` は定義済み。`REJECT_CANDIDATE` は未使用 | **既存**（名前・形が違う） |
| `hasUnresolvedRecovery(notebook)` | `frontend/src/core/notebook/model.ts` の `hasUnresolvedWrong(nb)`（有効行の wrong、または `recoveries` の `UNRESOLVED`）。指示書の「`revision_of` 付き unknown」の判定は含まない | **既存**（定義が一部違う） |
| 候補の状態機械 | `notebook-store.ts` の `CandidateState`（GENERATING / **VERIFYING** / READY / HELD / NONE / ADOPTED / REJECTED / STALE）。`Candidate.policy`（verified / assumption / unverified）。STALE は状態にせず `set('candidate', null)` で消す | **既存**（`VERIFYING` と `policy` が指示書に無い） |
| 候補表示 | `frontend/src/components/notebook/ghost-line.tsx` の `GhostLine` / `RejectionChip`、`line-row.tsx`、`workspace.tsx`（Tab 採用・Esc 却下） | **既存** |
| 補完ボタン | `frontend/src/components/notebook/toolbar.tsx`（`engine.requestSuggestion(true)`、`tool.suggest`）。モード別のラベル分けは無い | **既存**（1ボタン、モード自動選択はロジック側） |
| 出力検査・重複・content_hash | `frontend/src/server/ai/direct/candidate.ts` `finalizeCandidate`（LHS 一致、重複＝行ハッシュ一致、`rejected_hashes`）。`content_hash = hashOf({mode, lines:[inputSegs]})` で、**文章セグメントも含む**（指示書 5.3 は含めない） | **既存**（定義が違う） |
| 契約型 | `packages/contracts/src/api.ts`：`SuggestInputSchema`、`CandidateDraftResultSchema`。`schemas.ts`：`MetaSchema`、`TargetSchema`、`VerifiedSchema`、`ProofSchema`。`SCHEMA_VERSION='2.0.0'` | **既存**（`CandidateResult` ではなく `CandidateDraftResult`、下記食い違い参照） |
| AI-S プロンプト／出力 schema | `frontend/src/server/ai/direct/prompts.ts` の `SUGGEST_SYSTEM` / `suggestParts`、`packages/contracts/src/llm.ts` の `SUGGEST_JSON_SCHEMA`（`{has_candidate, role, segments:[{type,content}]}`、**LaTeX 文字列**で返す） | **既存**（指示書の MathJSON 配列形式と別物） |
| mock 応答 | `frontend/src/server/ai/direct/demo.ts` `scriptedSuggestion`（Schrödinger デモの台本）。`MockProvider` は `MOCK_PROVIDER` の NONE を返す | **既存**（別のデモ題材） |
| テスト基盤 | TS：Node test runner（`tsx --test`、現状 `tests/unit/history.test.ts` のみ、`pnpm --filter frontend test`）＋ Playwright（`tests/e2e/`）。Python：`backend/tests/test_health.py`、`packages/cas-core/tests/test_fixtures.py`。**Vitest は無い**（ADR: Vite を使わない）。`tests/unit/suggest/` ディレクトリも無い | 指示書の Vitest／配置とは別 |


## 参照：優先順位が衝突する箇所（v2.1 / ADR を採用）


| 項目 | v2.0 | v2.1 / ADR（採用） |
| --- | --- | --- |
| 候補の表示条件 | ok のみ READY、unknown/wrong は表示・採用不可（§11） | ok／none は 1 タップ採用、unknown は amber＋二重確認、wrong は非表示でチップ（ADR 0003） |
| 自動提案 | 作らない（§14.2） | 行が確定し筆記が止まったら要求。採用は明示（v2.1-deltas） |
| 却下の履歴 | `REJECT_CANDIDATE` を積む（§12.2） | 積まない（v2.1-deltas 最終行） |
| 出力形式／LLM 設定 | `InputSegment[][]`、temperature 0.2 | LaTeX フラットなワイヤ形式、`thinking_level`（ADR 0002） |
| 実行場所 | Azure ジョブ | `AI_EXECUTION=direct`（ADR 0004）。ジョブは終端状態で返る |
| `SuggestInput` | `rejected_hashes` | `rejected_latex`、`demo` を追加 |

**MT-10／GT-7 の読み替え（QA 担当の承認が必要）**：「ok のみ採用」は ADR 0003 に従い「wrong は採用不可・非表示、unknown は二重確認でのみ採用、ok／none は 1 タップ」と読む。

## M-06 の要求と現行コードの対応


| # | 要求（出典） | 判定 | 根拠（ファイル：関数） | 既存テスト |
| --- | --- | --- | --- | --- |
| R1 | COMPLETE_RHS は左辺を構造一致で固定する（v2.0 §11） | 満たす／テストなし | `server/ai/direct/candidate.ts`：`finalizeCandidate`（`sameIr(m.expr[1], lhs_expr)`、不一致→`LHS_CHANGED`。`continuation` 形式は左辺を付け直して `plain` に正規化） | なし |
| R2 | 完成式を「直前の有効行＋問題文脈」で検証する（§11） | 満たす／テストなし | `core/engine.ts`：`verifyCandidate`（COMPLETE_RHS は `contextLinesFor(nb, basedOn.id)`、NEXT_STEP は文脈＋基準行の `chain`）、`core/cas/payload.ts`：`payloadForCandidate` | E2E（demo.spec） |
| R3 | NEXT_STEP は最後の ok/none、または unknown＋TIMEOUT/NO_EVIDENCE/NUM_ONLY/UNSUPPORTED から（§11）。v2.1 は reason `SUBSET_OF_SOLUTIONS` を追加 | 一部 | `core/notebook/model.ts`：`CONTINUABLE_UNKNOWN` に **`DOMAIN_CHANGED` が余分**（どの仕様にも無い）。`SUBSET_OF_SOLUTIONS` は v2.1 で妥当 | なし |
| R4 | 未読・未完成・再検証待ち・未解決の修正からは起動しない（§11） | 満たす／テストなし | `engine.ts`：`suggestBlocker`（`cas`／`pending`＝`anyPending`／`wrong`／`empty`／`cannot-continue`／`busy`／`writing`）、`model.ts`：`canContinueFrom`。INCOMPLETE は COMPLETE_RHS 側のみ | なし |
| R5 | LLM へ問題カード・直近 8 有効行・モード・左辺・却下 hash を渡す（§11。v2.1 で `rejected_latex`、参考本文 ≤9000 字） | 満たす／テストなし | `engine.ts`：`requestSuggestion`（`slice(-64)`、`rejected_hashes.slice(-64)`、`rejected_latex.slice(-16)`、`buildReferences`）、`server/ai/direct/prompts.ts`：`suggestParts`（`slice(-8)`、`← current line`） | api.spec（入力検査のみ） |
| R6a | 文章だけの出力・不正 IR を捨てる（§11） | 満たす／テストなし | `finalizeCandidate`（`PROSE_ONLY`）、`direct/index.ts`：`suggest`（`wireToSegments` 失敗→`IR_INVALID`。`allowUnparsed` を渡さないので Unparsed は通らない）。IR 上限（16 項／256 ノード）は提案にも効く（段階1の B3 で確認済み） | `service.test.ts` B3 |
| R6b | 既存行・却下候補と **IR／notation が完全一致** する候補を捨てる（§11） | **修正済み（段階1）** | 旧：`hashOf(toInputSegments(...))` が文章セグメントを含み、導入文だけ違う同じ式が重複・却下を逃れた。新：`core/candidates/hash.ts` の `lineHash`／`candidateHash`（数式の `expr`＋`notation` のみ）を `finalizeCandidate` が使う | `candidate.test.ts` A6・A7b・A8（修正前コードで失敗することを確認） |
| R7 | CAS で同値というだけで重複扱いしない（§11） | 満たす／テストなし | `finalizeCandidate`（IR 完全一致のみ） | なし |
| R8 | サーバーは未検証の `CandidateDraftResult` を返し、ブラウザの CAS が検証する（§11、§7.1） | 満たす | `direct/index.ts`：`suggest`→`GENERATED`（`verified` なし）、`engine.verifyCandidate` が `cas.verify` | E2E |
| R9 | 現在の文脈で再確認してから表示する（§11） | 満たす／テストなし | `verifyCandidate`（`this.nb` と `isStale` を毎回確認） | なし |
| R10 | 未解決 wrong／未解決の修正があれば LLM を呼ばずにローカルでブロック（§11） | 一部 | `suggestBlocker`＋`model.ts`：`hasUnresolvedWrong`（有効行の wrong、`recoveries` の `UNRESOLVED`）。「修正関係を持つ unknown」は `markRecovery` が `UNRESOLVED` にすることに依存（直接判定ではない）。手動時のみ toast。`UNRESOLVED_WRONG` という名前のコードは無い（動作は等価） | なし |
| R11 | 採用時にガードと input_hash を再確認（§11） | 満たす／テストなし | `engine.ts`：`adopt`（`c.epoch !== s.epoch`、`hasUnresolvedWrong`、`inputHash` 再計算→不一致は `stale`） | なし |
| R12 | 破線表示＋AI 由来・未採用・検証状態。ok で祖先ありは「局所変形は整合（未検証：行N）」（§11、§10 の表示規則） | 一部 | `components/notebook/ghost-line.tsx`：`GhostLine`（破線、ラベル：検証済み／仮定の提案／未検証・理由）。**候補の `depends_on_unverified`／`unverified_ancestors` を表示しない**（行側は `status.local` を使うが候補側は未使用）。「未採用」の明示文言も無い | E2E（文言のみ） |
| R13 | 筆記中に届いた結果は HELD（表示を出さない）（§11） | 一部 | `verifyCandidate` 末尾：到着時にアクティブな下書きに筆跡があれば `HELD`。一方 `addStroke` は **候補の対象行に書いたときだけ** READY→HELD（別の下書き行に書くと READY の ghost が出たまま） | なし |
| R14 | 筆記が止まり文脈が同じときだけ READY に戻す（§11） | 一部 | `maybeReleaseHeld`：消しゴム／行クリアで下書きが空になったときだけ READY へ。ペンが止まっただけでは戻らない（筆跡が残る限り HELD のまま、確定すれば STALE）。文脈同一の確認は epoch 変化で候補が消えることに依存 | なし |
| R15 | 確定・Undo・文脈変更で STALE（§11、§12.1） | 満たす／テストなし | `confirmLine`（`candidate=null`＋`bumpEpoch`）、`store.undo/redo`、`startRevision`、`editProblem`、`load/unload`。STALE という状態値は使わず候補を消す方式（`CandidateState` の `NONE/ADOPTED/REJECTED/STALE` は未使用） | E2E（部分） |
| R16 | 結果は request_id／notebook_id／client_session_id／client_epoch／line_id／line_version／context_fingerprint が active slot と一致したときだけ反映（§7.3） | 一部 | `engine.isStale` は **epoch と基準行の version の 2 項目だけ**。`request_id`・`context_fingerprint` は比較しない（`runJob` が `result` だけ返すので `Job.meta` も読めない）。エンジンは notebook ごとに 1 つなので notebook／session は実質等価 | なし |
| R17 | epoch 増加で関連要求を abort、既知ジョブを cancel（§7.3） | 一部 | `undo/redo` は `abortAll()` で abort。**`confirmLine`／`startRevision`／`editProblem`／`load` は suggest の AbortController を中断しない**（結果は捨てるが LLM 呼び出しは継続し、`suggesting` が立ったまま）。direct ではジョブは終端済みで cancel API 不要、クライアント中断はゲートウェイの `request.signal` で伝わる | なし |
| R18 | 採用は 1 回限り（§11） | 満たす／テストなし | `adopt`：同期的に `candidate=null`。2 回目は `'none'` | なし |
| R19 | NEXT_STEP は新規行、COMPLETE_RHS は対象の右辺を埋め、AI 由来と元の筆跡を保持（§11） | 満たす／テストなし | `adopt`：`ai_origin`（`unverified_adoption` 付き）、COMPLETE_RHS は `...l`（ink 保持）＋version+1、NEXT_STEP は予約 ID／既存の空下書きを置換 | E2E |
| R20 | 採用は多段 Undo/Redo の 1 command。before/after に完了済み `segments`・`Verified` を持ち、Redo は再送 0（§12.2） | 満たす／テストなし | `store.commit('ADOPT_CANDIDATE', ...)`（`Snapshot` は `lines` 全体）、`store.undo/redo` | なし |
| R21 | 却下は確定行を変えない。v2.1：undo 可能な command にしない | 満たす／テストなし | `engine.reject`（`REJECT_CANDIDATE` は `CommandType` に残るが未使用） | E2E（Escape） |
| R22 | 却下した同一候補は、同じ文脈で再表示しない。履歴は文脈ごと（§11、§7.3） | 一部 | `reject` が `rejectedHashes`／`rejectedLatex` に積み、`requestSuggestion` が送り、`finalizeCandidate` が `REJECTED_BEFORE`。ただし (a) 履歴は **文脈単位ではなく** adopt／undo／load でのみクリア（redo と confirm ではクリアされない）、(b) hash が文章込み（R6b）、(c) **GENERATING／VERIFYING 中の Esc で空文字 `''` の hash を積む**（`reject` が `c.contentHash` を無条件に積む） | なし |
| R23 | unknown の候補は amber＋二重確認、`unverified_adoption` を記録（ADR 0003） | 満たす／テストなし | `verifyCandidate`（`policy='unverified'`）、`adopt(confirmUnverified)`、`GhostLine`（`ghostConfirm`） | E2E（checking.spec） |
| R24 | wrong の候補は表示せず「チェッカーが却下」チップ、その hash を除外して 1 回だけ再生成（ADR 0003） | 満たす／テストなし | `verifyCandidate`（`recordCheckerRejection`、`retried`）、`RejectionChip` | E2E（checking.spec、demo.spec） |
| R25 | none（定義・仮定）は「仮定の提案」で 1 タップ採用（ADR 0003） | 満たす／テストなし | `verifyCandidate`（`policy='assumption'`） | E2E（部分） |
| R26 | 自動提案は「行が settle し筆記が止まったら」。採用は明示（v2.1） | 満たす／テストなし | `scheduleSuggestion`（1200ms）、`addStroke` で `cancelSuggestion`、`suggestBlocker` の `writing` | E2E（部分） |
| R27 | 手動ボタンの無反応を作らない（§12.1「すべての処理は着地する」の趣旨） | 一部 | `requestSuggestion`：toast は wrong／cas／empty／writing のみ。`pending`／`cannot-continue`／`busy`（HELD 中含む）は **何も言わず戻る**。`canSuggest` は HELD 中の手動押下を許すが、`requestSuggestion` が `busy` で戻るため効かない（食い違い） | なし |
| R28 | mode=BRIDGE は FEATURE_DISABLED（§14.2、エラー表は 403） | 一部 | `direct/index.ts`：`suggest` が `AiError('FEATURE_DISABLED')`→ゲートウェイは **202 の failed ジョブ**（HTTP 403 ではない）。Must では UI から BRIDGE は送られない | なし |
| R29 | AI-S の契約：1 行、429/5xx/タイムアウトは 1 回だけ再試行、スキーマ違反は再試行しない、打切り・空応答は成功にしない（§13） | 一部 | `providers/gemini.ts`（1 回再試行、空応答→`UPSTREAM_INVALID`）、`direct/index.ts`（`SuggestWireSchema` 違反→`SCHEMA_INVALID`）。数値は v2.0 の 600 tokens／20s に対し **8192 tokens／40s**（v2.1 に記載なし。根拠は要確認で、仮決めしない） | なし |
| R30 | mock を UI／保存／ログで明示し、live の検証文脈に混ぜない（§13） | 一部 | `top-bar.tsx`：`top.mock`（capabilities の `llm.mock`）。`Candidate.mock` は保持するが表示しない。`verifyCandidate` の `mock: draft.lines.length > 0 && false` は **常に false**（意図不明の式） | なし |
| R31 | すべての要求は成功・失敗・タイムアウト・取消のいずれかに着地（§12.1） | 満たす／テストなし | `requestSuggestion`（`catch`／`finally` で `suggesting=false`、失敗時 candidate を消す）。CAS が途中で `unavailable` になったときは **通知なしで消える** | なし |
| R32 | 受付後の通信断は同じキーで再送（§7.2、MT-12） | 満たす／テストなし | `core/api/client.ts`：`runJob`（`NETWORK` のみ 1 回再送）、`gateway/idempotency.ts` | api.spec（冪等性） |
| R33 | サーバー入力検証（§7.1） | 満たす | `packages/contracts/src/api.ts`：`SuggestInputSchema`、`gateway/index.ts`：`runJob` | api.spec |
| R34 | ポーリング間隔 1s／2s／5s（§7.2） | 満たす／テストなし | `client.ts`：`runJob`（direct では実際には回らない） | なし |
| R35 | 操作対象 44px 以上、色だけに頼らない（§8.1） | 満たす | `ghost-line.tsx`（`min-h-11`、アイコン＋文言） | なし（目視） |
| R36 | 失敗しても行・筆跡・判定を変えない（§16.6、GT-7/8） | 満たす／テストなし | 候補はストアの `candidate` にのみ保持され、`adopt` 以外で `notebook` を変更しない | なし |
| R37 | GT-7 の注入：保留中のチェック、左辺変更、wrong／unknown、筆記中の到着、文脈変更 | テストなし | 上記を単体で再現するテストが無い | E2E は一部のみ |

**集計**（R1〜R37）：一部 13（R3, R6b, R10, R12, R13, R14, R16, R17, R22, R27, R28, R29, R30）／テストなし 1（R37）／満たす 23（うち単体テストがあるものは 0。E2E で一部カバー）／満たさない 0。実質的な欠陥は R6b・R12・R13・R14・R16・R17・R22・R27・R30 に集中する。要件を全く満たさない項目は無い。

## 直す項目と変更が必要なファイル（担当区分）


担当の仮定：`frontend/src/server/ai/direct/{candidate,prompts}.ts`、新設ファイル、テストは **私（AI数式補完）**。指示のとおり `engine.ts`／`notebook-store.ts`＝Canvas・履歴担当と共有、`toolbar.tsx`／`ghost-line.tsx`＝UI 担当、`packages/contracts`／`gateway`＝AI・API 接続担当。`model.ts`、`i18n/*`、`core/cas/payload.ts`、`providers/gemini.ts`、`package.json` は指示に明記が無いので **要確認**。

| 項目 | 変更ファイル | 担当 | 備考 |
| --- | --- | --- | --- |
| R6b 重複判定・`content_hash` を IR／notation のみにする（**済**） | `server/ai/direct/candidate.ts`（`finalizeCandidate`）、新規 `core/candidates/hash.ts` | **私** | `demo.ts` の台本も同じ関数を通るので E2E で影響確認。`contracts` の `hashOf` は変更しない |
| R12 候補に「局所変形は整合（未検証：行N）」を出す | `components/notebook/ghost-line.tsx`、`i18n/en.ts`・`ja.ts`（既存 `status.local` を流用できるか確認） | **UI 担当**（i18n は要確認） | 行番号は `model.ts` の `lineNumber` で足りる。依頼する |
| R13 別行に書いたときも READY→HELD | `engine.ts`：`addStroke` の条件（`targetLineId === lineId` を外す） | **共有（Canvas・履歴）** | 小さな変更。合意が要る |
| R14 筆記が止まったら（文脈同一なら）READY に戻す | `engine.ts`：`maybeReleaseHeld` または新規のアイドル検知 | **共有（Canvas・履歴）** | 「止まった」の定義は Canvas 側（`useIsInking` 相当が無い）。**仮決めしない**：定義の合意が先 |
| R16 応答照合を 7 項目にする | `engine.ts`：`isStale` を `matchesSlot(slot, res)` に置換、スロットに `request_id`／`context_fingerprint` を保持 | **共有（Canvas・履歴）**（純関数は私の新規ファイルに置ける） | `Job.meta` の照合には `client.ts`（AI・API 担当）の変更が必要→依頼。当面は送信時のスロットとの比較で足りる |
| R17 confirm／revision／problem 編集／load で suggest を中断 | `engine.ts`（`confirmLine`、`startRevision`、`editProblem` に `abortSlot('suggest')`） | **共有（Canvas・履歴）** | 各 1 行。`suggesting` の取り残しも直る |
| R22 却下履歴を文脈単位にする、Esc の空 hash を除く | `engine.ts`：`reject`、`rejectedHashes` のキー化。`notebook-store.ts`：型・初期値・`undo/redo` のクリア範囲 | **共有（Canvas・履歴）** | キー＝`semanticHash`（要確認）＋モード＋対象種別。メモリのみ（保存しない） |
| R27 手動ボタンの無反応を無くす | `engine.ts`：`requestSuggestion` の toast 分岐、`canSuggest`／HELD 中の扱い。文言は `i18n/*` | **共有（Canvas・履歴）**＋UI 担当 | 案内文（例：HELD 中は「書き終えると表示されます」）の決定が必要 |
| R28 BRIDGE を 403 `FEATURE_DISABLED` にする | `server/gateway/index.ts`（`AiError` の HTTP 写像） | **AI・API 接続担当** | Must では UI から送られない。優先度は低い |
| R30 `mock` の式、候補の mock 表示 | `engine.ts`：`verifyCandidate`、`ghost-line.tsx` | **共有（Canvas・履歴）／UI 担当** | `Proof.mock` の意味（LLM が mock か、ノートが mock か）の確認が先。仮決めしない |
| R3 `DOMAIN_CHANGED` の根拠確認 | `core/notebook/model.ts`：`CONTINUABLE_UNKNOWN` | **要確認（CAS 担当／Canvas・履歴）** | 意図的ならコメントに根拠を残す。変更するかは人間判断 |
| R10 修正関係を持つ unknown の直接判定 | `model.ts`：`hasUnresolvedWrong` | **要確認** | C2 で確認：`recoveries` が UNRESOLVED のときだけ検出し、修正行が単独で unknown なだけでは検出しない。`markRecovery` が確実に UNRESOLVED にする限り足りるが、その保証は engine 側（Canvas・履歴）のテストが必要 |
| R29 AI-S の token／timeout の根拠 | `direct/index.ts` | **私**（コメントのみ）／変更は要確認 | 変更せず、AI・API 担当に根拠を確認 |
| テスト実行基盤 | `frontend/package.json` の `test` script（`tests/unit/history.test.ts` 固定）をグロブ指定に | **要確認（共有ファイル）** | `candidate.ts` などは `server-only` を import しており Node 直実行で例外になる。回避策（`--conditions=react-server`、または `server-only` のスタブ）を合意する |
| `engine.ts` を単体テスト可能にする | 現状 `private cas = getCas()`（Web Worker／Pyodide を起動）と `api` の直接 import。コンストラクタ注入が必要 | **共有（Canvas・履歴）** | 代替：判定ロジックを純関数（`suggestBlockerOf`、`matchesSlot`、`adoptSnapshot`、`rejectionKey`）として私の新規 `core/candidates/` に抽出し、engine はそれを呼ぶだけにする。engine への変更は呼び出しの差し替えのみ |

## 追加するテスト一覧（計画。実装状況は「現在の状態」を参照）

実装済み：A（`candidate.test.ts`）、B（`service.test.ts`）、C（`model.test.ts`）、H（`client.test.ts`）、純関数（`pure.test.ts`）。skip：D3・F3・G3・G4・G5・G6・G9・I2。未着手：E（採用）・F1/F2・G1/G2/G7/G8/G10（`engine.ts` への fake 注入が前提）。


配置は `frontend/tests/unit/suggest/`（私）。書き方は既存の `history.test.ts`（`describe`／`it`、相対 import）に合わせる。★＝現状の挙動が要件を満たさず、修正とセットで通すテスト（修正前は失敗する）。

**A. `candidate.test.ts`（`finalizeCandidate`。`server-only` 対策が前提）**
1. A1 COMPLETE_RHS：`Equal(lhs, rhs)` で左辺一致→`GENERATED`、`target.id=target_line_id`、数式 1 つの `plain`（R1）
2. A2 COMPLETE_RHS：`continuation` 形式の右辺→`Equal(lhs_expr, rhs)` に組み直される（R1）
3. A3 COMPLETE_RHS：左辺が 1 ノードでも違う→`LHS_CHANGED`、`lhs_expr` 無し→`LHS_CHANGED`、右辺 `null`→`INCOMPLETE`（R1）
4. A4 数式セグメント無し→`PROSE_ONLY`（R6a）
5. A5 既存行と同じ IR・notation→`DUPLICATE`／同値だが IR が違う（`x^2-5x+6` と `x^2+6-5x`）→`GENERATED`（R6b・R7）
6. A6 ★ 文章セグメントだけが違う同じ式→`DUPLICATE`（R6b）
7. A7 `rejected_hashes` に含まれる→`REJECTED_BEFORE`（R22）
8. A8 `content_hash`：同じ入力で同値、モードで変わる、★ 文章で変わらない（R6b）
9. A9 `mock` フラグが結果に伝わる（R30）

**B. `service.test.ts`（`DirectAiService.suggest`、fake の `LlmProvider`）**
1. B1 `mode=BRIDGE`→`FEATURE_DISABLED`、LLM 呼び出し 0（R28）
2. B2 `has_candidate=false`→`NONE/MODEL_DECLINED`
3. B3 パース不能な LaTeX→`NONE/IR_INVALID`（`Unparsed` を通さない）、IR 上限超（257 ノード等）→NONE（R6a の `validateExpr` 確認）
4. B4 ワイヤ形式違反→`SCHEMA_INVALID` を投げ、provider 呼び出しは 1 回のみ（R29）
5. B5 mock provider→`NONE/MOCK_PROVIDER`、デモ台本→`scriptedSuggestion` 経由（R30）
6. B6 `suggestParts`：直近 8 行まで、`based_on_line_id` の行に印、`rejected_latex` を含む、参考本文は「データ」として前置（R5）

**C. `model.test.ts`（`core/notebook/model.ts`）**
1. C1 `canContinueFrom`：ok／none→true、unknown＋TIMEOUT／NO_EVIDENCE／NUM_ONLY／UNSUPPORTED／SUBSET_OF_SOLUTIONS→true、UNREADABLE／INCOMPLETE／wrong→false、`DOMAIN_CHANGED` の現状を固定（R3）
2. C2 `hasUnresolvedWrong`：wrong／`UNRESOLVED` recovery→true、`SUPERSEDED` の wrong→false、`revision_of` 付き unknown が recovery 経由で true になる（R10）
3. C3 `lastSettledMath`／`contextLinesFor`（修正元を除外）／`anyPending`

**D. `blocker.test.ts`（`suggestBlocker` を純関数に抽出した後）**
1. D1 理由ごとの戻り値：`cas`／`pending`／`wrong`／`empty`／`cannot-continue`／`busy`／`writing`／null（R4）
2. D2 INCOMPLETE の最終行＋`Equal`→COMPLETE_RHS、ok の最終行→NEXT_STEP（モード選択、R5）
3. D3 ★ `canSuggest(manual)` と `requestSuggestion` が HELD 中に矛盾しない（R27）

**E. `adopt.test.ts`（`adopt` の判定とスナップショット生成。`adoptSnapshot` 抽出後、または engine に fake CAS を注入）**
1. E1 NEXT_STEP：新規行を基準行の直後に追加、`source:'ai'`、`parent`、`verified`、`ai_origin`、version=1（R19）
2. E2 NEXT_STEP：直後の空下書きを置換（ID 再利用）／下書きが無ければ末尾に新規下書きを追加（R19）
3. E3 COMPLETE_RHS：`segments` 置換、version+1、`ink` 保持、`ai_origin`（R19）
4. E4 二重採用：2 回目は `'none'`、`past` に積まれる command は 1 件（R18）
5. E5 `epoch` 不一致／`inputHash` 不一致／`hasUnresolvedWrong`→`'stale'` で候補を消し、ノート不変（R11）
6. E6 unknown：1 回目は `'confirm'`、2 回目で採用、`ai_origin.unverified_adoption=true`。ok／none は 1 回（R23・R25）
7. E7 HELD 状態では採用できない（`'none'`）（R13）

**F. `history-adopt.test.ts`（`useNotebook` ストア）**
1. F1 `ADOPT_CANDIDATE` → `undo` で採用前、`redo` で採用後に戻り、その間 `api.suggest` は 0 回（R20）
2. F2 `undo`／`redo` で `epoch` が単調増加、`candidate` が消える、新しい編集で `future` が空に（R15、MT-11）
3. F3 `undo` で `rejectedHashes` がクリアされる／★ `redo` と `confirm` の扱いを仕様化（R22）

**G. `flow.test.ts`（fake の CAS と `api.suggest` を注入した `requestSuggestion`。注入可能になった後）**
1. G1 ブロック条件では **`api.suggest` が 0 回**：wrong あり、CAS 未準備、pending、筆記中、`cannot-continue`（R4・R10）
2. G2 送信内容：`meta` の 7 項目、`mode` 自動選択、`target_line_id`、`lhs_expr` は COMPLETE_RHS のみ、`rejected_hashes`、`context.lines ≤ 64`（R5）
3. G3 筆記中に結果が届く→`HELD`／消しゴムで空になり→`READY`（R13・R14）
4. G4 ★ 別の下書き行へ書き始めた→`HELD`（R13）
5. G5 GENERATING 中に確定／Undo／revision 開始／問題編集→候補が出ず、★ suggest の `AbortSignal` が中断される（R15・R17）
6. G6 ★ 応答の `request_id`／`context_fingerprint` 不一致は捨てる（R16）
7. G7 wrong の候補：チップを設定し、除外 hash つきで **1 回だけ** 再送、2 回目も wrong なら再送しない（R24）
8. G8 NONE：手動のみ toast、自動では無言。失敗：手動のみエラー toast。どれもノート不変（R27・R31・R36）
9. G9 却下：確定行不変、hash が次の送信に載る、★ GENERATING 中の Esc で `''` を積まない、文脈が変われば履歴が効かない（R21・R22）
10. G10 自動提案：1200ms 後に 1 回だけ、筆記開始で取り消し、候補が出ている間は再送しない（fake timers）（R26）

**H. `client.test.ts`（`runJob`、`fetch` を差し替え）**
1. H1 `NETWORK` 失敗は **同じ Idempotency-Key** で 1 回だけ再送、2 回目も失敗なら例外（R32）
2. H2 `succeeded`／`failed`（retryable の伝播）／`cancelled` の写像（R31）
3. H3 ポーリング間隔 1s→2s→5s（fake timers、`queued` を返し続ける）（R34）

**I. E2E（既存 Playwright に追記。少数に絞る）**
1. I1 筆記中に届いた候補は表示されず、消しゴムで空にすると表示される（R13・R14）
2. I2 ok だが祖先が未検証の候補に「未検証：行N」が出る（R12、修正後）

---

# 履歴（失効した記述。参照用・編集しない）

以下は段階0（指示書 `AI_COMPLETION_TASK.md` ＝ v1.9 前提）と段階0' の途中までの記述。方針（案A・v2.x 基準）が決まったことで、**v1.9 前提の部分は失効** した。事実としての調査結果（部品の対応表など）は上の「参照」にも残してある。

## 段階0（原文）より

### 0. 最重要の発見（調査時点）


指示書は「`backend/app/suggest/` に Python の worker を作り、CAS・cache・ジョブ基盤・LLM アダプタは他担当が提供する」前提で書かれている。**リポジトリの実体はこの前提と大きく違う。**

1. **M-06 は Stage 1 で既に実装済み**（TypeScript、ブラウザ側）。`frontend/src/core/engine.ts` の `requestSuggestion` / `verifyCandidate` / `adopt` / `reject`、`frontend/src/server/ai/direct/candidate.ts` の `finalizeCandidate`、`frontend/src/components/notebook/ghost-line.tsx` など。
2. **CAS はブラウザ内（Pyodide + SymPy、Web Worker）で動く。** サーバー側に `verify_target` も verification cache も無い。候補の CAS 検証は `engine.verifyCandidate` が候補を受け取った後にブラウザで行う。指示書の核（サーバーが cache と照合 → LLM → サーバー CAS で ok のみ返す）は、現状の構成では成立しない。
3. **Python バックエンドは雛形のみ。** `/suggest` は 501、ジョブ基盤は SQLite スキーマだけ（dispatcher・`GET/DELETE /jobs` なし）、LLM アダプタは `Protocol` 1つだけ。`packages/cas-core`（Python）は SymPy の検証ロジックで、`verify(payload: dict)` は純関数。`owner` 引数も cache も無い。
4. **基準設計書が違う。** リポジトリが基準にしているのは `docs/design/v2.0-en.md` + `docs/design/v2.1-deltas.md`（`schema_version` は `2.0.0`、Next.js 16、`AI_EXECUTION=direct`）。`JPHACKS_Unified_Design_v1.9.md` は未追跡（`??`）でリポジトリに入っていない。指示書の「v1.9 優先」と、リポジトリの実コード・ADR が衝突する箇所が多い（第4節）。

→ このままでは指示書の段階1〜6は着手できない。**どの方針で進めるかを人間が決める必要がある**（第3節 Q1）。私は方針を仮決めしていない。


> 失効：2〜3 点目の「どの方針で進めるか」は案A で決着。4 点目は Q2 で決着（v2.0 + v2.1 + ADR）。

### 作る予定のファイル一覧（原案 A／B）


**確定できない。** Q1（方針）の回答で決まる。下は方針ごとの案で、どれも仮置き。

### 案A：現行アーキテクチャ（ブラウザ CAS + direct AI）に合わせて TS で仕上げる（私の推奨）

指示書第4章の読み替え。Python 側 `backend/app/suggest/` は作らない。

| 指示書第4章 | 読み替え先 | 区分 |
| --- | --- | --- |
| `backend/app/suggest/{guards,filters,prompt,worker,...}.py` | `frontend/src/server/ai/direct/candidate.ts`（既存を修正）、`prompts.ts`（既存）。ガードは `frontend/src/core/suggest/guards.ts`（新規・純関数）に切り出す案 | 修正＋新規 |
| `backend/app/api/suggest.py` | 作らない（gateway の既存 `suggest` エントリを使う）。入力検査の追加は `frontend/src/server/gateway/index.ts` ＝ **他担当領域の可能性**、依頼事項 | 修正（要依頼） |
| `src/core/candidates/{candidateStore,useSuggest,commands}.ts` | 現状は `engine.ts` と `notebook-store.ts` に埋め込み。`frontend/src/core/candidates/` に抽出して engine から呼ぶ案（Canvas・履歴担当と衝突しうる、要調整） | 新規＋engine 修正 |
| `CandidateRow.tsx` / `SuggestButton.tsx` | 既存 `ghost-line.tsx` / `toolbar.tsx` を修正（UI 担当と調整） | 修正 |
| `tests/unit/suggest/`、`src/core/candidates/__tests__/` | `frontend/tests/unit/suggest/*.test.ts`（`tsx --test`）。Vitest 前提のテスト ID（F1〜F12）は Node test runner で書き直し。B 系は TS の純関数テストに読み替え | 新規 |
| 型（`schemas.py`、`types.ts`） | `packages/contracts` に既存。**変更は contracts 担当への依頼** | 依頼 |

### 案B：指示書どおり Python backend に worker を作る

`backend/app/suggest/*`、`backend/app/api/suggest.py` を新規作成し、CAS・cache・ジョブ・LLM アダプタは `ports.py` + fake で代替（指示書 3.2）。ただし (1) サーバー側 CAS が存在しないので `verify_target` の本物は永久に fake のまま、(2) 本番の suggest は `AI_EXECUTION=direct` で TS が処理しており Python 経路は使われない。**デモに載らない作業になる懸念が大きい。**


> 失効：案B は採らない。案A の読み替え表は、最新の「直す項目と変更が必要なファイル」に置き換えた。

### 仮決め・要合意（Q1〜Q15）


指示書側の `TODO(要合意)` で、リポジトリを見て判断が必要になったもの。私は仮決めしていない（✗＝未決）。

- [ ] **Q1 実装方針（最優先）**：案A（TS で既存 M-06 を指示書の規則に合わせて仕上げる）／案B（Python backend 新規）／案C（A をやりつつ将来の relay 用に Python 側は ports のみ）。根拠：第0節。相談相手：AI・API 接続担当、CAS 担当、リーダー。
- [ ] **Q2 基準設計書**：リポジトリの基準は v2.0-en + v2.1-deltas。v1.9 を優先すると `schema_version`（`1.9.0` vs `2.0.0`）、候補ポリシー（ok のみ vs unverified も表示）、自動提案（無し vs 入力停止後に自動）等が既存コードと衝突する。v1.9 を `docs/design/` に入れる／基準を v2.1 にする、どちらか。相談相手：リーダー。
- [ ] **Q3 候補ポリシー**：指示書 規則2「CAS ok だけ READY」は ADR 0003（`show_unverified`：unknown は amber で二重確認採用、none は「仮定の提案」）と衝突。ADR 0003 は「厳格モードは engine の `policy` 計算を1行変えれば戻せる」と記載。どちらに従うか（MT-10「okのみ採用」の判定基準に直結）。相談相手：リーダー、UI 担当。
- [ ] **Q4 自動提案**：v2.1 は「行が確定し筆記が止まったら自動で提案」（`scheduleSuggestion`、1200ms）。v1.9／指示書は「補完ボタン押下で起動」（自動提案は作らない）。どちらか。相談相手：リーダー、UI 担当。
- [ ] **Q5 Reject を Command にするか**：指示書 7.8 は `REJECT_CANDIDATE` を履歴に積む。v2.1-deltas は「Stage 1 では却下は undo 可能な command にしない」。v1.9 12.2 は `REJECT_CANDIDATE` を列挙。相談相手：Canvas・履歴担当。
- [ ] **Q6 `verification_id` の信頼モデル**：サーバー cache が無いので指示書 規則6（クライアントの検証結果を信用しない）・`CONTEXT_REVERIFY_REQUIRED` は、ブラウザ CAS 構成では実装できない（サーバーは Proof を検証できない）。direct/Pyodide 構成での扱い（規則6を適用外にする／cas-core を Python サーバーに持つ）の決定。相談相手：CAS 担当、AI・API 接続担当。
- [ ] **Q7 `409 UNRESOLVED_WRONG` の置き場所**：現状 gateway にはガードが無く、フロント（`suggestBlocker`）だけが止めている（二重ガードになっていない）。サーバー側（gateway か FastAPI）に入れるか。`revision_of` 付き unknown を「未解決」に含めるか（現行 `hasUnresolvedWrong` は含まない）。相談相手：CAS 担当、AI・API 接続担当。
- [ ] **Q8 モードの自動選択と「空右辺」判定**：現行は `proofOf(last)?.reason === 'INCOMPLETE'` かつ最後の `Equal`。指示書 5.3/6.2 は「`["Equal", L, null]` かつ数式セグメントちょうど1つ」。現行の `canContinueFrom` は `SUBSET_OF_SOLUTIONS` と `DOMAIN_CHANGED` も許可（v1.9 は4種のみ）。どちらに合わせるか。相談相手：CAS 担当。
- [ ] **Q9 `NEXT_STEP` の `target_line_id`**：指示書は「新しい予約 ID」、現行は「直後の空下書き行があればその ID を再利用」。採用時は既存の下書き行を置換する実装。指示書 B18（既存行 ID と重複なら 400）と矛盾する。相談相手：Canvas・履歴担当。
- [ ] **Q10 `content_hash` の定義**：現行は文章セグメント込み（`hashOf({mode, lines:[inputSegs]})`）、指示書 5.3 は数式のみ。v1.9 の定義は「modeと候補IR・notation」。変更は却下履歴の互換に影響（メモリ内のみなので互換問題なし）。相談相手：AI・API 接続担当。
- [ ] **Q11 `useIsInking` の定義**：指示書は「ペンが下りている間／最後の筆跡から一定時間」を Canvas・履歴担当と合わせる、とする。現行は「下書き行に筆跡がある間」。相談相手：Canvas・履歴担当。
- [ ] **Q12 NONE の `reason`**：現行は `PROSE_ONLY` / `LHS_CHANGED` / `INCOMPLETE` / `DUPLICATE` / `REJECTED_BEFORE` / `MODEL_DECLINED` / `IR_INVALID` / `MOCK_PROVIDER`。指示書は `LLM_NO_CANDIDATE` / `OUTPUT_REJECTED` / `DUPLICATE` / `CAS_NOT_OK`。どちらに揃えるか。画面文言は現状 NONE 時にトースト（`toast.noSuggestion`）のみ。相談相手：UI 担当。
- [ ] **Q13 wrong 候補の扱い**：現行は wrong を自動で1回だけ再生成し、「チェッカーが却下した」チップを出す（説明シート）。指示書は wrong は `NONE`（`CAS_NOT_OK`）で黙って捨てる。相談相手：UI 担当、リーダー。
- [ ] **Q14 mock 応答の題材**：指示書は `A²L/2=1 → A=√(2/L)` と `(x-2)(x-3)` 展開。リポジトリのデモは Schrödinger 導出（`packages/contracts/fixtures/demo.ts`、`demo.ts` の台本）。固定データは QA 担当の領域か。相談相手：QA 担当。
- [ ] **Q15 テストの置き場所と ID**：Vitest が無く、`pnpm --filter frontend test` は `tests/unit/history.test.ts` 1ファイルを固定指定している（`package.json`）。新規テストを足すにはこの script の変更が必要（共有ファイル）。相談相手：リポジトリ管理者。


> 決着：Q1＝案A、Q2＝v2.0 + v2.1 + ADR、Q3〜Q14＝v2.x と ADR に従う（`TODO(要合意)` の運用は廃止）。Q15（テスト置き場）は「`tests/unit/suggest/`、`package.json` は変えずにコマンドで実行」に決着。Q6（`verification_id` の信頼モデル）・Q7（サーバー側の UNRESOLVED_WRONG）は v1.9 前提で、v2.x ではブラウザが検証とガードを担うため失効。

### 依頼事項（段階0 時点）


- [ ] リーダー／全員：Q1・Q2・Q3・Q4 の回答（段階1に進む前提）。
- [ ] リーダー：`docs/design/JPHACKS_Unified_Design_v1.9.md` を基準にするなら、リポジトリに追加（現在は未追跡）し、`v2.1-deltas.md` との優先関係を明記してほしい。
- [ ] CAS 担当：サーバー側検証・verification cache を作る予定があるか（無ければ Q6 は「適用外」として確定したい）。`cas_core.api.verify` の公開入力形（`payload` の dict）が `Context/Target` とどう対応するかの説明。
- [ ] AI・API 接続担当：Python 側ジョブ基盤・LLM アダプタ（relay 経路）の実装予定と時期。`SuggestInput` を変更する場合の窓口（`packages/contracts/src/api.ts`）。`gateway/index.ts` にガード（UNRESOLVED_WRONG 等）を足す許可。
- [ ] Canvas・履歴担当：`engine.ts`（`requestSuggestion`/`verifyCandidate`/`adopt`/`reject`）と `notebook-store.ts` は本機能と共有の場所。ここを修正してよいか、候補ロジックを `core/candidates/` へ抽出してよいか。`useIsInking` / `reserveLineId` の公開形。
- [ ] UI 担当：`toolbar.tsx`（ボタンのラベルをモード別にする、無効化理由のツールチップ）、`ghost-line.tsx`（「未検証：行N」表示、NONE 表示）の修正許可。i18n（`en.ts`/`ja.ts`）に文言キーを足す許可。
- [ ] QA 担当：mock／固定 fixture の題材（Q14）。`frontend/package.json` の `test` script の拡張（Q15）。


### v1.9 と本書の食い違い（D1〜D14）


「どちらに従ったか」は、段階0では実装していないので **未適用**。食い違いの事実だけ記録する。

| # | 内容 | 状態 |
| --- | --- | --- |
| D1 | v1.9：Vite SPA + `api/gateway.ts`、Azure 上の FastAPI がジョブ・CAS・LLM を担う。リポジトリ：Next.js 16 App Router、gateway は `app/api/v1/[...path]/route.ts`、`AI_EXECUTION=direct`（ADR 0001/0004） | 未決（Q1/Q2） |
| D2 | v1.9：CAS は SymPy 子プロセス（サーバー、5秒 kill、同時2本）。リポジトリ：Pyodide（ブラウザ Web Worker）。ADR 0004 にサーバー CAS の記載なし | 未決（Q1/Q6） |
| D3 | v1.9 第5章：`schema_version=1.9.0`、`Proof.cas.rules_version='1.9.0'`。リポジトリ：`SCHEMA_VERSION='2.0.0'`、`RULES_VERSION='2.0.0'` | 未決（Q2） |
| D4 | v1.9 第13章：AI-S は `{candidate: InputSegment[][] \| null}`（MathJSON）、temperature 0.2。リポジトリ：`{has_candidate, role, segments:[{type,content(LaTeX)}]}`、`thinking_level`（ADR 0002、v2.1 deltas） | 未決（Q1） |
| D5 | v1.9 第5章 `CandidateResult`（READY/NONE、`CandidateLine.verified` 必須）。リポジトリ：`CandidateDraftResult`（GENERATED/NONE、`mock` 付き、`verified` なし、行数 1〜3） | 未決（Q1/Q6） |
| D6 | v1.9 第11章：ok のみ READY。リポジトリ：ADR 0003（unknown は amber で表示・二重確認、none は仮定の提案、wrong は非表示チップ） | 未決（Q3） |
| D7 | v1.9：自動提案なし（第14.2節）。リポジトリ：自動提案あり（v2.1 deltas） | 未決（Q4） |
| D8 | v1.9 12.2：`REJECT_CANDIDATE` を履歴に積む。リポジトリ：積まない（v2.1 deltas） | 未決（Q5） |
| D9 | 指示書 3.1：`Context.lines` は `verification_id`/`input_hash` 付き。リポジトリ：`SuggestInput.context.lines` は `{id, role, source, status, segments}`（Proof の `status` だけ送る＝クライアント申告値） | 未決（Q6） |
| D10 | v1.9 第7章：ジョブ（202 → ポーリング）、`DELETE /jobs/{id}`。リポジトリ：direct では終端済みジョブ（ポーリングは relay 用に実装済み）、cancel 未実装 | 未決（Q1） |
| D11 | 指示書 5.2 `SuggestInput`：`rejected_hashes`、`reference?: {page, text}[]`。リポジトリ：`rejected_latex`、`ui_lang`、`demo` を追加、`reference` は `{name, page, text}`（v2.1 deltas に記載） | 事実のみ |
| D12 | 指示書 4 節：`reference` は Must では送らない。リポジトリ：Resources タブはコア機能で、`buildReferences` が常に参考本文を付ける（v2.1 deltas） | 未決（Q1） |
| D13 | 指示書 2 節 規則9「同値でも重複としない」：現行 `finalizeCandidate` は IR 完全一致のみで一致（同方針）。**食い違いなし**（確認結果として記録） | 一致 |
| D14 | 指示書 規則8「eval しない」：LLM 出力は `wireToSegments`（決定的パーサー）を通り、eval/sympify への経路は見当たらない（`cas_core` 側の `to_sympy` は演算子表）。**食い違いなし** | 一致 |


> 失効：基準が v2.x になったため、v1.9 との食い違いは対応不要。D13・D14（規則8・9 は既に守られている）の確認結果だけは有効。

### 試験結果（段階0 時点）

段階0 では未実施。結果は上の「現在の状態」に記録する。
