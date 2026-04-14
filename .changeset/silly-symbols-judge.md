---
'mastra': patch
---

Fixed server deploy failing in CI/headless mode when using only MASTRA_API_TOKEN with .mastra-project.json. API tokens cannot list organizations, so the config file fallback silently failed. Server deploy now requires MASTRA_ORG_ID and MASTRA_PROJECT_ID env vars (or --org/--project flags) in headless mode, matching studio deploy behavior.
