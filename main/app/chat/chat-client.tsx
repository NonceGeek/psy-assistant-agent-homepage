"use client";

import { useEffect, useRef } from "react";
import { DeepChat } from "deep-chat-react";
import { Header } from "@/components/header";

type ChatClientProps = {
  homepageName: string;
  chatbotDescription: string;
  chatbotIntroMessage: string;
  chatApiUrl: string;
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

    // Map Deep Chat's { text } field to the API's { content } field
    el.requestInterceptor = (details: InterceptorDetails) => {
      const messages = (details.body.messages || []).map((msg) => ({
        role: msg.role,
        content: msg.text ?? msg.content ?? "",
      }));
      details.body = { messages };
      return details;
    };
  }, [chatApiUrl]);

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
