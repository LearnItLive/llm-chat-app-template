/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const suggestionsEl = document.getElementById("suggestions");

// Chat state
let chatHistory = [
  {
    role: "assistant",
    content:
      "Hi! I'm Lily, your Learn It Live virtual support assistant. How can I help you today?",
  },
];
let isProcessing = false;
let resourcesData = null;

// Linkify helper: escape HTML, then convert URLs and emails to anchors
function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkify(text) {
  const escaped = escapeHtml(text || "");
  // URLs with protocol, optional leading @ used in some prompts
  let html = escaped.replace(/@?(https?:\/\/[^\s<)]+)/g, (m, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  // www. URLs without protocol
  html = html.replace(/(^|[^\w@])(www\.[^\s<)]+)/g, (m, p1, host) => {
    return `${p1}<a href="https://${host}" target="_blank" rel="noopener noreferrer">${host}</a>`;
  });
  // Emails
  html = html.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, (m, email) => {
    return `<a href="mailto:${email}">${email}</a>`;
  });
  return html;
}

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

// Load and render suggestions from resources.json
(async function loadSuggestions() {
  if (!suggestionsEl) return;
  try {
    const res = await fetch("/resources.json");
    if (!res.ok) return;
    resourcesData = await res.json();
    if (!resourcesData || !Array.isArray(resourcesData.intents)) return;

    suggestionsEl.innerHTML = "";
    resourcesData.intents.forEach((intent) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = intent.label;
      const example = Array.isArray(intent.examples) && intent.examples[0];
      if (example) btn.dataset.example = example;
      btn.addEventListener("click", () => {
        const prompt = btn.dataset.example || btn.textContent;
        userInput.value = prompt;
        userInput.dispatchEvent(new Event("input"));
        sendMessage();
      });
      suggestionsEl.appendChild(btn);
    });
  } catch (e) {
    // Silently ignore suggestion load failures
    console.error("Failed to load suggestions", e);
  }
})();

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
  const message = userInput.value.trim();

  // Don't send empty messages
  if (message === "" || isProcessing) return;

  // Disable input while processing
  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  // Add user message to chat
  addMessageToChat("user", message);

  // Clear input
  userInput.value = "";
  userInput.style.height = "auto";

  // Show typing indicator
  typingIndicator.classList.add("visible");

  // Add message to history
  chatHistory.push({ role: "user", content: message });

  try {
    // Create new assistant response element
    const assistantMessageEl = document.createElement("div");
    assistantMessageEl.className = "message assistant-message";
    assistantMessageEl.innerHTML = "<p></p>";
    chatMessages.appendChild(assistantMessageEl);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Send request to API
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: chatHistory,
      }),
    });

    // Handle errors
    if (!response.ok) {
      throw new Error("Failed to get response");
    }

    // Process streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let responseText = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Decode chunk
      const chunk = decoder.decode(value, { stream: true });

      // Process SSE format
      const lines = chunk.split("\n");
      for (const line of lines) {
        try {
          const jsonData = JSON.parse(line);
          if (jsonData.response) {
            // Append new content to existing text and render with linkification
            responseText += jsonData.response;
            assistantMessageEl.querySelector("p").innerHTML = linkify(responseText);

            // Scroll to bottom
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        } catch (e) {
          console.error("Error parsing JSON:", e);
        }
      }
    }

    // Add completed response to chat history
    chatHistory.push({ role: "assistant", content: responseText });
  } catch (error) {
    console.error("Error:", error);
    addMessageToChat(
      "assistant",
      "Sorry, there was an error processing your request.",
    );
  } finally {
    // Hide typing indicator
    typingIndicator.classList.remove("visible");

    // Re-enable input
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

/**
 * Helper function to add message to chat
 */
function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  if (role === "assistant") {
    messageEl.innerHTML = `<p>${linkify(content)}</p>`;
  } else {
    const p = document.createElement("p");
    p.textContent = content;
    messageEl.appendChild(p);
  }
  chatMessages.appendChild(messageEl);

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
