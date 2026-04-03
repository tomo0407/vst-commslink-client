# CommsLink Client — 実装仕様書

## 概要

スマートフォンのマイク音声を VST プラグインへ WebRTC DataChannel でストリームするための Web アプリ。
Vercel にデプロイされ、Next.js の API Routes がシグナリング中継サーバーも兼ねる。

---

## 使用ライブラリ・サービス

| 名称 | バージョン | 役割 |
|---|---|---|
| Next.js | ^15 | フレームワーク (API Routes + 静的配信) |
| React | ^18 | 使用は最小限 (フロントは vanilla JS) |
| @upstash/redis | ^1.34.0 | Vercel KV (Redis) クライアント |
| Upstash Redis | — (外部サービス) | offer/answer を TTL 300s で一時保管する KV ストア |
| WebRTC (ブラウザ標準) | — | P2P 音声伝送 (DataChannel) |
| WebCodecs AudioEncoder (ブラウザ標準) | — | Opus エンコード |
| AudioWorklet (ブラウザ標準) | — | マイク PCM の 20ms フレーム化 |

---

## ディレクトリ構成

```
vst-commslink-client/
├── app/
│   └── api/
│       ├── offer/route.ts          # POST /api/offer
│       ├── offers/[id]/route.ts    # GET  /api/offers/[vstId]
│       ├── answer/route.ts         # POST /api/answer
│       └── answer/[id]/route.ts    # GET  /api/answer/[sessionId]
├── lib/
│   └── redis.ts                    # Upstash Redis クライアント (シングルトン)
├── public/
│   ├── index.html                  # スマホ向け Web UI (vanilla JS)
│   └── worklet.js                  # AudioWorkletProcessor
├── next.config.ts                  # / → /index.html リライト設定
└── package.json
```

---

## アーキテクチャ全体図

```
[スマホブラウザ]                [Vercel (Edge Functions)]       [VST]
     |                                    |                      |
     |-- POST /api/offer ---------------→|                      |
     |   {vst_id, session_id, sdp}        | Redis:              |
     |                                    |  offer:{sid} = ...  |
     |                                    |  pending:{vstId} << sid
     |                                    |                      |
     |                                    |←-- GET /api/offers/[vstId] (2秒ポーリング)
     |                                    |                      |
     |                                    |-- offers[] ---------→|
     |                                    |                      | WebRTC answer 生成
     |                                    |←-- POST /api/answer -|
     |                                    | Redis:              |
     |                                    |  answer:{sid} = ... |
     |←-- GET /api/answer/[sid] (ポーリング)                    |
     |    {sdp: answer} ----------------→|                      |
     |                                                           |
     |================== WebRTC DTLS P2P (UDP) ================|
     |================== DataChannel OPEN =====================|
     |                                                           |
     | DataChannel binary: [4B cid][2B seq][Opus]              |
     |----------------------------------------------------------→|
```

---

## シグナリング API

### `POST /api/offer` — `app/api/offer/route.ts`

スマホが SDP offer を投稿する。

**リクエスト Body (JSON):**
```json
{ "vst_id": "a1b2c3d4", "session_id": "ab12cd34ef56", "sdp": "v=0\r\n..." }
```

**Redis への書き込み:**
```
SET offer:{session_id}   { vst_id, sdp }  EX 300
LPUSH pending:{vst_id}   session_id
EXPIRE pending:{vst_id}  300
```

**レスポンス:** `{ "ok": true }` / エラー時 400

---

### `GET /api/offers/[id]` — `app/api/offers/[id]/route.ts`

VST がポーリングして未処理の offer を受け取る。`[id]` = vstId。

**Redis からの読み出し:**
```
LRANGE pending:{vstId}  0 -1   → sessionId の配列
DEL    pending:{vstId}         → キューをアトミックにクリア
GET    offer:{sessionId}       → { vst_id, sdp } (各 sessionId に対して)
```

**レスポンス:** offer オブジェクトの配列 (空の場合は `[]`)
```json
[{ "session_id": "ab12cd34ef56", "sdp": "v=0\r\n..." }]
```

---

### `POST /api/answer` — `app/api/answer/route.ts`

VST が SDP answer を投稿する。

**リクエスト Body (JSON):**
```json
{ "session_id": "ab12cd34ef56", "sdp": "v=0\r\n..." }
```

**Redis への書き込み:**
```
SET answer:{session_id}  { sdp }  EX 300
```

**レスポンス:** `{ "ok": true }` / エラー時 400

---

### `GET /api/answer/[id]` — `app/api/answer/[id]/route.ts`

スマホがポーリングして VST の answer を受け取る。`[id]` = sessionId。

**Redis からの読み出し:**
```
GET answer:{sessionId}  → { sdp }
```

**レスポンス:** `{ "sdp": "v=0\r\n..." }` / 未着なら 404

---

### `lib/redis.ts`

Upstash Redis のシングルトンクライアント。全 API ルートからインポートされる。

```typescript
export const kv = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});
```

Vercel に設定が必要な環境変数: `KV_REST_API_URL` / `KV_REST_API_TOKEN`

---

## フロントエンド (`public/index.html`)

静的 HTML + vanilla JS。Next.js の rewrite で `/` → `/index.html` にルーティングされる。

### 定数

| 定数 | 値 | 意味 |
|---|---|---|
| `SIGNALING_URL` | `''` (空文字) | API は同一オリジン (相対パス) |
| `SAMPLE_RATE` | 48000 | Opus は 48kHz 固定 |
| `FRAME_SAMPLES` | 960 | 20ms × 48kHz = 1 フレーム |
| `POLL_INTERVAL` | 2000ms | answer ポーリング間隔 |
| `POLL_MAX` | 30 | タイムアウトまでの試行回数 (=60秒) |
| `ICE_SERVERS` | stun:stun.l.google.com:19302 | STUN サーバー |

### 接続フロー (`connect()`)

```
1. URL の ?id= から vstId を取得 (なければエラー)
2. sessionId を crypto.getRandomValues で 12 文字 hex 生成
3. RTCPeerConnection 作成 (ICE_SERVERS 設定)
4. DataChannel 'audio' 作成
   └─ ordered: false, maxRetransmits: 0 (unreliable = 低遅延優先)
5. pc.createOffer() → pc.setLocalDescription()
6. waitForIceComplete() で iceGatheringState === 'complete' を待つ
   └─ ICE 候補を SDP に全部埋め込む (non-trickle ICE)
7. POST /api/offer に offer SDP を送信
8. 以下を並列実行:
   a. pollAnswer(sessionId): 2秒ごとに GET /api/answer/[sessionId]
   b. navigator.mediaDevices.getUserMedia({ audio: ... }) でマイク取得
9. answer SDP が返ってきたら pc.setRemoteDescription()
10. WebRTC DTLS ハンドシェイク → DataChannel OPEN → onDataChannelOpen()
```

### DataChannel メッセージハンドリング

**送信 (スマホ → VST):**

| タイミング | 内容 |
|---|---|
| DataChannel open 直後 | `{"type":"hello","name":"...","sampleRate":48000,"channels":1}` |
| 音声データ | バイナリフレーム `[4B client_id][2B seq_num][N bytes Opus]` |

**受信 (VST → スマホ):**

| メッセージ | 処理 |
|---|---|
| `{"type":"ack","clientId":N}` | `onAck(N)` を呼び出し → オーディオパイプライン起動 |
| `{"type":"error","message":"..."}` | disconnect + エラー表示 |

### オーディオパイプライン (`onAck()` 以降)

```
getUserMedia (48kHz, 1ch, echoCancellation, noiseSuppression)
  ↓ MediaStreamSource
AudioWorkletNode('audio-capture')    ← worklet.js
  ↓ port.onmessage: Float32Array (960 samples)
onFrame()
  ↓ new AudioData (format: 'f32', 960 frames, 48kHz)
AudioEncoder (codec: 'opus', 48kHz, 1ch, bitrate: 32kbps)
  ↓ output callback: sendChunk()
DataChannel.send(Uint8Array)         ← バイナリフレーム組み立て
```

**ミュートの代わりに** AudioContext の gain=0 ノードへ接続することでマイクを起動し続けつつスピーカー出力を抑制。

---

## `public/worklet.js` (AudioWorkletProcessor)

AudioWorklet スコープで動作する `AudioCapture` プロセッサ。

**処理:**
1. 内部バッファ (`Float32Array(960)`) に入力チャンネルのサンプルを蓄積
2. 960 サンプル溜まったら `this.port.postMessage(buf.slice(0))` でメインスレッドへ送信
3. `return true` でプロセッサを継続動作させる

**なぜ 960 サンプルか:** Opus の 20ms フレームサイズ (48kHz × 0.02s = 960)。
AudioWorklet のブロックサイズ (通常 128 samples) とは異なるため、プロセッサ内でバッファリングする必要がある。

---

## バイナリフレームフォーマット

DataChannel 上を流れるオーディオフレームの構造:

```
Offset  Size  内容
──────  ────  ─────────────────────────────────────
0       4B    client_id  (uint32 big-endian)  ← ack で受け取った値
4       2B    seq_num    (uint16 big-endian)  ← 0 から 65535 でループ
6       NB    Opus パケット (可変長、約 20～100 bytes)
```

---

## デプロイ・環境変数

```
KV_REST_API_URL    = https://...upstash.io
KV_REST_API_TOKEN  = ...
```

Upstash ダッシュボードで Vercel プロジェクトに Connect するか、
Vercel Settings > Environment Variables に手動で追加する。

**Redis キーの TTL:** 全て 300 秒 (5分)。シグナリングが終われば自動削除される。

---

## `next.config.ts`

```typescript
rewrites: [{ source: '/', destination: '/index.html' }]
```

Next.js のルーティングを `public/index.html` に逃がすための設定。
API ルートは `/api/*` で通常通り動作する。
