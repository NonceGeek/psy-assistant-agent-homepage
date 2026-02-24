/**
 * Deno Server for Letter Project
 * A simple Oak-based web server for the "致粉丝的信" project
 * Provides API endpoints and serves static content
 */

import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { CSS, render } from "@deno/gfm";

// Initialize Deno KV database
// const kv = await Deno.openKv();

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
    context.response.body = `Hello from Movement x402 Server!\nPay-to address: ${Deno.env.get("MOVEMENT_PAY_TO")}`;
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
    const apiKey = Deno.env.get("DASHSCOPE_API_KEY");
    if (!apiKey) {
      context.response.status = 500;
      context.response.body = { error: "DASHSCOPE_API_KEY not configured" };
      return;
    }

    const body = await context.request.body({ type: "json" }).value;
    const messages = body.messages;
    if (!messages || !Array.isArray(messages)) {
      context.response.status = 400;
      context.response.body = { error: "messages array is required" };
      return;
    }

    try {
      const resp = await fetch(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "qwen-plus",
            messages,
          }),
        },
      );

      if (!resp.ok) {
        const err = await resp.text();
        console.error("DashScope API error:", err);
        context.response.status = resp.status;
        context.response.body = { error: "Chat API request failed", detail: err };
        return;
      }

      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content ?? "";

      context.response.body = { text };
    } catch (err) {
      console.error("Chat API error:", err);
      context.response.status = 500;
      context.response.body = { error: "Internal chat error" };
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
  .post("/api/search_and_chat", async (context) => {
    // RAG endpoint: search for relevant chunks then ask the LLM
    // Body: { q: string, lib: string, topk?: number, messages?: [...] }
    const apiKey = Deno.env.get("DASHSCOPE_API_KEY");
    if (!apiKey) {
      context.response.status = 500;
      context.response.body = { error: "DASHSCOPE_API_KEY not configured" };
      return;
    }

    const body = await context.request.body({ type: "json" }).value;
    const q: string = body.q || "";
    const lib: string = body.lib || "";
    const topk: number = Math.min(Math.max(Number(body.topk) || 5, 1), 50);

    if (!lib.trim()) {
      context.response.status = 400;
      context.response.body = {
        error: "'lib' is required",
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
      context.response.body = { error: "'q' is required" };
      return;
    }

    // Step 1: retrieve relevant chunks
    const searchResults = index.query(q, topk);
    const contextChunks = searchResults
      .map(
        (r) =>
          `[${r.chunk.chapter_title} | ${r.chunk.href} chunk#${r.chunk.chunk_index}]\n${r.chunk.text}`,
      )
      .join("\n\n---\n\n");

    // Step 2: build RAG messages
    const systemPrompt =
      "你是严谨的问答助手。只允许依据下方【资料】回答用户的问题；如果资料不足以回答，请如实说明。" +
      "回答时请给出引用来源（章节标题 + chunk 编号）。\n\n" +
      `【资料】\n${contextChunks}`;

    const priorMessages: Array<{ role: string; content: string }> =
      Array.isArray(body.messages) ? body.messages : [];

    const messages = [
      { role: "system", content: systemPrompt },
      ...priorMessages,
      { role: "user", content: q },
    ];

    // Step 3: call LLM
    try {
      const resp = await fetch(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: "qwen-plus", messages }),
        },
      );

      if (!resp.ok) {
        const err = await resp.text();
        console.error("DashScope API error:", err);
        context.response.status = resp.status;
        context.response.body = { error: "Chat API request failed", detail: err };
        return;
      }

      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content ?? "";

      context.response.body = {
        text,
        sources: searchResults,
      };
    } catch (err) {
      console.error("search_and_chat error:", err);
      context.response.status = 500;
      context.response.body = { error: "Internal error" };
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
  💰 Pay-to address: ${Deno.env.get("MOVEMENT_PAY_TO")}
  `);

await app.listen({ port });