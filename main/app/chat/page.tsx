import { getReadmeConfig } from "@/lib/readme-config";
import { ChatClient } from "@/app/chat/chat-client";

export default function ChatPage() {
  const config = getReadmeConfig();
  // DO NOT REMOVE THIS CONSOLE.LOG
  console.log("config", config);
  return (
    <ChatClient
      homepageName={config.homepageName}
      chatbotDescription={config.chatbotDescription}
      chatbotIntroMessage={config.chatbotIntroMessage}
      chatApiUrl={config.chatApiUrl}
      chatLib={config.chatLib}
      searchMode={config.searchMode}
      prompt1={config.prompts?.prompt1}
    />
  );
}
