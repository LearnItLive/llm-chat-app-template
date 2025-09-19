/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
  /**
   * Binding for the Workers AI API.
   */
  AI: Ai;

  /**
   * Binding for static assets.
   */
  ASSETS: { fetch: (request: Request) => Promise<Response> };

  /**
   * Optional: Cloudflare AutoRAG instance name to enable retrieval.
   * Example: "my-autorag-instance"
   */
  AUTORAG_INSTANCE?: string;

  /**
   * Optional: Multitenancy/segment filter for AutoRAG (if configured in AutoRAG).
   */
  AUTORAG_TENANT?: string;

  /**
   * Optional: Override default model id for Workers AI.
   * Example: "@cf/openai/gpt-oss-120b"
   */
  MODEL_ID?: string;
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
