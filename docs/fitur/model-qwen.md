# IMPLEMENTATION TASK — Integrate Qwen2.5-14B-Instruct with Full Tool Calling into AI Agent Mustika Ratu

## Role & Objective

You are a senior AI Engineer and Full-Stack TypeScript Engineer working on an existing AI Agent application.

**Repository:** https://github.com/wholelottarido/ai-agent-mustikaratu

Your task is to integrate **Qwen2.5-14B-Instruct**, running remotely on Google Colab NVIDIA T4, into the existing AI Agent Mustika Ratu application as an additional LLM provider.

The integration MUST support:

- Standard chat completions.
- Multi-turn conversations.
- OpenAI-compatible function/tool calling.
- Multiple tool calls when returned by the model.
- Tool execution through the existing VoltAgent/backend infrastructure.
- Tool result feedback to the model.
- Existing chat UI.
- Existing authentication and authorization.
- Department-specific tool permissions.
- Existing conversation memory and persistence where applicable.
- Robust error handling.

The goal is a fully integrated selectable model, **not a standalone demonstration endpoint**.

Implement the changes directly in the current working repository.

---

## 1. Verified Qwen Infrastructure

The Qwen inference server has already been implemented and tested successfully.

### Model Configuration

| Property | Value |
|---|---|
| Model | Qwen2.5-14B-Instruct |
| Model ID | `Qwen/Qwen2.5-14B-Instruct` |
| GPU | NVIDIA Tesla T4 |
| VRAM | Approximately 15 GB |
| Quantization | BitsAndBytes NF4 4-bit |
| Framework | Transformers / PyTorch |
| Inference API | FastAPI |
| Protocol | OpenAI-compatible Chat Completions subset |
| Exposure | Cloudflare Tunnel HTTPS |
| Authentication | Bearer API Key |

### Confirmed Working Capabilities

The following have already been tested on the inference server:

- Chat completions return HTTP 200.
- Function/tool schemas are accepted.
- `tool_choice="required"` produces a tool call.
- `tool_calls` are returned in OpenAI-compatible response format.
- `function.name` and JSON-string `function.arguments` are returned.
- `finish_reason="tool_calls"` is generated correctly.
- The backend can execute a dummy tool.
- Tool execution results can be sent back to Qwen.
- Qwen produces a final response from tool results.
- The public Cloudflare endpoint has been tested successfully.

**Important:** These tests confirm the current FastAPI implementation's basic tool calling functionality. They do not guarantee complete OpenAI API compatibility.

### Known Limitations

- Native token streaming is NOT supported.
- Requests with `stream: true` currently return HTTP 400.
- Only text messages are supported.
- Tool choices `auto`, `none`, and `required` are supported by the current experimental implementation.
- Forced function selection is prompt-based and validated after generation, not guaranteed by constrained decoding.
- Inference processes one active request at a time.
- The context limit configured in FastAPI is 2,048 input tokens.
- Maximum generation length is 768 tokens.
- More extensive JSON Schema validation is not implemented in the inference server.
- Google Colab is not guaranteed to remain online.
- Cloudflare Quick Tunnel URLs are temporary.

Account for these constraints in the integration. Do not assume unsupported features exist.

---

## 2. Environment Variables

Use the following environment configuration:

```env
# Qwen 14B Remote Provider
QWEN_ENABLED=true
QWEN_API_URL=https://YOUR-CLOUDFLARE-TUNNEL.trycloudflare.com/v1
QWEN_API_KEY=YOUR_PRIVATE_API_KEY
QWEN_MODEL=Qwen/Qwen2.5-14B-Instruct
QWEN_TIMEOUT_MS=180000
```

Requirements:

1. Read the environment variables only on the server.
2. Never expose the API key to client-side JavaScript.
3. Never use `NEXT_PUBLIC_` for the secret.
4. Never hardcode the Cloudflare endpoint.
5. Update `.env.example` with placeholders.
6. Preserve existing environment variables.
7. When Qwen is disabled or configuration is missing, existing providers must continue working normally.
8. Validate the URL and enforce HTTPS for remote inference.
9. Do not expose the real API key in logs, tests, commits, or documentation.

The Cloudflare URL must be replaceable without modifying application source code.

---

## 3. Mandatory Repository Analysis

Before making changes, inspect the current repository carefully.

Read and follow:

```text
AGENTS.md
CLAUDE.md
README.md
package.json
```

Inspect the following locations if present:

```text
voltagent/models.ts
voltagent/agents.ts
voltagent/
app/api/chat/route.ts
app/
lib/
db/
.env.example
```

Find the actual implementation of:

- LLM provider registry.
- AI model selection.
- VoltAgent initialization.
- Agent tool definitions.
- Tool execution.
- Chat API requests.
- AI SDK streaming responses.
- Chat history persistence.
- Conversation memory.
- RAG/knowledge base.
- Department access restrictions.
- Frontend model selector.
- Error handling.
- Existing provider fallback.

In particular, locate any usage of:

```typescript
createOpenAICompatible()
agent.streamText()
toUIMessageStreamResponse()
```

Do not assume these methods are present without checking.

Use the actual installed package versions when deciding on API compatibility.

### Analysis Deliverable

Briefly identify:

- Current LLM architecture.
- Existing provider implementation pattern.
- Chat request/response lifecycle.
- Tool execution lifecycle.
- Required files to modify.
- Compatibility issues with non-streaming Qwen.
- Recommended implementation approach.

Then proceed with implementation.

---

## 4. Register Qwen as an Additional Provider

Add Qwen as an optional LLM provider.

Suggested provider ID:

```typescript
"qwen-colab"
```

Display name:

```text
Qwen2.5 14B (Colab T4)
```

Capabilities:

```typescript
{
  chat: true,
  toolCalling: true,
  toolResults: true,
  streaming: false,
  experimental: true
}
```

Adapt the above to the repository's actual type definitions.

Requirements:

- Do not replace existing models.
- Do not rename existing provider IDs.
- Do not change the default model.
- Follow existing provider registry patterns.
- Preserve existing ordering where practical.
- Support selection by provider/model ID.
- Keep provider configuration centralized.
- Enable Qwen only when the configuration is valid.

Prefer extending the existing model registry over creating a parallel model selection system.

---

## 5. Implement the Qwen API Client

Create a reusable server-side client.

Suggested location:

```text
lib/llm/qwen-colab.ts
```

Use a different location if the existing repository already has an established provider structure.

### API Endpoint

```http
POST {QWEN_API_URL}/chat/completions
Authorization: Bearer {QWEN_API_KEY}
Content-Type: application/json
```

Since `QWEN_API_URL` already ends with `/v1`, avoid appending `/v1` twice.

### Request Format

```json
{
  "model": "Qwen/Qwen2.5-14B-Instruct",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Check inventory stock."
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_inventory_stock",
        "description": "Retrieve inventory stock.",
        "parameters": {
          "type": "object",
          "properties": {
            "product_name": {
              "type": "string"
            }
          },
          "required": ["product_name"]
        }
      }
    }
  ],
  "tool_choice": "auto",
  "temperature": 0,
  "max_tokens": 384,
  "stream": false
}
```

### Tool Call Response

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_example",
            "type": "function",
            "function": {
              "name": "get_inventory_stock",
              "arguments": "{\"product_name\":\"Bengkoang Whitening Body Lotion\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

### Client Requirements

- Use existing OpenAI-compatible SDK infrastructure if possible.
- Avoid installing unnecessary dependencies.
- Always send `stream: false`.
- Support system, user, assistant, and tool messages.
- Support `assistant.tool_calls`.
- Support `tool_call_id`.
- Preserve tool call IDs through the tool execution lifecycle.
- Support tools defined with JSON Schema.
- Parse and validate response structures.
- Handle null assistant content correctly.
- Handle malformed JSON arguments.
- Support request timeout.
- Avoid uncontrolled automatic retries.
- Do not log credentials or sensitive prompt content.
- Surface useful, sanitized errors.

---

## 6. Integrate with VoltAgent Tool Calling

This is the most important part of the implementation.

**Qwen must support the application's existing agent tools, not only text chat.**

First determine whether VoltAgent and the installed AI SDK can use the Qwen endpoint directly through an OpenAI-compatible model provider.

Prefer native integration if it supports non-streaming tool calls correctly.

Otherwise, implement an adapter that preserves the existing tool execution lifecycle.

### Required Tool Calling Flow

```text
User
  |
  v
Next.js Chat API
  |
  v
Authentication and Authorization
  |
  v
VoltAgent / Existing Agent System
  |
  v
Qwen API (messages + available tools)
  |
  v
Qwen returns tool_calls
  |
  v
Backend validates tool calls
  |
  v
Execute authorized tools
  |
  v
Send tool results back to Qwen
  |
  v
Qwen generates final answer
  |
  v
Existing Chat UI
```

### Mandatory Agent Behavior

1. Receive the user's message.
2. Determine the tools available to that authenticated user.
3. Include only authorized tools in the request.
4. Send the tool definitions to Qwen.
5. Parse the returned tool calls.
6. Match tool names against the server-side allowlist.
7. Validate arguments against the tool's actual schema.
8. Enforce department and user permissions again at execution time.
9. Execute tools through the existing tool executor.
10. Capture the tool results.
11. Add the assistant tool calls to conversation history.
12. Add tool results with matching `tool_call_id`.
13. Send the updated conversation back to Qwen.
14. Repeat only when another authorized tool call is required.
15. Return the final assistant response to the UI.

### Multi-Step Handling

Support multi-step tool calling with configurable safeguards:

```typescript
maxToolSteps = 5
maxToolCallsPerStep = 5
```

These are suggested values. Adapt to the existing agent framework and server limits.

If Qwen returns multiple tool calls:

- Process each call through the authorized tool executor.
- Preserve the original call IDs.
- Return a result message for each call.
- Avoid parallel execution of dependent or state-mutating operations unless explicitly safe.
- Prevent duplicate execution on retries.
- Stop when the maximum number of steps is reached.
- Return a clear error if the agent exceeds the configured limit.

Do not execute arbitrary functions using names or code produced by the model.

---

## 7. Maintain Existing Tools, RAG, and Database

The existing Mustika Ratu agent infrastructure must remain intact.

Preserve:

- Existing tools.
- Existing database integrations.
- Existing RAG integrations.
- Department-specific tool restrictions.
- Authentication.
- Conversation history.
- User memory.
- Tool execution logs.
- Existing prompt configuration.

Do not recreate database tools if they already exist.

Do not create an alternative unrestricted database connection for Qwen.

### Important Security Condition

Qwen is currently running on a remote Google Colab runtime.

Therefore, the application must not automatically transmit confidential Mustika Ratu data, employee records, salaries, HR information, production database records, or confidential RAG documents to Colab.

Implement an explicit external-provider data policy or restriction.

For development, use synthetic data.

If sensitive data is required for an actual workflow, block the operation until the deployment and data handling have been formally approved.

---

## 8. Handle Non-Streaming Qwen Responses

The current Qwen FastAPI server does not support native streaming.

The existing chat interface may rely on a streaming API such as:

```typescript
agent.streamText()
```

and:

```typescript
toUIMessageStreamResponse()
```

Investigate compatibility with the installed VoltAgent and AI SDK versions.

### Preferred Strategy

Use a native non-streaming agent generation method if it is supported.

If the frontend requires UI message streams, convert the final generated response into a correctly formatted UI message stream supported by the installed AI SDK.

Requirements:

- Do not send `stream: true` to Qwen.
- Do not fake token-by-token streaming with artificial delays.
- Preserve assistant message roles and IDs.
- Preserve tool execution state if the UI supports it.
- Preserve conversation persistence.
- Preserve existing UI functionality for other models.
- Show loading state while Qwen performs inference.
- Return the complete answer when inference finishes.

Do not replace the entire application's streaming implementation.

Only adapt the Qwen path.

---

## 9. Frontend Model Selector Integration

Add Qwen to the existing model selector.

Display:

```text
Qwen2.5 14B
Google Colab T4 · Experimental
```

Expected behavior:

- Qwen appears when enabled and configured.
- Qwen is hidden or disabled otherwise.
- The user can select Qwen as the active model.
- The existing UI design is preserved.
- Model selection uses existing state management.
- Chat messages use existing components.
- Tool execution indicators work if supported.
- A clear error is displayed when Colab is offline.
- Switching back to Claude or Ollama works.
- No unnecessary page refreshes.

Do not redesign the entire chat interface.

---

## 10. Reliability and Error Handling

Handle the following:

| Condition | Required behavior |
|---|---|
| HTTP 400 | Show request validation error |
| HTTP 401 | Report provider authentication failure |
| HTTP 502 | Report upstream/model failure |
| HTTP 503 | Report inference server busy |
| HTTP 504 / timeout | Report model timeout |
| Network unavailable | Report provider offline |
| Invalid tool JSON | Reject tool execution |
| Unknown tool name | Reject tool execution |
| Missing tool result | Stop and surface error |
| Max steps exceeded | Stop execution safely |
| Invalid configuration | Disable Qwen |
| Interrupted Colab session | Preserve application stability |

Never silently fall back to another provider if that changes the selected model or data processing destination.

Retries must not cause duplicate database mutations or transactions.

---

## 11. Health Check and Provider Availability

The inference server exposes:

```http
GET /health
```

Expected response:

```json
{
  "status": "online",
  "model": "Qwen/Qwen2.5-14B-Instruct",
  "tool_calling": true,
  "streaming": false
}
```

Implement a server-side health-check utility if useful.

Requirements:

- Short timeout, preferably 3–5 seconds.
- No unnecessary GPU inference.
- Avoid excessive polling.
- Do not expose secrets.
- Health status must not bypass authorization.
- Do not treat a healthy endpoint as proof that model generation will always succeed.

If the app has a provider status indicator, integrate Qwen with it.

---

## 12. Testing

Use mocks for automated testing. Do not require a live Colab session to run the test suite.

### Unit Tests

Test:

- Environment variable parsing.
- Provider enable/disable behavior.
- Model registry.
- API request serialization.
- Tool schema serialization.
- Tool argument validation.
- Tool call response parsing.
- Conversation history conversion.
- Timeout handling.
- Authentication errors.

### Integration Tests

Test:

- Normal chat response.
- One tool call.
- Multiple tool calls.
- Tool result feedback.
- Multi-step tool execution.
- Malformed tool arguments.
- Unknown tool.
- Unauthorized tool execution.
- Missing tool result.
- Model returning plain text instead of a tool call.
- Model unavailable.
- Maximum tool steps exceeded.

### Regression Tests

Verify:

- Claude provider remains functional.
- Ollama provider remains functional.
- Bifrost provider remains functional if present.
- Existing chat streaming remains functional.
- Existing RAG workflows remain functional.
- Existing department permissions are enforced.
- Database operations are not duplicated.
- Existing default model is unchanged.

### Validation Commands

Run the repository's actual validation scripts.

At minimum, if supported:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Run existing test commands where available.

Do not claim tests passed unless they were executed successfully.

---

## 13. Scope and Restrictions

You MUST:

- Follow existing repository architecture.
- Respect instructions in `AGENTS.md` and `CLAUDE.md`.
- Make focused, maintainable code changes.
- Keep existing providers functional.
- Reuse existing VoltAgent tools.
- Preserve existing authorization logic.
- Keep credentials server-side.
- Preserve database schemas unless absolutely necessary.
- Update documentation.
- Implement real code, not just pseudocode.

You MUST NOT:

- Rewrite the whole application.
- Replace VoltAgent without explicit justification.
- Remove Anthropic or Ollama integrations.
- Change the default provider without permission.
- Disable database security.
- Expose the Colab API key.
- Expose an unauthenticated public proxy.
- Automatically deploy the application.
- Automatically commit or push changes.
- Send production company data to the Colab endpoint during testing.

---

## 14. Acceptance Criteria

The implementation is complete when:

- [ ] Qwen is registered as an additional LLM provider.
- [ ] Qwen is selectable through the existing frontend.
- [ ] Normal chat works.
- [ ] Qwen tool calls are parsed correctly.
- [ ] Tools execute through existing authorized backend infrastructure.
- [ ] Tool execution results are returned to Qwen.
- [ ] Qwen generates a final answer after tool execution.
- [ ] Multi-step tool calling is supported with safeguards.
- [ ] Non-streaming generation is compatible with the chat UI.
- [ ] Existing providers remain functional.
- [ ] API keys never reach the browser.
- [ ] Sensitive company data is restricted from remote inference.
- [ ] Network errors are handled gracefully.
- [ ] TypeScript validation passes.
- [ ] Relevant tests pass.
- [ ] Documentation is updated.

If any criterion cannot be satisfied because of limitations in the existing code or installed dependencies, clearly report the blocker instead of claiming completion.

---

## 15. Final Report

After implementation, provide:

### Architecture
Explain the complete request flow from frontend to Qwen and back.

### Files Modified
List all created and modified files.

### Provider Integration
Explain how Qwen is registered and selected.

### Tool Calling
Explain how tools are supplied, authorized, executed, and returned to Qwen.

### Streaming Compatibility
Explain how non-streaming Qwen responses are handled by the existing UI.

### Security
Describe secrets management, authorization, and remote-data restrictions.

### Testing Results
Report tests actually executed, their results, and remaining failures.

### Known Limitations
Document remaining limitations and unfinished features.

### Manual Setup
Provide exact steps to configure `.env.local`, run the application, and test Qwen.

---

## Final Execution Instruction

**Implement this integration end-to-end in the current repository.**

Do not stop after architecture analysis.

The required final result is:

**Qwen2.5-14B-Instruct running on Google Colab T4 is available as an experimental LLM provider in AI Agent Mustika Ratu, with normal chat and secure, multi-step tool calling using the existing VoltAgent/backend tool infrastructure.**

Preserve existing provider behavior, authentication, department permissions, and database safety.

Analyze first, implement second, test third, and report the actual results.