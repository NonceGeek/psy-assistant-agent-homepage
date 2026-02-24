import { getReadmeConfig } from "@/lib/readme-config";
import { ChatClient } from "@/app/chat/chat-client";

export default function ChatPage() {
  const config = getReadmeConfig();

  return (
    <ChatClient
      homepageName={config.homepageName}
      chatbotDescription={config.chatbotDescription}
      chatbotIntroMessage={config.chatbotIntroMessage}
      chatApiUrl={config.chatApiUrl}
    />
  );
}
