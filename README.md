# ado-mcp-server

[![CI](https://github.com/andrelopes-code/ado-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/andrelopes-code/ado-mcp-server/actions/workflows/ci.yml)

MCP server local que dá ao Claude Code acesso **controlado e seguro-por-padrão** ao Azure DevOps Server on-premise (work items, pull requests, repos). Ver `DESIGN.md` para o modelo de arquitetura e `SECURITY.md` para o modelo de ameaças.

## Instalação

```bash
git clone https://github.com/andrelopes-code/ado-mcp-server.git ~/dev/ado-mcp-server
cd ~/dev/ado-mcp-server
npm install
cp .env.example .env
# edite o .env (ver abaixo)
```

Requer Node 20 ou superior.

## PAT de privilégio mínimo (obrigatório)

No Azure DevOps: **User settings → Personal access tokens → New Token**. Escopos:

- **Work Items** — Read & Write
- **Code** — Read & Write
- **Pull Request Threads** — Read & Write

**Nunca** marque *Full access* nem escopos *Manage*. Use **expiração curta**. Cole em `DEVOPS_PAT` no `.env`.

## `.env`

| Var | Papel |
|---|---|
| `DEVOPS_URL` | base da coleção, ex. `https://servidor/colecao`. **Prefira `https`** — sobre `http` o PAT viaja em Basic auth sem TLS, e o server avisa no stderr ao subir |
| `DEVOPS_PROJECT` | projeto único |
| `DEVOPS_PAT` | o PAT mínimo acima |
| `API_VERSION` | versão da REST API do DevOps on-prem (default `6.0`) |
| `ADO_MODE` | `read` (default, só lê) \| `write` (habilita mutações). Relido **ao vivo** do `.env` a cada escrita — trocar vale na próxima chamada, sem reiniciar o server |
| `ADO_REPO_ALLOWLIST` | repos permitidos, separados por vírgula (vazio = todos) |
| `ADO_PROTECTED_BRANCHES` | branches sob sinalização reforçada em `pr_create`/`pr_update` (default `main,master,develop,release/*`) |
| `ADO_AUDIT_LOG` | caminho da trilha de auditoria (relativo = a partir do diretório do server; default `./ado-mcp-audit.log`) |
| `ADO_TIMEOUT_MS` | timeout das chamadas HTTP em ms (default `30000`) |

## Registrar no Claude Code (user scope)

```bash
claude mcp add --scope user ado -- node ~/dev/ado-mcp-server/src/index.js
```

Verifique: `claude mcp list` deve mostrar `ado`.

## Segurança — como não destruir o DevOps

- **Read-only por padrão.** Mutações só com `ADO_MODE=write` no `.env` (fora do alcance do Claude).
- **Preview → confirm.** Toda escrita retorna um preview e só executa com `confirm: true`.
- **Nada destrutivo existe.** Sem delete/abandon/**merge**. O merge de PR é sempre manual no web UI.
- **Blast radius.** Projeto único, imposto no servidor em toda leitura de work item; allowlist opcional de repos.
- **Auditoria.** Toda tentativa de escrita — aplicada, bloqueada ou falhada — vai para `ado-mcp-audit.log`, que rotaciona ao passar de 5 MB.

## Modo de escrita e permissões (recomendado)

O gate de aprovação por-ação numa sessão interativa é o **prompt de permissão do próprio Claude Code** — ele pergunta antes de cada tool. Postura recomendada:

- Deixe **`ADO_MODE=write`** fixo (sem editar arquivo no dia a dia).
- **Não** marque *"don't ask again"* nas tools de **escrita** (`wit_create/update/comment`, `pr_create/update/add_reviewers/comment`) — deixe-as perguntando. As de leitura pode liberar à vontade.
- Assim cada escrita para 2×: o preview do server + o seu "Yes" no Claude Code. Nada é enviado sem sua aprovação.

`ADO_MODE=read` é o **backstop para sessões autônomas / auto-aprovadas** (sem humano no loop). Como o modo é relido ao vivo do `.env`, virar para `read` antes de um run desatendido vale na próxima chamada, sem reiniciar.

## Uso pelo Claude

Leitura (sempre): `wit_query`, `wit_get`, `pr_list`, `pr_get`, `repo_list`, `branch_list`, `commit_list`.
Escrita (write + confirm): `wit_create`, `wit_update`, `wit_comment`, `pr_create`, `pr_update`, `pr_add_reviewers`, `pr_comment`.

`pr_update` edita título, descrição, rascunho e branch de destino. **Status fica de fora de propósito**: o mesmo `PATCH` da API aceita `abandoned` (fecha) e `completed` (mergeia), e nenhum dos dois deve ser alcançável por uma tool de edição.

Fluxo típico de escrita: o Claude chama a tool sem `confirm` → você lê o preview → ele repete com `confirm: true`.

> Reviewers em `pr_create`/`pr_add_reviewers` usam **ids (GUID)** de identidade, não nomes.

## Desenvolvimento

```bash
npm test     # vitest
npm run lint # eslint
```

`docs/PLAN.md` guarda o plano de construção original.

Uma nota para quem for mexer nas dependências: **stdout é o canal do protocolo MCP stdio**. Qualquer biblioteca que escreva em stdout no import corrompe o transporte — é por isso que o `dotenv` é carregado com `quiet: true`. Use `console.error` para qualquer diagnóstico.

## Licença

MIT — ver `LICENSE`.
