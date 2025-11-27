export const DEFAULT_CHAT_MODEL: string = "chat-model";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
};

export const chatModels: ChatModel[] = [
  {
    id: "chat-model",
    name: "GPT-5",
    description: "Advanced multimodal model with vision and text capabilities",
  },
  {
    id: "chat-model-reasoning",
    name: "GPT-5.1 Reasoning",
    description:
      "Uses advanced chain-of-thought reasoning for complex problems",
  },
  {
    id: "doc-chat",
    name: "Doc Chat Agent",
    description:
      "AI agent that searches and retrieves information from external documentation APIs",
  },
];
