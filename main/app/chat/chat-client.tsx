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
      const text = s.chunk
        ? `<strong>[${s.rank}] 《${s.chunk.book_title}》${s.chunk.chapter_title}</strong><br/>${s.chunk.text}`
        : `<strong>[${s.rank}]</strong> ${s.text ?? ""}`;
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
};

export function ChatClient({
  homepageName,
  chatbotDescription,
  chatbotIntroMessage,
  chatApiUrl,
  chatLib,
  searchMode,
}: ChatClientProps) {
  const chatRef = useRef<DeepChatElement | null>(null);
  const historyRef = useRef<HistoryMessage[]>([]);
  const lastQuestionRef = useRef<string>("");
  const [initialHistory, setInitialHistory] = useState<
    Array<{ role: string; text?: string; html?: string }>
  >([]);

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

  const clearChatHistory = useCallback(() => {
    localStorage.removeItem(HISTORY_KEY);
    window.location.reload();
  }, []);

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
        topk: 5,
        messages: priorMessages,
      };

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
  }, [chatApiUrl, chatLib, searchMode]);

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
          <p className="text-muted-foreground">{chatbotDescription}</p>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm [&>deep-chat]:!w-full [&>deep-chat]:!block">
            <DeepChat
              ref={chatRef}
              style={{ borderRadius: "12px", height: "560px" }}
              introMessage={{ text: chatbotIntroMessage }}
              history={initialHistory}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
