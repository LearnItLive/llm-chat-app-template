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

// Model ID for Workers AI model (default). Allow override via env.MODEL_ID
// https://developers.cloudflare.com/workers-ai/models/
const DEFAULT_MODEL_ID = "@cf/openai/gpt-oss-120b";

// Default system prompt adapted for Lily and Learn It Live
const SYSTEM_PROMPT =
  "You are Lily, the Learn It Live virtual support assistant. Answer concisely and accurately about Learn It Live classes, schedules, recordings, membership, pricing, and account help. Use the provided Learn It Live resources and URLs when relevant. Always include fully qualified URLs (https://…) and the support email exactly as support@learnitlive.com when providing links. If you are not certain or the information is not present in the resources, respond with: Search our Help Articles @https://learnitlive.zendesk.com/hc/en-us/categories/360003490812-Instructor-Knowledge-Base  or contact our team support@learnitlive.com";

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

async function loadDirectives(env: Env): Promise<any | null> {
  try {
    const url = "https://assets.local/directives.json";
    const res = await env.ASSETS.fetch(new Request(url));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function buildPolicyFromDirectives(directives: any): string | null {
  if (!directives) return null;
  const parts: string[] = [];
  const push = (label: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.trim() === "") return;
    parts.push(`${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  };

  push("style", directives.style);
  push("tone", directives.tone);
  push("max_response_length", directives.max_response_length);
  push("introduction", directives.introduction);
  push("only_answer_what_is_asked", directives.only_answer_what_is_asked);
  push("answers_should_be_clear_and_concise", directives.answers_should_be_clear_and_concise);
  push("site_navigation_help", directives.site_navigation_help);
  push("class_navigation_help", directives.class_navigation_help);
  push("context_related_question_response", directives.context_related_question_response);
  push("content_related_question_response", directives.content_related_question_response);
  push("when_asking_about_class_info", directives.when_asking_about_class_info);
  push("default_fallback_response", directives.default_fallback_response);
  push("when_an_answer_is_unknown", directives.when_an_answer_is_unknown);
  push("language_support", directives.language_support);
  push("role_differentiation", directives.role_differentiation);
  push("escalation_logic", directives.escalation_logic);
  push("resource_referencing", directives.resource_referencing);
  push("trust_and_security", directives.trust_and_security);
  push("conversation_closure_behavior", directives.conversation_closure_behavior);
  push("attachment_handling", directives.attachment_handling);
  push("tone_escalation_sensitivity", directives.tone_escalation_sensitivity);
  push("link_policy", directives.link_policy);

  if (parts.length === 0) return null;
  return "Policy for Lily (apply strictly):\n" + parts.join("\n");
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

    // Load directives (policy) and prepend as a high-priority system message
    const directives = await loadDirectives(env);
    const policy = buildPolicyFromDirectives(directives);
    if (policy) {
      messages.unshift({ role: "system", content: policy });
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

    const modelId = (env.MODEL_ID || DEFAULT_MODEL_ID) as any;
    const response = await env.AI.run(
      modelId,
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
