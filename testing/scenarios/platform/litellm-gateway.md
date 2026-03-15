# Scenario Suite — LiteLLM Gateway
**Component:** LiteLLM Gateway (`compose/gateway.yml`, port 4000)
**Status:** Ready to test (gateway is live on Ubuntu-AI-Hub)

---

## Context

The LiteLLM Gateway is the routing and cost-management layer for all LLM requests. It routes between cloud providers and local Ollama models, enforces per-session budget caps via virtual keys, and records spend in PostgreSQL.

Real-world use cases this maps to:
- Cost-based routing (cheap model for simple tasks, powerful model for reasoning)
- Budget guardrails (hard caps, overage rejection)
- Fallback chains (cloud → Ollama on failure)
- Spend tracking and auditability

---

## Scenario 1 — Basic Request Routing
**Description:** A request via virtual key routes through the gateway and returns a response.
**Input:** `POST /chat/completions` with default virtual key and a simple prompt
**Pass Criteria:**
- Response received with 200 OK
- `x-litellm-model-id` header present in response
- Spend entry written to PostgreSQL (`litellm_spendlogs` table)

---

## Scenario 2 — Budget Cap Enforcement
**Description:** A virtual key with a low budget cap rejects requests once the cap is reached.
**Input:** Create a key with `max_budget=0.001`; make enough requests to exhaust it; attempt one more
**Pass Criteria:**
- Pre-cap requests succeed
- Post-cap request returns 429 or budget-exceeded error
- Error message is actionable (not generic 500)
- Spend in PostgreSQL matches expected amount

---

## Scenario 3 — Ollama Fallback Routing
**Description:** When a cloud model is unavailable (or Ollama is explicitly configured), requests route to local Ollama.
**Input:** Request using a model alias mapped to Ollama (e.g. `ollama/llama3.1:8b`)
**Pass Criteria:**
- Response returned from Ollama endpoint (confirm via `x-litellm-model-id`)
- Latency higher than cloud (expected) but response valid
- Spend recorded (may be $0 for local models)

---

## Scenario 4 — Spend Recorded in PostgreSQL
**Description:** Every request through the gateway writes a spend entry.
**Input:** Make 3 requests with different model aliases; query `litellm_spendlogs`
**Pass Criteria:**
- 3 rows visible in spend log with correct model, tokens, cost
- Virtual key ID matches key used
- Timestamps are within 5s of request time

---

## Scenario 5 — Invalid / Expired Key Rejected
**Description:** A request with a bad virtual key is rejected at the gateway.
**Input:** `POST /chat/completions` with `Authorization: Bearer sk-invalid123`
**Pass Criteria:**
- Returns 401 or 403 (not 200)
- Response body explains auth failure
- No spend entry written for the rejected request

---

## Scenario 6 — LiteLLM Key Setup Skill (Platform Skill)
**Description:** Run the `litellm-key-setup` skill with a realistic input; verify output is correct config.
**Skill:** `skills/platform/litellm-key-setup.md`
**Input Scenario A:** New virtual key for `chronicle` session, no budget cap
**Input Scenario B:** Virtual key with $5 budget cap for a short-lived task session
**Pass Criteria:**
- Output is valid LiteLLM key creation command or API call
- No internal names (no "Cole") in output
- Budget cap config syntax is correct
- Scenario B output includes budget enforcement configuration

---

## Status

| Scenario | Status | Report |
|----------|--------|--------|
| 1 — Basic routing | **PASS*** | Routes OK; Anthropic API key expired (GW-002) |
| 2 — Budget cap enforcement | **FAIL** | GW-001: cap never enforced on $0 Ollama models |
| 3 — Ollama fallback | **PASS** | llama3.2:3b routed and responded correctly |
| 4 — Spend in PostgreSQL | **PASS** | Entries present with correct fields |
| 5 — Invalid key rejected | **PASS** | 401 with actionable error |
| 6 — Key setup skill | **PASS** | Correct, professional; add Ollama budget note |
