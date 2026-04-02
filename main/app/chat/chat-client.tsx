"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { marked } from "marked";
import { DeepChat } from "deep-chat-react";
import { Header } from "@/components/header";

const HISTORY_KEY = "psy_chat_history";

type Source = {
  rank: number;
  score: number;
  text?: string;
  /** Vector RAG source label (e.g. book/source name); API may send `source` instead */
  resource_name?: string;
  source?: string;
  chunk?: {
    book_title: string;
    author: string;
    chapter_title: string;
    chunk_index: number;
    text: string;
  };
};

type HistoryMessage = {
  role: string;
  content: string;
  citations?: Source[];
};

function loadHistory(): HistoryMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: HistoryMessage[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

function buildCitationHtml(content: string, sources: Source[]): string {
  const citationItems = sources
    .map((s) => {
      const resName = s.resource_name ?? s.source;
      const text = s.chunk
        ? `<strong>[${s.rank}] 《${s.chunk.book_title}》${s.chunk.chapter_title}</strong><br/>${s.chunk.text}`
        : `<strong>[${s.rank}]</strong><br/>${s.text ?? ""} —— ${resName ? `${resName}` : ""}`;

      return `<div style="margin-bottom:8px;padding:6px 8px;background:rgba(0,0,0,0.03);border-radius:6px;font-size:0.85em;line-height:1.5">${text}</div>`;
    })
    .join("");
  return (
    `<div class="markdown-body">${markdownToHtml(content)}</div>` +
    `<details style="margin-top:12px;cursor:pointer">` +
    `<summary style="font-size:0.9em;color:#666;user-select:none">📚 引用来源（${sources.length} 条）</summary>` +
    `<div style="margin-top:8px">${citationItems}</div>` +
    `</details>`
  );
}

type ChatClientProps = {
  homepageName: string;
  chatbotDescription: string;
  chatbotIntroMessage: string;
  chatApiUrl: string;
  chatLib: string;
  searchMode: string;
  /** When set, sent as system_prompt on the first user message only */
  prompt1?: string | null;
};

type ChatMessage = {
  role: string;
  text?: string;
  content?: string;
};

type InterceptorDetails = {
  body: {
    messages?: ChatMessage[];
  };
};

type ResponseDetails = {
  text?: string;
  html?: string;
  sources?: Source[];
};

type DeepChatElement = HTMLElement & {
  request?: {
    url: string;
    method: "POST";
    headers: Record<string, string>;
  };
  requestInterceptor?: (details: InterceptorDetails) => InterceptorDetails;
  responseInterceptor?: (response: ResponseDetails) => ResponseDetails;
  submitUserMessage?: (text: string) => void;
  addMessage?: (message: { role?: string; text?: string; html?: string }, isUpdate?: boolean) => void;
};

const MOOD_PROMPT = "今天心情怎么样？";
const MOOD_BUTTONS = ["非常高兴", "开心", "平淡", "难过", "崩溃"];

const TAG_CSV_URL = "/tag_content.csv";
const RANDOM_CHAT_SUFFIX = "\n\n 要进一步解析一下吗？";

type TagRow = { tag: string; content: string };

function parseTagCsv(csvText: string): TagRow[] {
  const lines = csvText.trim().split(/\r?\n/);
  const rows: TagRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const commaIdx = line.indexOf(",");
    if (commaIdx >= 0) {
      rows.push({
        tag: line.slice(0, commaIdx).trim(),
        content: line.slice(commaIdx + 1).trim(),
      });
    }
  }
  return rows;
}

export function ChatClient({
  homepageName,
  chatbotDescription,
  chatbotIntroMessage,
  chatApiUrl,
  chatLib,
  searchMode,
  prompt1,
}: ChatClientProps) {
  const chatRef = useRef<DeepChatElement | null>(null);
  const historyRef = useRef<HistoryMessage[]>([]);
  const lastQuestionRef = useRef<string>("");
  const [initialHistory, setInitialHistory] = useState<
    Array<{ role: string; text?: string; html?: string }>
  >([]);
  const [tagRows, setTagRows] = useState<TagRow[]>([]);

  // Load chat history from localStorage on mount, including citations for assistant messages
  useEffect(() => {
    const saved = loadHistory();
    historyRef.current = saved;
    setInitialHistory(
      saved.map((m) => {
        const role = m.role === "assistant" ? "ai" : m.role;
        if (m.role === "assistant") {
          if (m.citations?.length) {
            return { role, html: buildCitationHtml(m.content, m.citations) };
          }
          return { role, html: `<div class="markdown-body">${markdownToHtml(m.content)}</div>` };
        }
        return { role, text: m.content };
      }),
    );
  }, []);

  // Load tag_content.csv from public for "随便聊聊" button
  useEffect(() => {
    fetch(TAG_CSV_URL)
      .then((r) => r.text())
      .then((text) => setTagRows(parseTagCsv(text)))
      .catch(() => setTagRows([]));
  }, []);

  const clearChatHistory = useCallback(() => {
    localStorage.removeItem(HISTORY_KEY);
    window.location.reload();
  }, []);

  const sendMood = useCallback((text: string) => {
    const el = chatRef.current;
    if (el?.submitUserMessage) el.submitUserMessage("我今天感到" + text);
  }, []);

  const sendRandomChat = useCallback(() => {
    if (tagRows.length === 0) return;
    const el = chatRef.current;
    if (!el?.addMessage) return;
    const row = tagRows[Math.floor(Math.random() * tagRows.length)];
    const displayText = "【" + row.tag + "】" + row.content + RANDOM_CHAT_SUFFIX;
    // Add user message (tag) and assistant message (content + suffix) directly — no API call
    el.addMessage({ role: "user", text: row.tag }, false);
    el.addMessage({ role: "ai", html: `<div class="markdown-body">${markdownToHtml(displayText)}</div>` }, false);
    // Persist to history
    historyRef.current = [
      ...historyRef.current,
      { role: "user", content: row.tag },
      { role: "assistant", content: displayText },
    ];
    saveHistory(historyRef.current);
  }, [tagRows]);

  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;

    el.request = {
      url: chatApiUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    };

    // Transform Deep Chat messages into the search_and_chat RAG request format:
    // { q, search_mode, lib?, topk, messages }
    // Use historyRef (loaded from localStorage) as prior context for the API
    el.requestInterceptor = (details: InterceptorDetails) => {
      const allMessages = (details.body.messages || []).map((msg) => ({
        role: msg.role,
        content: msg.text ?? msg.content ?? "",
      }));

      const lastMessage = allMessages[allMessages.length - 1];
      const currentQuestion = lastMessage?.content ?? "";
      lastQuestionRef.current = currentQuestion;

      const priorMessages: Array<{ role: string; content: string }> =
        historyRef.current.map((m) => ({ role: m.role, content: m.content }));

      const payload: Record<string, unknown> = {
        q: currentQuestion,
        search_mode: searchMode,
        topk: 10,
        messages: priorMessages,
      };

      // First talk: no prior messages in history — send prompt1 as system_prompt if configured
      if (priorMessages.length === 0 && prompt1 != null && String(prompt1).trim() !== "") {
        payload.system_prompt = String(prompt1).trim();
      }

      // DO NOT REMOVE THIS CONSOLE.LOG
      console.log("payload", payload);

      // lib is only needed for tfidf mode
      if (searchMode === "tfidf") {
        payload.lib = chatLib;
      }

      details.body = payload as unknown as InterceptorDetails["body"];
      return details;
    };

    // Append source citations as collapsible <details>, persist history with citations
    el.responseInterceptor = (response: ResponseDetails) => {
      const answerText = response.text ?? "";

      // Save the exchange with citations (filtered when calling API)
      historyRef.current = [
        ...historyRef.current,
        { role: "user", content: lastQuestionRef.current },
        {
          role: "assistant",
          content: answerText,
          citations: response.sources,
        },
      ];
      saveHistory(historyRef.current);

      if (!response.sources?.length) {
        return { html: `<div class="markdown-body">${markdownToHtml(answerText)}</div>` };
      }
      return { html: buildCitationHtml(answerText, response.sources) };
    };
  }, [chatApiUrl, chatLib, searchMode, prompt1]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header homepageName={homepageName} />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{homepageName} Chat</h1>
            <button
              onClick={clearChatHistory}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
            >
              🗑️ 清除记录
            </button>
          </div>
          {/* <p className="text-muted-foreground">{chatbotDescription}</p> */}
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm [&>deep-chat]:!w-full [&>deep-chat]:!block">
            <DeepChat
              ref={chatRef}
              style={{ borderRadius: "12px", height: "550px" }}
              introMessage={{ text: chatbotIntroMessage }}
              history={initialHistory}
            />
            <br></br>
            <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground shrink-0">{MOOD_PROMPT}</p>
              <div className="flex flex-wrap gap-2">
                {MOOD_BUTTONS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => sendMood(label)}
                    className="rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={sendRandomChat}
                disabled={tagRows.length === 0}
                className="rounded-lg border border-border bg-muted/50 px-8 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50 min-w-[12rem]"
              >
                👉&nbsp;&nbsp;随便聊聊&nbsp;&nbsp;👈
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
