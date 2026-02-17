---
'@mastra/core': patch
---

Fixed a bug where tools returned by processors via `processInputStep` (e.g., `ToolSearchProcessor`) did not receive the original `requestContext`. Dynamically loaded tools now have access to the same `requestContext`, `mastra`, `memory`, `threadId`, and other execution context values that were passed to the agent's `stream()` or `generate()` call. Fixes #12967.

Previously, processor-returned tools bypassed `CoreToolBuilder` and were executed with an empty `RequestContext`, causing tools that depend on runtime context (auth tokens, tenant isolation, session data) to fail silently.

```typescript
// This now works correctly:
const requestContext = new RequestContext();
requestContext.set('authToken', 'Bearer abc123');

const result = await agent.generate(messages, { requestContext });
// Tools loaded via ToolSearchProcessor now see context.requestContext.get('authToken')
```
