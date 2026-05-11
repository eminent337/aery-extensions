# Stitch Extension Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Google Stitch as an installable Aery marketplace extension.

**Architecture:** Add a standalone extension under `packs/design/stitch.ts` that wraps `@_davideast/stitch-mcp` through `npx -y`. The extension exposes Aery tools and a `/stitch` command while leaving authentication to Stitch MCP via API key, system gcloud, or its guided setup.

**Tech Stack:** Aery TypeScript extension API, `typebox`, Node `child_process.execFile`, `@_davideast/stitch-mcp` CLI.

---

### Task 1: Stitch Extension

**Files:**
- Create: `packs/design/stitch.ts`
- Create: `packs/design/stitch.test.ts`
- Modify: `registry.json`
- Modify: `README.md`

- [ ] Write tests for auth status and CLI argument construction.
- [ ] Implement `packs/design/stitch.ts` with `/stitch status`, `/stitch auth`, `/stitch projects`, `/stitch screens`, and Stitch tools.
- [ ] Add `stitch` to `registry.json` as a standalone installable extension.
- [ ] Document install/setup in `README.md`.
- [ ] Run `npx tsx --test packs/design/stitch.test.ts`.
- [ ] Commit and push.
