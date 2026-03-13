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
| `topk` | number | No | `5` | Number of top results to return (1–50) |

**Success Response (200):**
```json
{
  "query": "藏传佛教如何看待死亡",
  "lib": "tfidf",
  "topk": 5,
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
curl "http://localhost:4403/api/search?lib=tfidf&q=藏传佛教如何看待死亡&topk=5"
```

---

### `GET /api/vector_search`

Semantic search using Supabase pgvector embeddings (requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the `match_agent_lib_psy` SQL function).

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `q` | string | Yes | — | Search query |
| `topk` | number | No | `5` | Number of top results to return (1–50) |

**Success Response (200):**
```json
{
  "query": "如何面对焦虑",
  "topk": 5,
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
curl "http://localhost:4403/api/vector_search?q=如何面对焦虑&topk=5"
```

---

### `POST /api/search_and_chat`

RAG (Retrieval-Augmented Generation) endpoint. Retrieves relevant context via TF-IDF or vector search, builds a context-aware prompt, and sends it to the LLM. Returns the AI answer together with the sources used.

**Request Body:**
```json
{
  "q": "藏传佛教如何看待死亡",
  "lib": "tfidf",
  "topk": 5,
  "messages": [],
  "search_mode": "tfidf"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `q` | string | Yes | — | User question |
| `lib` | string | Conditional | — | Library name (required when `search_mode` is `"tfidf"`) |
| `topk` | number | No | `5` | Number of chunks to retrieve (1–50) |
| `messages` | array | No | `[]` | Prior conversation messages for multi-turn context. Each has `role` and `content`. |
| `search_mode` | string | No | `"tfidf"` | Retrieval backend: `"tfidf"` (in-memory sparse) or `"vector"` (Supabase pgvector semantic) |

**Success Response (200):**
```json
{
  "text": "根据资料，藏传佛教认为死亡是……\n\n引用来源：第三章 死亡与转世 chunk#2",
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

**Error Responses:**

- `400` — Missing `lib` or `q`
- `404` — Library not found
- `500` — API key not configured or internal error

**Example:**
```bash
curl -X POST http://localhost:4403/api/search_and_chat \
  -H "Content-Type: application/json" \
  -d '{"q": "藏传佛教如何看待死亡", "lib": "tfidf", "topk": 5}'
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` | Yes | — | OpenRouter API key for chat, embeddings, and RAG endpoints |
| `SUPABASE_URL` | No | — | Supabase project URL (required for vector search) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | — | Supabase service-role key (required for vector search) |
| `SERVER_PORT` | No | `4403` | Server listen port |

---

**Built with Deno and Oak**
