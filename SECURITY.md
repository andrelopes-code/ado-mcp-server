# Security

## Reporting a vulnerability

Open a [private security advisory](https://github.com/andrelopes-code/ado-mcp-server/security/advisories/new).
Do not open a public issue for anything exploitable.

## Threat model

This server hands an LLM a credential to a corporate Azure DevOps instance. The design assumes the
model can be steered by untrusted content (a work item description, a PR comment) and therefore
never relies on the model's judgement alone.

Layers, from outermost in:

1. **Read-only default.** `ADO_MODE=read` blocks every mutation. The mode is re-read live from `.env`
   on each write, so revoking write access takes effect on the next call without a restart. The
   `.env` file is outside the model's reach.
2. **Preview → confirm.** Every write tool returns a preview and applies nothing until it is called
   again with `confirm: true`.
3. **No destructive surface.** There is no delete, no abandon and no merge. `pr_update` deliberately
   omits `status`, because the same `PATCH` endpoint accepts `abandoned` and `completed`.
4. **Blast radius.** A single project, enforced server-side on every work item read; an optional
   repo allowlist enforced on every repo and PR tool.
5. **Audit trail.** Applied, blocked and failed writes are appended to `ado-mcp-audit.log`. A failure
   to write the audit trail never masks a mutation that already reached the server.

## Credential handling

- The PAT lives only in `.env`, which is git-ignored. It is never logged, never echoed into tool
  output, and never included in error messages (`toCleanError` reconstructs errors from status and
  message only, discarding the request config that carries the `Authorization` header).
- Grant the PAT the minimum scopes: Work Items (Read & Write), Code (Read & Write), Pull Request
  Threads (Read & Write). Never *Full access* or any *Manage* scope. Use a short expiry.
- Prefer `https` for `DEVOPS_URL`. Over `http`, the PAT travels in a Basic auth header in cleartext;
  the server warns on stderr at startup when it detects this.

## Operational guidance

Autonomous or auto-approved sessions have no human in the confirm loop. Set `ADO_MODE=read` before
any unattended run. In interactive sessions, leave the write tools outside "don't ask again" so that
Claude Code's own permission prompt remains the second gate.
