/* 
TODO（NOT DELETE):
- 优化这个后端代码，
- 环境变量有：
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_URL
- API_KEY

- 将 API 的调用替换为 OpenRouter 的 API
 */

import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { CSS, render } from "@deno/gfm";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Config — reads from environment variables:
//   API_KEY                   – OpenRouter API key (chat + embeddings)
//   SUPABASE_URL              – Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY – Supabase service-role key (bypasses RLS)
// ---------------------------------------------------------------------------

const OPENROUTER_KEY = Deno.env.get("API_KEY") || "";
const CHAT_MODEL = "qwen/qwen3-30b-a3b";
const EMBEDDING_MODEL = "qwen/qwen3-embedding-4b";
const EMBEDDING_DIMENSIONS = 1024;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ---------------------------------------------------------------------------
// TF-IDF Search Module
// Pure-JS reimplementation of data_tfidf/query.py + build_index.py
// Builds an in-memory TF-IDF index from chunks.jsonl at startup.
// Matches sklearn defaults: analyzer='char', ngram_range=(2,4), smooth_idf,
// L2-normalized vectors.
// ---------------------------------------------------------------------------

type Chunk = {
  book_title: string;
  author: string;
  spine_index: number;
  href: string;
  chapter_title: string;
  chunk_index: number;
  char_start: number;
  char_end: number;
  text: string;
};

type SparseVec = Map<number, number>;

function charNgrams(text: string, minN: number, maxN: number): string[] {
  const ngrams: string[] = [];
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= text.length - n; i++) {
      ngrams.push(text.slice(i, i + n));
    }
  }
  return ngrams;
}

function sparseDot(a: SparseVec, b: SparseVec): number {
  let dot = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of smaller) {
    const bv = larger.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  return dot;
}

function sparseL2Normalize(vec: SparseVec): SparseVec {
  let sum = 0;
  for (const v of vec.values()) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  const out: SparseVec = new Map();
  for (const [k, v] of vec) out.set(k, v / norm);
  return out;
}

class TfidfIndex {
  private vocab: Map<string, number> = new Map();
  private idf: Float64Array = new Float64Array(0);
  private matrix: SparseVec[] = [];
  chunks: Chunk[] = [];

  constructor(chunks: Chunk[]) {
    this.chunks = chunks;
    this.build();
  }

  private build() {
    const n = this.chunks.length;
    const df = new Map<string, number>();
    const docNgramsList: string[][] = [];

    for (const chunk of this.chunks) {
      const ngrams = charNgrams(chunk.text, 2, 4);
      docNgramsList.push(ngrams);
      const seen = new Set<string>();
      for (const ng of ngrams) {
        if (!seen.has(ng)) {
          seen.add(ng);
          df.set(ng, (df.get(ng) || 0) + 1);
        }
      }
    }

    // Build vocabulary (sorted for determinism, matching sklearn)
    const terms = [...df.keys()].sort();
    for (let i = 0; i < terms.length; i++) {
      this.vocab.set(terms[i], i);
    }

    // IDF: log((1 + n) / (1 + df)) + 1  (sklearn smooth_idf=True)
    this.idf = new Float64Array(terms.length);
    for (let i = 0; i < terms.length; i++) {
      this.idf[i] = Math.log((1 + n) / (1 + df.get(terms[i])!)) + 1;
    }

    // Build sparse TF-IDF vectors, L2-normalized
    this.matrix = [];
    for (const ngrams of docNgramsList) {
      const tf: SparseVec = new Map();
      for (const ng of ngrams) {
        const idx = this.vocab.get(ng)!;
        tf.set(idx, (tf.get(idx) || 0) + 1);
      }
      for (const [idx, count] of tf) {
        tf.set(idx, count * this.idf[idx]);
      }
      this.matrix.push(sparseL2Normalize(tf));
    }

    console.log(`  📚 TF-IDF index built: ${this.chunks.length} chunks, ${terms.length} terms`);
  }

  query(queryText: string, topk = 5) {
    const ngrams = charNgrams(queryText, 2, 4);
    const qvec: SparseVec = new Map();
    for (const ng of ngrams) {
      const idx = this.vocab.get(ng);
      if (idx !== undefined) qvec.set(idx, (qvec.get(idx) || 0) + 1);
    }
    for (const [idx, count] of qvec) {
      qvec.set(idx, count * this.idf[idx]);
    }
    const qNorm = sparseL2Normalize(qvec);

    const scored = this.matrix.map((dvec, i) => ({
      index: i,
      score: sparseDot(qNorm, dvec),
    }));
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topk).map((s, rank) => ({
      rank: rank + 1,
      score: +s.score.toFixed(4),
      chunk: this.chunks[s.index],
    }));
  }
}

async function loadChunksJsonl(path: string): Promise<Chunk[]> {
  const text = await Deno.readTextFile(path);
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

// Map of lib name -> TfidfIndex, e.g. "tfidf" -> index built from data_tfidf/
const tfidfIndices: Map<string, TfidfIndex> = new Map();

async function loadAllIndices() {
  for await (const entry of Deno.readDir(".")) {
    if (!entry.isDirectory || !entry.name.startsWith("data_")) continue;
    const lib = entry.name.slice("data_".length); // "data_tfidf" -> "tfidf"
    const chunksPath = `./${entry.name}/chunks.jsonl`;
    try {
      const chunks = await loadChunksJsonl(chunksPath);
      const index = new TfidfIndex(chunks);
      tfidfIndices.set(lib, index);
      console.log(`  📚 Loaded lib="${lib}" from ${chunksPath}`);
    } catch (err) {
      console.warn(`  ⚠️  Skipping ${entry.name}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers — OpenRouter LLM + embeddings, Supabase vector search
// ---------------------------------------------------------------------------

async function callLLM(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  if (!OPENROUTER_KEY) throw new Error("API_KEY not configured");

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({ model: CHAT_MODEL, messages }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenRouter chat ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function getQueryEmbedding(text: string): Promise<number[]> {
  if (!OPENROUTER_KEY) throw new Error("API_KEY not configured");

  const resp = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenRouter embeddings ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.data[0].embedding;
}

type VectorResult = {
  id: number;
  embedding_input: string;
  similarity: number;
};

// Requires a Supabase SQL function:
//   match_agent_lib_psy(query_embedding vector(1024), match_threshold float, match_count int)
async function vectorSearch(
  query: string,
  topk = 5,
  threshold = 0.3,
): Promise<VectorResult[]> {
  if (!supabase) throw new Error("Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");

  const embedding = await getQueryEmbedding(query);
  const { data, error } = await supabase.rpc("match_agent_lib_psy", {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: topk,
  });

  if (error) throw error;
  return (data ?? []) as VectorResult[];
}

// // Admin password verification function
// async function verifyAdminPassword(
//   context: any,
//   password: string
// ): Promise<boolean> {
//   const adminPwd = Deno.env.get("ADMIN_PWD");
//   if (!password || password !== adminPwd) {
//     context.response.status = 401;
//     context.response.body = { error: "Unauthorized: Invalid password" };
//     return false;
//   }
//   return true;
// }

// Initialize router
const router = new Router();

// API Routes
router
  .get("/", async (context) => {
    context.response.body = `Hello from Psy ChatBot Server`;
  })
  .get("/health", (context) => {
    // Health check endpoint
    context.response.body = {
      status: "healthy",
      timestamp: new Date().toISOString(),
    };
  })
  .get("/docs", async (context) => {
    try {
      const readmeText = await Deno.readTextFile("./apidoc.md");
      context.response.body = readmeText;
    } catch (err) {
      console.error("Error reading README:", err);
      context.response.status = 500;
      context.response.body = { error: "Could not load documentation" };
    }
  })
  .get("/docs/html", async (context) => {
    try {
      // Read README.md file
      const readmeText = await Deno.readTextFile("./apidoc.md");

      // Render markdown to HTML with GFM styles
      const body = render(readmeText);

      // Create complete HTML document with GFM CSS
      const html = `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>TaiShang AI Agent Market API Documentation</title>
      <style>
        ${CSS}
        body {
          max-width: 900px;
          margin: 0 auto;
          padding: 20px;
        }
      </style>
    </head>
    <body>
    ${body}
    </body>
    </html>`;

      // Set response headers for HTML
      context.response.headers.set("Content-Type", "text/html; charset=utf-8");
      context.response.body = html;
    } catch (err) {
      console.error("Error reading README:", err);
      context.response.status = 500;
      context.response.body = { error: "Could not load documentation" };
    }
  })
  .post("/api/chat", async (context) => {
    const body = await context.request.body({ type: "json" }).value;
    const messages = body.messages;
    if (!messages || !Array.isArray(messages)) {
      context.response.status = 400;
      context.response.body = { error: "messages array is required" };
      return;
    }

    try {
      const text = await callLLM(messages);
      context.response.body = { text };
    } catch (err) {
      console.error("Chat API error:", err);
      context.response.status = 500;
      context.response.body = { error: String(err) };
    }
  })
  .get("/api/search", (context) => {
    // TF-IDF search endpoint
    // Usage: GET /api/search?q=藏传佛教如何看待死亡&topk=5&lib=tfidf
    const params = context.request.url.searchParams;
    const q = params.get("q") || "";
    const lib = params.get("lib") || "";
    const topk = Math.min(Math.max(parseInt(params.get("topk") || "5", 10) || 5, 1), 50);

    if (!lib.trim()) {
      context.response.status = 400;
      context.response.body = {
        error: "query parameter 'lib' is required",
        available: [...tfidfIndices.keys()],
      };
      return;
    }

    const index = tfidfIndices.get(lib);
    if (!index) {
      context.response.status = 404;
      context.response.body = {
        error: `lib "${lib}" not found`,
        available: [...tfidfIndices.keys()],
      };
      return;
    }

    if (!q.trim()) {
      context.response.status = 400;
      context.response.body = { error: "query parameter 'q' is required" };
      return;
    }

    const results = index.query(q, topk);
    context.response.body = {
      query: q,
      lib,
      topk,
      total_chunks: index.chunks.length,
      results,
    };
  })
  .get("/api/vector_search", async (context) => {
    // Supabase pgvector semantic search
    // Usage: GET /api/vector_search?q=如何面对焦虑&topk=5
    const params = context.request.url.searchParams;
    const q = params.get("q") || "";
    const topk = Math.min(Math.max(parseInt(params.get("topk") || "5", 10) || 5, 1), 50);

    if (!q.trim()) {
      context.response.status = 400;
      context.response.body = { error: "query parameter 'q' is required" };
      return;
    }

    try {
      const results = await vectorSearch(q, topk);
      context.response.body = {
        query: q,
        topk,
        results: results.map((r, i) => ({
          rank: i + 1,
          similarity: +r.similarity.toFixed(4),
          text: r.embedding_input,
        })),
      };
    } catch (err) {
      console.error("vector_search error:", err);
      context.response.status = 500;
      context.response.body = { error: String(err) };
    }
  })
  .post("/api/search_and_chat", async (context) => {
    // RAG endpoint: search for relevant chunks then ask the LLM
    // Body: { q, lib, topk?, messages?, search_mode?: "tfidf" | "vector" }
    const body = await context.request.body({ type: "json" }).value;
    const q: string = body.q || "";
    const lib: string = body.lib || "";
    const topk: number = Math.min(Math.max(Number(body.topk) || 5, 1), 50);
    const searchMode: string = body.search_mode || "tfidf";

    if (!q.trim()) {
      context.response.status = 400;
      context.response.body = { error: "'q' is required" };
      return;
    }

    try {
      // Step 1: retrieve relevant context based on search_mode
      let contextChunks: string;
      let sources: unknown[];

      if (searchMode === "vector") {
        // Supabase pgvector semantic search
        const results = await vectorSearch(q, topk);
        sources = results.map((r, i) => ({
          rank: i + 1,
          score: +r.similarity.toFixed(4),
          text: r.embedding_input,
        }));
        contextChunks = results
          .map((r, i) => `[vector result #${i + 1}, similarity ${r.similarity.toFixed(4)}]\n${r.embedding_input}`)
          .join("\n\n---\n\n");
      } else {
        // TF-IDF sparse search (requires lib)
        if (!lib.trim()) {
          context.response.status = 400;
          context.response.body = {
            error: "'lib' is required for tfidf search mode",
            available: [...tfidfIndices.keys()],
          };
          return;
        }
        const index = tfidfIndices.get(lib);
        if (!index) {
          context.response.status = 404;
          context.response.body = {
            error: `lib "${lib}" not found`,
            available: [...tfidfIndices.keys()],
          };
          return;
        }

        const searchResults = index.query(q, topk);
        sources = searchResults;
        contextChunks = searchResults
          .map(
            (r) =>
              `[${r.chunk.chapter_title} | ${r.chunk.href} chunk#${r.chunk.chunk_index}]\n${r.chunk.text}`,
          )
          .join("\n\n---\n\n");
      }

      // Step 2: build RAG messages
      // ! 可优化这个系统提示词，基于问题使用不同的「提示词模板」。
      const systemPrompt = `
      你是一个**专业心理咨询师**，当用户提出心理相关的问题时，你要用 **藏传佛教的世界观与心性观** 来理解与回应。
      
      在回答中，你需要：
      
      1. 以**藏传佛教的思维方式**来审视和解读问题，如：
         - 生命无常与痛苦的缘起性空
         - 对“心”的觉察与自性清净的理解
         - 通过慈悲、觉知、止观等方法引导用户自我觉醒与解脱  
         - 内在烦恼（贪嗔痴）不是个人失败，而是感受与知见的构造物，需要智慧去观察和了解  [oai_citation:0‡维基百科](https://zh.wikipedia.org/wiki/%E6%85%88_%28%E4%BD%9B%E6%95%99%29?utm_source=chatgpt.com)
      
      2. 在专业心理咨询框架下提供支持与引导：
         - 先用**共情与接纳**回应用户的感受
         - 结合藏传佛教及心理学（如正念觉察、观照习气等）给出**具体的实践建议**
      
      3. 尊重用户信仰与判断，不强加宗教观点：
         - 以佛法智慧辅助理解，而不是灌输宗教教义
         - 给出对用户有帮助，可立即实践的建议
      
      请注意，回答中无需给出参考资料。
      
      下面是可作为背景知识的资料：
      
      【资料】
      ${contextChunks}
      `;

      const priorMessages: Array<{ role: string; content: string }> =
        Array.isArray(body.messages) ? body.messages : [];

      const messages = [
        { role: "system", content: systemPrompt },
        ...priorMessages,
        { role: "user", content: q },
      ];

      // Step 3: call LLM via OpenRouter
      const text = await callLLM(messages);

      context.response.body = { text, sources };
    } catch (err) {
      console.error("search_and_chat error:", err);
      context.response.status = 500;
      context.response.body = { error: String(err) };
    }
  });

// Initialize application
const app = new Application();

// Middleware: Error handling
app.use(async (context, next) => {
  try {
    await next();
  } catch (err) {
    console.error("Error:", err);
    context.response.status = 500;
    context.response.body = {
      success: false,
      error: "Internal server error",
    };
  }
});

// Middleware: Logger
app.use(async (context, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${context.request.method} ${context.request.url} - ${ms}ms`);
});


// Middleware: Router
app.use(router.routes());

// Scan all data_* folders and build TF-IDF indices
await loadAllIndices();

// Start server
const port = Number(Deno.env.get("SERVER_PORT")) || 4403;

console.info(`
  🚀 CORS-enabled web server listening on port ${port}
  
  🌐 Visit: http://localhost:${port}
  `);

await app.listen({ port });