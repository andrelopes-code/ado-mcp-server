# ado-mcp-server

MCP server local que dá ao Claude Code acesso **controlado e seguro-por-padrão** ao Azure DevOps Server on-premise (work items, pull requests, repos). Ver `DESIGN.md` para o modelo de segurança.

## Instalação

```bash
cd ~/dev/ado-mcp-server
npm install
cp .env.example .env
# edite o .env (ver abaixo)
```

## PAT de privilégio mínimo (obrigatório)

No Azure DevOps: **User settings → Personal access tokens → New Token**. Escopos:

- **Work Items** — Read & Write
- **Code** — Read & Write
- **Pull Request Threads** — Read & Write

**Nunca** marque *Full access* nem escopos *Manage*. Use **expiração curta**. Cole em `DEVOPS_PAT` no `.env`.

## `.env`

| Var | Papel |
|---|---|
| `DEVOPS_URL` | base da coleção, ex. `http://servidor/colecao` |
| `DEVOPS_PROJECT` | projeto único |
| `DEVOPS_PAT` | o PAT mínimo acima |
| `API_VERSION` | versão da REST API do DevOps on-prem (default `6.0`) |
| `ADO_MODE` | `read` (default, só lê) \| `write` (habilita mutações) |
| `ADO_REPO_ALLOWLIST` | repos permitidos, separados por vírgula (vazio = todos) |
| `ADO_PROTECTED_BRANCHES` | branches sob sinalização reforçada em `pr_create` (default `main,master,develop,release/*`) |
| `ADO_AUDIT_LOG` | caminho do log de auditoria de escritas (default `./ado-mcp-audit.log`) |

## Registrar no Claude Code (user scope)

```bash
claude mcp add --scope user ado -- node /home/dreco/dev/ado-mcp-server/src/index.js
```

Verifique: `claude mcp list` deve mostrar `ado`.

## Segurança — como não destruir o DevOps

- **Read-only por padrão.** Mutações só com `ADO_MODE=write` no `.env` (fora do alcance do Claude).
- **Preview → confirm.** Toda escrita retorna um preview e só executa com `confirm: true`.
- **Nada destrutivo existe.** Sem delete/abandon/**merge**. O merge de PR é sempre manual no web UI.
- **Blast radius.** Projeto único; allowlist opcional de repos.
- **Auditoria.** Toda escrita executada vai para `ado-mcp-audit.log`.

## Uso pelo Claude

Leitura (sempre): `wit_query`, `wit_get`, `pr_list`, `pr_get`, `repo_list`, `branch_list`, `commit_list`.
Escrita (write + confirm): `wit_create`, `wit_update`, `wit_comment`, `pr_create`, `pr_add_reviewers`, `pr_comment`.

Fluxo típico de escrita: o Claude chama a tool sem `confirm` → você lê o preview → ele repete com `confirm: true`.

> Reviewers em `pr_create`/`pr_add_reviewers` usam **ids (GUID)** de identidade, não nomes.
