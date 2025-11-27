import { openai } from "@ai-sdk/openai";
import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from "ai";
import { isTestEnvironment } from "../constants";

export const myProvider = isTestEnvironment
  ? (() => {
      const {
        artifactModel,
        chatModel,
        reasoningModel,
        titleModel,
      } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "chat-model-reasoning": reasoningModel,
          "title-model": titleModel,
          "artifact-model": artifactModel,
        },
      });
    })()
  : customProvider({
      languageModels: {
        "chat-model": openai.responses("gpt-5"),
        "chat-model-reasoning": wrapLanguageModel({
          model: openai.responses("gpt-5.1"),
          middleware: extractReasoningMiddleware({ tagName: "think" }),
        }),
        "title-model": openai.responses("gpt-5-mini"),
        "artifact-model": openai.responses("gpt-5-mini"),
      },
    });
