/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Default system prompt adapted for Lily and Learn It Live
const SYSTEM_PROMPT =
  "You are Lily, the Learn It Live virtual support assistant. Answer concisely and accurately about Learn It Live classes, schedules, recordings, membership, pricing, and account help. Use the provided Learn It Live resources and URLs when relevant. If unsure or the information is not in the resources, say you are not certain and suggest visiting the Help page.";

function buildContextFromResources(
  userQuery: string,
  resources: any,
  maxFaq: number = 5,
  maxAnswerChars: number = 400,
): string | null {
  if (!resources || typeof resources !== "object") return null;
  const brand = resources.brand?.name || "Lily Virtual Support";
  const faqs: Array<{ q: string; a: string; url?: string }> = Array.isArray(resources.faq)
    ? resources.faq
    : [];

  const q = (userQuery || "").toLowerCase();
  let candidates = faqs;
  if (q) {
    candidates = faqs.filter((f) => {
      const qq = (f.q || "").toLowerCase();
      const aa = (f.a || "").toLowerCase();
      return q && (qq.includes(q) || aa.includes(q));
    });
  }
  if (candidates.length === 0) candidates = faqs;
  const selected = candidates.slice(0, maxFaq).map((f) => ({
    q: f.q,
    a: f.a.length > maxAnswerChars ? f.a.slice(0, maxAnswerChars) + "…" : f.a,
    url: f.url,
  }));

  return JSON.stringify({ brand, selected_faq: selected });
}

async function loadResources(env: Env): Promise<any | null> {
  try {
    // Fetch static resources via the Assets binding per Cloudflare docs
    // https://developers.cloudflare.com/workers/static-assets/binding/
    const assetsUrl = "https://assets.local/resources.json";
    const res = await env.ASSETS.fetch(new Request(assetsUrl));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle static assets (frontend)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // API Routes
    if (url.pathname === "/api/chat") {
      // Handle POST requests for chat
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    // Handle 404 for unmatched routes
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // Parse JSON request body
    const { messages = [] } = (await request.json()) as {
      messages: ChatMessage[];
    };

    // Ensure Lily's system prompt is present
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    // Load Learn It Live resources and provide compact, relevant system context
    const resources = await loadResources(env);
    const latestUser = messages.filter((m) => m.role === "user").slice(-1)[0]?.content ?? "";
    if (resources) {
      const compact = buildContextFromResources(latestUser, resources);
      if (compact) {
        messages.unshift({
          role: "system",
          content: "Learn It Live resources (selected): " + compact,
        });
      }
    }

    // Optional: Query Cloudflare AutoRAG for retrieval-augmented context
    // https://developers.cloudflare.com/autorag/
    if (env.AUTORAG_INSTANCE && typeof (env.AI as any).autorag === "function") {
      try {
        const ar = (env.AI as any).autorag(env.AUTORAG_INSTANCE);
        // Prefer aiSearch to get synthesized answer + citations; fall back to search if needed
        const queryText = latestUser;
        if (queryText) {
          const opts: any = { query: queryText };
          if (env.AUTORAG_TENANT) {
            opts.filter = { tenant: env.AUTORAG_TENANT };
          }
          let ragResult: any = null;
          if (typeof ar.aiSearch === "function") {
            ragResult = await ar.aiSearch(opts);
          } else if (typeof ar.search === "function") {
            ragResult = await ar.search(opts);
          }
          if (ragResult) {
            messages.unshift({
              role: "system",
              content:
                "AutoRAG context: " + JSON.stringify(ragResult),
            });
          }
        }
      } catch (e) {
        // Silent fallback if AutoRAG is unavailable/misconfigured
      }
    }

    const response = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_tokens: 1024,
      },
      {
        returnRawResponse: true,
        // Uncomment to use AI Gateway
        // gateway: {
        //   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
        //   skipCache: false,      // Set to true to bypass cache
        //   cacheTtl: 3600,        // Cache time-to-live in seconds
        // },
      },
    );

    // Return streaming response
    return response;
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}
