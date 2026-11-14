import type { ChatMessage, ModelClient, ToolSpec } from "../../application/ports.js";

export interface ApimChatOptions {
  /** Full chat-completions URL exposed through APIM. */
  endpoint: string;
  subscriptionKey?: string;
  /** Returns a bearer token, e.g. for the Cognitive Services audience. */
  bearerToken?: () => Promise<string>;
  fetch?: typeof fetch;
}

export class LlmRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`model request failed with HTTP ${status}`);
    this.name = "LlmRequestError";
  }
}

/** OpenAI-compatible chat client behind APIM. Auth is a subscription key, a bearer token, or both. */
export class ApimChatClient implements ModelClient {
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: ApimChatOptions) {
    this.doFetch = options.fetch ?? fetch;
  }

  async complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatMessage> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.subscriptionKey) headers["Ocp-Apim-Subscription-Key"] = this.options.subscriptionKey;
    if (this.options.bearerToken) headers.authorization = `Bearer ${await this.options.bearerToken()}`;

    const body: Record<string, unknown> = { messages, temperature: 0 };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await this.doFetch(this.options.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) throw new LlmRequestError(response.status, text.slice(0, 500));

    const message = (JSON.parse(text) as { choices?: { message?: ChatMessage }[] }).choices?.[0]?.message;
    if (!message) throw new Error("model response had no message");
    return message;
  }
}
