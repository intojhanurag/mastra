---
'@mastra/core': patch
'@mastra/observability': patch
---

Fixed `cache_write_input_tokens` reporting only the last step's value instead of the sum across all steps in multi-step agent runs. This caused observability providers (Langfuse, Braintrust, Datadog) to display inaccurate cost calculations for Anthropic prompt caching.

**What changed:**

- Added `cachedWriteInputTokens` field to `LanguageModelUsage` type and threaded it through all token accumulation paths, following the existing pattern for `cachedInputTokens`
- Fixed `extractUsageMetrics` to prefer aggregated cache token values from `usage` over last-step-only values from `providerMetadata`, ensuring correct totals in multi-step runs
- Fixed `cacheRead` tokens also being overwritten by last-step `providerMetadata` instead of using the properly aggregated value
