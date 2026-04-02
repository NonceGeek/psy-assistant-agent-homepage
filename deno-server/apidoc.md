# Scaffold Agent Homepage — API Documentation

> Deno backend server providing chat, TF-IDF search, vector search (Supabase pgvector), and RAG endpoints.
> LLM & embeddings powered by OpenRouter.

## Base URL

```
http://localhost:4403
```

---

## Public Endpoints

### `GET /`

Server greeting.

**Response:**
```
Hello from Movement x402 Server!
Pay-to address: <MOVEMENT_PAY_TO>
```

---

### `GET /health`

Health check endpoint for monitoring and load balancers.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-04T12:00:00.000Z"
}
```

---

### `GET /docs`

Get API documentation in Markdown format.

**Response:** Raw Markdown content of this documentation.

---

### `GET /docs/html`

Get API documentation rendered as HTML with GitHub Flavored Markdown styling.

**Response:** HTML page with rendered documentation.

---

## Chat Endpoints

### `POST /api/chat`

Chat with the AI agent (powered by OpenRouter / Qwen).

**Request Body:**
```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello, what can you do?" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | array | Yes | Array of chat messages in OpenAI-compatible format. Each message has `role` (`system`, `user`, or `assistant`) and `content`. |

**Success Response (200):**
```json
{
  "text": "I can help you with..."
}
```

**Error Responses:**

- `400` — Missing or invalid `messages` array
```json
{ "error": "messages array is required" }
```

- `500` — API key not configured or internal error
```json
{ "error": "API_KEY not configured" }
```

**Example:**
```bash
curl -X POST http://localhost:4403/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello, what can you do?"}]}'
```

---

## Search Endpoints

### `GET /api/search`

TF-IDF full-text search over a knowledge library. The server auto-discovers all `data_*` folders at startup; each folder is registered as a library (e.g. `data_tfidf/` → `lib=tfidf`).

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `q` | string | Yes | — | Search query |
| `lib` | string | Yes | — | Library name (maps to `data_<lib>/chunks.jsonl`) |
| `topk` | number | No | `10` | Number of top results to return (1–50) |

**Success Response (200):**
```json
{
  "query": "藏传佛教如何看待死亡",
  "lib": "tfidf",
  "topk": 10,
  "total_chunks": 137,
  "results": [
    {
      "rank": 1,
      "score": 0.4321,
      "chunk": {
        "book_title": "八万四千问",
        "author": "宗萨蒋扬钦哲仁波切",
        "spine_index": 10,
        "href": "text/part0009.html",
        "chapter_title": "第三章 死亡与转世",
        "chunk_index": 2,
        "char_start": 0,
        "char_end": 900,
        "text": "..."
      }
    }
  ]
}
```

**Error Responses:**

- `400` — Missing `lib` or `q`
```json
{ "error": "query parameter 'lib' is required", "available": ["tfidf"] }
```

- `404` — Library not found
```json
{ "error": "lib \"foo\" not found", "available": ["tfidf"] }
```

**Example:**
```bash
curl "http://localhost:4403/api/search?lib=tfidf&q=藏传佛教如何看待死亡&topk=10"
```

---

### `GET /api/vector_search`

Semantic search using Supabase pgvector embeddings (requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the `match_agent_lib_psy` SQL function).

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `q` | string | Yes | — | Search query |
| `topk` | number | No | `10` | Number of top results to return (1–50) |

**Success Response (200):**
```json
{
  "query": "如何面对焦虑",
  "topk": 10,
  "results": [
    {
      "rank": 1,
      "similarity": 0.8234,
      "text": "..."
    }
  ]
}
```

**Example:**
```bash
curl "http://localhost:4403/api/vector_search?q=如何面对焦虑&topk=10"
```

---

### `POST /api/search_and_chat`

RAG (Retrieval-Augmented Generation) endpoint. Retrieves relevant context via TF-IDF or vector search, builds a context-aware prompt, and sends it to the LLM. Returns the AI answer together with the sources used.

Supports two retrieval backends via `search_mode`:

| Mode | Backend | Requires |
|------|---------|----------|
| `"tfidf"` (default) | In-memory TF-IDF sparse search | `lib` parameter + `data_<lib>/chunks.jsonl` |
| `"vector"` | Supabase pgvector semantic search | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `match_agent_lib_psy` SQL function |

**Request Body:**
```json
{
  "q": "藏传佛教如何看待死亡",
  "lib": "tfidf",
  "topk": 10,
  "messages": [],
  "search_mode": "tfidf",
  "system_prompt": null
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `q` | string | Yes | — | User question |
| `search_mode` | string | No | `"tfidf"` | Retrieval backend: `"tfidf"` or `"vector"` |
| `lib` | string | Conditional | — | Library name (required when `search_mode` is `"tfidf"`) |
| `topk` | number | No | `10` | Number of chunks to retrieve (1–50) |
| `messages` | array | No | `[]` | Prior conversation messages for multi-turn context. Each has `role` and `content`. |
| `system_prompt` | string | No | (built-in RAG prompt) | Override system prompt; when null or omitted, server uses default RAG system prompt with context. |

**Success Response — TF-IDF mode (200):**
```json
{
  "text": "根据资料，藏传佛教认为死亡是……",
  "sources": [
    {
      "rank": 1,
      "score": 0.4321,
      "chunk": {
        "book_title": "八万四千问",
        "author": "宗萨蒋扬钦哲仁波切",
        "chapter_title": "第三章 死亡与转世",
        "chunk_index": 2,
        "text": "..."
      }
    }
  ]
}
```

**Success Response — Vector mode (200):**
```json
{
  "text": "根据资料，面对焦虑时可以……",
  "sources": [
    {
      "rank": 1,
      "score": 0.8234,
      "text": "..."
    }
  ]
}
```

**Error Responses:**

- `400` — Missing `q`, or missing `lib` when `search_mode` is `"tfidf"`
- `404` — Library not found (TF-IDF mode only)
- `500` — API key not configured, Supabase not configured, or internal error

**Example — TF-IDF mode:**
```bash
curl -X POST http://localhost:4403/api/search_and_chat \
  -H "Content-Type: application/json" \
  -d '{"q": "藏传佛教如何看待死亡", "lib": "tfidf", "topk": 10}'
```

**Example — Vector mode:**
```bash
curl -X POST http://localhost:4403/api/search_and_chat \
  -H "Content-Type: application/json" \
  -d '{"q": "如何面对焦虑", "search_mode": "vector", "topk": 10}'
```

**Example — Vector mode with multi-turn context and custom system prompt:**
```bash
curl -X POST http://localhost:4403/api/search_and_chat \
  -H "Content-Type: application/json" \
  -d '{
    "q": "那具体应该怎么做呢",
    "search_mode": "vector",
    "topk": 10,
    "system_prompt": "你是专业心理咨询师，用共情与接纳回应用户，并给出可实践的建议。",
    "messages": [
      {"role": "user", "content": "如何面对焦虑"},
      {"role": "assistant", "content": "面对焦虑时，可以尝试……"}
    ]
  }'
```

---

### `POST /api/trans_cantonese`

Transcribe (or translate) uploaded audio using **OpenRouter chat completions** with `input_audio` (OpenRouter does **not** proxy OpenAI’s `/v1/audio/transcriptions`; Whisper multipart is not used here).

**Request:** `multipart/form-data`

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `file` | Yes | — | **WAV or MP3** are sent directly to OpenAI. **M4A / AAC / MP4 / FLAC / OGG / WebM** are converted to MP3 **in memory** with **ffmpeg** if `ffmpeg` is on `PATH` (or `FFMPEG_PATH`). Without ffmpeg, upload WAV/MP3 only. |
| `language` | No | `yue` | Language hint (e.g. `yue` for Cantonese) |
| `prompt` | No | — | Extra instructions for the model |
| `task` | No | `transcribe` | `transcribe` or `translate` (to English) |

**Success (200):** `{ "text": "..." }`

**Example:**

```bash
curl -X POST "http://localhost:4403/api/trans_cantonese" \
  -F "file=@./recording.m4a" \
  -F "language=yue" \
  -F "task=transcribe"
```

Default transcription model: `openai/gpt-4o-audio-preview`. Override with env `OPENROUTER_TRANSCRIPTION_MODEL`.

**Notes:**

- Uploads are parsed **in memory** (up to 25MB) so the handler works on hosts where `Deno.makeTempDir()` is unavailable.
- OpenAI’s `input_audio` only allows `format`: `wav` | `mp3`. M4A etc. require **ffmpeg** for server-side conversion (stdin/stdout, no temp files).
- Optional env **`FFMPEG_PATH`**: path to `ffmpeg` binary if not on `PATH`.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` | Yes | — | OpenRouter API key for chat, embeddings, and RAG endpoints |
| `OPENROUTER_TRANSCRIPTION_MODEL` | No | `openai/gpt-4o-audio-preview` | Model for `/api/trans_cantonese` (must support audio input on OpenRouter) |
| `FFMPEG_PATH` | No | `ffmpeg` on PATH | Used to convert m4a/aac/… → mp3 in memory when file is not WAV/MP3 |
| `SUPABASE_URL` | No | — | Supabase project URL (required for vector search) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | — | Supabase service-role key (required for vector search) |
| `SERVER_PORT` | No | `4403` | Server listen port |

---

**Built with Deno and Oak**
