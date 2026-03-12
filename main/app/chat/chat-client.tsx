"use client";

import { useEffect, useRef } from "react";
import { DeepChat } from "deep-chat-react";
import { Header } from "@/components/header";

type ChatClientProps = {
  homepageName: string;
  chatbotDescription: string;
  chatbotIntroMessage: string;
  chatApiUrl: string;
  chatLib: string;
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

type DeepChatElement = HTMLElement & {
  request?: {
    url: string;
    method: "POST";
    headers: Record<string, string>;
  };
  requestInterceptor?: (details: InterceptorDetails) => InterceptorDetails;
};

export function ChatClient({
  homepageName,
  chatbotDescription,
  chatbotIntroMessage,
  chatApiUrl,
  chatLib,
}: ChatClientProps) {
  const chatRef = useRef<DeepChatElement | null>(null);

  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;

    el.request = {
      url: chatApiUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    };

    // Transform Deep Chat messages into the search_and_chat RAG request format:
    // { q: <latest user question>, lib, topk, messages: <prior conversation> }
    el.requestInterceptor = (details: InterceptorDetails) => {
      const allMessages = (details.body.messages || []).map((msg) => ({
        role: msg.role,
        content: msg.text ?? msg.content ?? "",
      }));

      const lastMessage = allMessages[allMessages.length - 1];
      const priorMessages = allMessages.slice(0, -1);

      details.body = {
        q: lastMessage?.content ?? "",
        lib: chatLib,
        topk: 5,
        messages: priorMessages,
      } as unknown as InterceptorDetails["body"];
      return details;
    };
  }, [chatApiUrl, chatLib]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header homepageName={homepageName} />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-4">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{homepageName} Chat</h1>
          <p className="text-muted-foreground">{chatbotDescription}</p>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm [&>deep-chat]:!w-full [&>deep-chat]:!block">
            <DeepChat
              ref={chatRef}
              style={{ borderRadius: "12px", height: "560px" }}
              introMessage={{ text: chatbotIntroMessage }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
