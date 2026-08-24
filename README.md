# ado-mcp-server

[![CI](https://github.com/andrelopes-code/ado-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/andrelopes-code/ado-mcp-server/actions/workflows/ci.yml)

MCP server local que dá ao Claude Code acesso **controlado e seguro-por-padrão** ao Azure DevOps Server on-premise: gestão completa de work items (epic, feature, PBI, task, bug — campos, hierarquia, links, discussão, anexos), pull requests e repos. Ver `DESIGN.md` para o modelo de arquitetura e `SECURITY.md` para o modelo de ameaças.

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
| `DEVOPS_PROJECT` | projeto padrão de toda tool |
| `DEVOPS_PAT` | o PAT mínimo acima |
| `API_VERSION` | versão da REST API do DevOps on-prem (default `6.0`) |
| `ADO_MODE` | `read` (default, só lê) \| `write` (habilita mutações). Relido **ao vivo** do `.env` a cada escrita — trocar vale na próxima chamada, sem reiniciar o server |
| `ADO_PROJECT_ALLOWLIST` | outros projetos alcançáveis pelo parâmetro `project` das tools, separados por vírgula (vazio = só `DEVOPS_PROJECT`; `*` = todos da coleção) |
| `ADO_WIT_TYPE_ALLOWLIST` | tipos que `wit_create` pode criar (vazio = todos os do processo) |
| `ADO_WIT_AREA_ALLOWLIST` | area paths onde a escrita de work item é permitida, por prefixo (vazio = todo o projeto) |
| `ADO_ATTACH_MAX_MB` | limite de tamanho por anexo em `wit_attach` (default `25`) |
| `ADO_ATTACH_EXT_ALLOWLIST` | extensões de anexo permitidas (vazio = todas) |
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
- **Preview → confirm.** Toda escrita retorna um preview e só executa com `confirm: true`. Em `wit_create`, `wit_update` e `wit_link` o preview é validado pelo próprio ADO (`validateOnly=true`): regra de processo violada aparece antes do confirm, sem persistir nada.
- **Nada destrutivo existe.** Sem delete/abandon/**merge**. O merge de PR é sempre manual no web UI.
- **Blast radius.** Um projeto padrão, imposto no servidor em toda leitura de work item e em todo alvo de link; outros projetos só com `ADO_PROJECT_ALLOWLIST`. Allowlists opcionais de repo, tipo de work item, area path e extensão de anexo.
- **Concorrência.** `expectedRev` emite um `test /rev`: se o card mudou entre a leitura e a escrita, o patch inteiro falha em vez de sobrescrever.
- **Auditoria.** Toda tentativa de escrita — aplicada, bloqueada ou falhada — vai para `ado-mcp-audit.log`, que rotaciona ao passar de 5 MB.

## Modo de escrita e permissões (recomendado)

O gate de aprovação por-ação numa sessão interativa é o **prompt de permissão do próprio Claude Code** — ele pergunta antes de cada tool. Postura recomendada:

- Deixe **`ADO_MODE=write`** fixo (sem editar arquivo no dia a dia).
- **Não** marque *"don't ask again"* nas tools de **escrita** (`wit_create/update/link/unlink/comment/attach`, `pr_create/update/add_reviewers/comment`) — deixe-as perguntando. As de leitura pode liberar à vontade.
- Assim cada escrita para 2×: o preview do server + o seu "Yes" no Claude Code. Nada é enviado sem sua aprovação.

`ADO_MODE=read` é o **backstop para sessões autônomas / auto-aprovadas** (sem humano no loop). Como o modo é relido ao vivo do `.env`, virar para `read` antes de um run desatendido vale na próxima chamada, sem reiniciar.

## Uso pelo Claude

Leitura (sempre): `wit_query`, `wit_get`, `wit_tree`, `wit_comments`, `wit_history`, `wit_meta`, `pr_list`, `pr_get`, `repo_list`, `branch_list`, `commit_list`, `project_list`.
Escrita (write + confirm): `wit_create`, `wit_update`, `wit_link`, `wit_unlink`, `wit_comment`, `wit_attach`, `pr_create`, `pr_update`, `pr_add_reviewers`, `pr_comment`.

### Work items

| Tool | Para quê |
|---|---|
| `wit_query` | WIQL, preset (`my_active`/`my_recent`) ou query salva; aceita `fields` e `expand` |
| `wit_get` | detalha ids com os campos pedidos (`System.Description`, critérios de aceite) e, com `expand: relations`, pai, filhos, PRs e anexos |
| `wit_tree` | WIQL `FROM WorkItemLinks` devolvida como árvore epic → feature → item |
| `wit_comments` | discussão com autor e data (API de comments; cai para `System.History` onde o preview não existe) |
| `wit_history` | revisões campo a campo, com valor anterior e novo |
| `wit_meta` | `types`, `states`, `fields`, `categories`, `relationtypes`, `areas`, `iterations`, `tags` do processo |
| `wit_create` | cria qualquer tipo com campos, tags, área, iteração, pai e links |
| `wit_update` | campos, estado e tags de um id ou de um lote (`ids`, via `/wit/$batch`) |
| `wit_link` / `wit_unlink` | hierarquia, `related`, predecessor/sucessor, duplicado, hyperlink e artefato de código (`pull_request`, `commit`, `branch`) |
| `wit_comment` | publica na discussão |
| `wit_attach` | sobe um arquivo local e o anexa ao card |

`wit_meta` é o caminho para descobrir tipos, estados e campos válidos antes de escrever — o processo do projeto define quais existem.

### Pull requests

`pr_update` edita título, descrição, rascunho e branch de destino. **Status fica de fora de propósito**: o mesmo `PATCH` da API aceita `abandoned` (fecha) e `completed` (mergeia), e nenhum dos dois deve ser alcançável por uma tool de edição.

> Reviewers em `pr_create`/`pr_add_reviewers` usam **ids (GUID)** de identidade, não nomes.

### Trocar de projeto sem subir outro server

Toda tool aceita `project` opcional. Sem ele vale `DEVOPS_PROJECT`. Qualquer outro nome precisa estar em `ADO_PROJECT_ALLOWLIST` (`*` libera a coleção inteira), senão a chamada falha antes de qualquer request. `project_list` mostra os projetos da coleção e quais estão liberados. O projeto efetivo entra no preview e na linha de auditoria de toda escrita.

Fluxo típico de escrita: o Claude chama a tool sem `confirm` → você lê o preview → ele repete com `confirm: true`.

## Desenvolvimento

```bash
npm test     # vitest
npm run lint # eslint
```

`docs/PLAN.md` guarda o plano de construção original.

Uma nota para quem for mexer nas dependências: **stdout é o canal do protocolo MCP stdio**. Qualquer biblioteca que escreva em stdout no import corrompe o transporte — é por isso que o `dotenv` é carregado com `quiet: true`. Use `console.error` para qualquer diagnóstico.

## Licença

MIT — ver `LICENSE`.
