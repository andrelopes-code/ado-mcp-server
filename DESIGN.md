# ado-mcp-server — Design

**Data:** 2026-07-16
**Autor:** André Lopes
**Status:** implementado; atualizado na extensão de work items (gestão completa) e no override de projeto

Servidor MCP local que dá ao Claude Code acesso controlado ao **Azure DevOps Server on-premise** via REST API, priorizando segurança: o Claude não pode destruir nada porque as operações destrutivas **não existem no código**.

---

## 1. Contexto e motivação

O Azure DevOps Server on-premise expõe a mesma REST API do serviço em nuvem (`{coleção}/_apis/...`), mas o `az devops` CLI e os MCPs oficiais não suportam on-prem de forma confiável. A REST API, porém, funciona: criar work items com PAT via Basic auth contra uma coleção on-prem é comportamento comprovado.

Este projeto é o "MCP confiável de on-prem" que falta: um wrapper fino, tipado e **seguro-por-padrão** sobre essa REST API.

## 2. Objetivos

- Dar ao Claude Code tools nativas para o fluxo diário: **work items (cards), pull requests, repos/branches**.
- Cobrir a gestão de work item de ponta a ponta: hierarquia (epic → feature → item), links, discussão, campos ricos, tags, área/iteração, anexos e metadados do processo.
- Ser **robusto** e **impossível de causar estrago irreversível** no DevOps real.
- Rodar **isolado** de qualquer repositório de trabalho (projeto próprio, `.env` próprio, git próprio).
- Uso **pessoal**, local, sob a conta do próprio desenvolvedor.

## 3. Não-objetivos (YAGNI)

- Não é serviço hospedado nem multiusuário (pode virar depois — ver §10).
- Sem builds/pipelines nesta versão.
- Sem operações destrutivas: **nada de** deletar work item, deletar/abandonar branch, deletar repo, abandonar PR.
- **Sem `pr_complete`/merge** — o merge é ação humana no web UI. Decisão explícita: é a única operação verdadeiramente irreversível, então fica fora da superfície.

## 4. Arquitetura

Servidor MCP stdio em Node. Separação **core (REST puro) / tools (adaptador MCP)** — o core não conhece MCP e é o ponto de reúso para um futuro CLI ou serviço de time.

```
~/dev/ado-mcp-server/            ← isolado dos repositórios de trabalho, git próprio
├── .env                          (gitignored) segredos + modo
├── .env.example                  template documentado
├── .gitignore                    ignora .env, node_modules, *.log
├── eslint.config.js              flat config (eslint 9)
├── package.json
├── LICENSE                       MIT
├── README.md                     setup + geração do PAT mínimo + registro no Claude
├── SECURITY.md                   modelo de ameaças + como reportar vulnerabilidade
├── DESIGN.md                     este documento
├── ado-mcp-audit.log             (gitignored) trilha de toda tentativa de escrita
├── docs/PLAN.md                  plano de construção original
├── .github/workflows/ci.yml      lint + testes + npm audit em Node 20 e 22
├── test/                         vitest, um arquivo por módulo
└── src/
    ├── index.js                  bootstrap MCP (StdioServerTransport), registra tools
    ├── config.js                 carrega/valida .env; falha barulhenta se faltar segredo
    ├── audit.js                   append no audit log (timestamp, tool, params, outcome) + rotação
    ├── core/                     REST puro — ZERO conhecimento de MCP, reusável
    │   ├── client.js             axios: base URL, Basic-PAT, api-version, timeout, mapeamento de erro
    │   ├── workitems.js          query/tree/get/create/update + escopo de projeto, tags, rev test, $batch
    │   ├── witlinks.js           relações, artifact links (vstfs), anexos
    │   ├── witdiscussion.js      comentários (API de comments + fallback System.History) e revisões
    │   ├── witmeta.js            tipos, estados, campos, categorias, relation types, áreas, iterações, tags
    │   ├── projects.js           lista projetos da coleção (escopo organizacional)
    │   ├── pullrequests.js       list/get/create/update/add_reviewers/comment
    │   └── repos.js              list/branches/commits
    └── tools/                    adaptadores MCP finos: schema zod → chama core → aplica guardas
        ├── guards.js             allowlist, branch protegida, modo/confirm, auditoria
        ├── workitems.tools.js
        ├── pullrequests.tools.js
        ├── repos.tools.js
        └── projects.tools.js
```

Fluxo de uma chamada:
`Claude → tool MCP → guarda (modo/confirm/branch/projeto) → core → REST ADO → resposta mapeada → (se escrita) audit log`

## 5. Modelo de segurança — 7 camadas

Defesa em profundidade. A garantia mais forte não é comportamento do Claude, é a ferramenta ser **incapaz** de causar o estrago.

### Camada 1 — PAT de privilégio mínimo (teto no nível do Azure)
Única barreira independente do comportamento do agente. O README exige um PAT **dedicado** com escopos mínimos:
- **Work Items** — Read & Write
- **Code** — Read & Write
- **Pull Request Threads** — Read & Write

**Nunca** Full access, **nunca** escopos *Manage*, expiração **curta**. Assim o pior caso é limitado pelo próprio Azure.

### Camada 2 — Operações destrutivas não são implementadas
Não existem tools de `delete`/`abandon`/`complete`/`merge`/`remove`. Se não há tool, o Claude não invoca. Superfície = whitelist explícita, não "tudo que a API permite". Deletar/abandonar/mergear → web UI (ação humana).

### Camada 3 — Read-only por padrão; escrita é opt-in fora do alcance do Claude
`.env` nasce com `ADO_MODE=read`. Nesse modo, **toda** tool de escrita recusa com mensagem clara. O humano vira `ADO_MODE=write` só enquanto acompanha ativamente uma tarefa. Servidor default = só lê.

O `ADO_MODE` é relido **ao vivo do `.env` a cada tentativa de escrita** (`currentMode` em `config.js`), então virar o modo vale na próxima chamada — sem reiniciar o processo. Se o `.env` estiver ilegível em runtime, mantém a postura do boot (não derruba a escrita por um erro de leitura). O switch continua num arquivo, fora das tools do Claude.

Na prática, o gate de aprovação por-ação numa sessão interativa é o **prompt de permissão do próprio Claude Code** (pergunta antes de cada tool). `ADO_MODE` é o backstop para sessões autônomas/auto-aprovadas, onde não há humano no loop.

### Camada 4 — Preview → confirm em toda mutação
Toda tool de escrita exige `confirm: true`. Sem isso, **não executa**: retorna o preview exato — método, URL, corpo/JSON-patch que enviaria, e os valores atuais dos campos que mudariam. Toda escrita é two-phase e visível; o prompt de permissão do Claude Code dispara na chamada com `confirm`.

Em `wit_create`, `wit_update` e `wit_link` o preview também é submetido ao ADO com `validateOnly=true`: o servidor aplica as regras do processo e devolve o veredito **sem persistir**. Campo obrigatório ausente, transição de estado inválida ou valor fora de `allowedValues` aparecem no preview, não depois do `confirm`.

`expectedRev` cobre o outro lado: um `test /rev` no início do patch faz a escrita inteira falhar se o item mudou entre a leitura e a confirmação.

### Camada 5 — Blast radius fixado
- `DEVOPS_PROJECT` é o projeto padrão e o único alcançável por default; o escopo é imposto na leitura de work item e em todo alvo de link.
- Trocar de projeto exige o parâmetro `project` **e** o nome em `ADO_PROJECT_ALLOWLIST`. Fora dela, a chamada falha antes de qualquer request. `*` libera a coleção — escolha explícita de quem edita o `.env`, nunca default.
- Allowlists opcionais de repo (`ADO_REPO_ALLOWLIST`), tipo de work item (`ADO_WIT_TYPE_ALLOWLIST`), area path (`ADO_WIT_AREA_ALLOWLIST`) e extensão/tamanho de anexo.
- **Sem bulk dirigido por query.** Não existe "atualize tudo que a WIQL retornar": `wit_update` aceita uma lista **explícita** de ids, e o preview mostra o valor atual de cada um antes do `confirm`. O lote existe para mover um sprint inteiro sem N confirmações; o conjunto continua sendo escolhido por quem chama, não por um filtro do servidor.
- Campos HTML (`System.Description`, critérios de aceite) são recusados quando contêm `script`, `iframe`, handler inline ou `javascript:` — o card é renderizado no navegador de todo mundo.

### Camada 6 — `pr_create` sem nenhuma opção destrutiva embutida
`pr_create` **nunca** envia `completionOptions`, autocomplete, `deleteSourceBranch` nem override de policy — o corpo é montado só com source/target/título/descrição/reviewers/work items. Criar PR *para* `main` é normal e permitido (é o propósito do PR); o que não existe em lugar nenhum é merge ou delete. Quando `targetRef` casa `ADO_PROTECTED_BRANCHES` (default `main,master,develop,release/*`), o preview destaca "PR mirando branch protegida" para o humano notar antes do `confirm` — é sinalização, não bloqueio, já que não há mutação da branch.

### Camada 7 — Audit log local
Toda tentativa de escrita é anexada em `ado-mcp-audit.log`: timestamp ISO, tool, params (PAT nunca logado), `outcome` (`applied` | `blocked` | `failed`) e o id do resultado. O negado importa tanto quanto o aplicado — uma escrita barrada por `ADO_MODE=read` deixa rastro. Falha ao gravar a trilha nunca mascara uma mutação já enviada: o resultado volta como aplicado, com aviso explícito. O arquivo rotaciona para `.1` ao passar de 5 MB. Se algo sair errado, você vê exatamente o quê e reverte pelo histórico do ADO (work items têm revisão; PRs reativam; comentários editam).

### Robustez geral
Validação zod na entrada; timeouts em toda request; retry só em leitura idempotente (nunca em escrita); erros mapeados para mensagens curtas e acionáveis, nunca engolidos; `config.js` falha barulhenta se `DEVOPS_URL`/`DEVOPS_PROJECT`/`DEVOPS_PAT` faltarem.

## 6. Catálogo de tools

Legenda: **R** = leitura (sempre disponível) · **W** = escrita (só em `ADO_MODE=write`, exige `confirm`, gera audit).

Toda tool aceita `project?`; sem ele vale `DEVOPS_PROJECT` (§7).

### Work items
| Tool | Tipo | Params principais | Guardas |
|---|---|---|---|
| `wit_query` | R | `wiql` **ou** `preset` (`my_active`/`my_recent`) **ou** `queryId`, `top?`, `fields?`, `expand?` | recusa resultado fora do projeto |
| `wit_get` | R | `ids` (máx. 200), `fields?`, `expand?`, `asOf?` | recusa id fora do projeto |
| `wit_tree` | R | `wiql` (`FROM WorkItemLinks`), `top?` | recusa item fora do projeto; teto de 200 nós |
| `wit_comments` | R | `id`, `top?` | recusa id fora do projeto; fallback `System.History` |
| `wit_history` | R | `id`, `top?` | recusa id fora do projeto |
| `wit_meta` | R | `kind` (`types`/`states`/`fields`/`categories`/`relationtypes`/`areas`/`iterations`/`tags`), `type?`, `depth?` | leitura de metadados; `relationtypes` é organizacional |
| `wit_create` | W | `type`, `title`, `fields?`, `parentId?`, `relations?`, `tags?`, `areaPath?`, `iterationPath?` | confirm; `validateOnly` no preview; allowlist de tipo e área; HTML sanitizado; alvos de link validados antes do preview |
| `wit_update` | W | `id` **ou** `ids`, `fields?`, `state?`, `tags?`, `expectedRev?` | confirm; ids explícitos; recusa id fora do projeto; `test /rev`; sem delete |
| `wit_link` | W | `id`, `rel`, `targetId?`/`url?`/`repo?`+`artifactValue?` | confirm; alvo validado no projeto; artifact link montado a partir dos GUIDs |
| `wit_unlink` | W | `id`, `rel`, `targetId?`/`url?` | confirm; índice resolvido na hora; recusa correspondência ambígua |
| `wit_comment` | W | `id`, `text` | confirm; API de comments com fallback `System.History` |
| `wit_attach` | W | `id`, `filePath`, `comment?` | confirm; limite de tamanho e extensão checados no preview; upload só após `confirm` |

### Pull requests
| Tool | Tipo | Params principais | Guardas |
|---|---|---|---|
| `pr_list` | R | `repo`, `status?` (`active`/`completed`/`abandoned`), `creator?`, `target?` | allowlist de repo |
| `pr_get` | R | `repo`, `prId` | allowlist de repo |
| `pr_create` | W | `repo`, `sourceRef`, `targetRef`, `title`, `description?`, `reviewers?`, `workItemIds?`, `isDraft?` | confirm; allowlist; **não faz merge** |
| `pr_update` | W | `repo`, `prId`, `title?`, `description?`, `isDraft?`, `target?` | confirm; allowlist; **nunca envia `status`** |
| `pr_add_reviewers` | W | `repo`, `prId`, `reviewers` | confirm; allowlist |
| `pr_comment` | W | `repo`, `prId`, `text`, `thread?` | confirm; allowlist |

> **Ausente por decisão de design:** `pr_complete`, `pr_abandon`. `pr_update` edita metadados e nada mais: o mesmo `PATCH` da API aceita `status: abandoned` (fecha) e `status: completed` (mergeia), então o campo simplesmente não é montado.

### Projetos
| Tool | Tipo | Params principais | Guardas |
|---|---|---|---|
| `project_list` | R | — | marca quais projetos o `project` das demais tools aceita |

### Repos / branches
| Tool | Tipo | Params principais | Guardas |
|---|---|---|---|
| `repo_list` | R | — | filtra pela allowlist se definida |
| `branch_list` | R | `repo`, `filter?` | allowlist |
| `commit_list` | R | `repo`, `branch?`, `top?` | allowlist |

## 7. Configuração (`.env`)

| Var | Default | Papel |
|---|---|---|
| `DEVOPS_URL` | — (obrigatório) | base da coleção on-prem, ex. `http://servidor/colecao` |
| `DEVOPS_PROJECT` | — (obrigatório) | projeto padrão (blast radius) |
| `DEVOPS_PAT` | — (obrigatório) | PAT mínimo dedicado |
| `API_VERSION` | `6.0` | versão da REST API (comprovada no on-prem) |
| `ADO_MODE` | `read` | `read` (só leitura) \| `write` (habilita escritas) |
| `ADO_PROJECT_ALLOWLIST` | vazio (só `DEVOPS_PROJECT`) | outros projetos aceitos no parâmetro `project`; `*` libera a coleção |
| `ADO_WIT_TYPE_ALLOWLIST` | vazio (todos) | tipos que `wit_create` pode criar |
| `ADO_WIT_AREA_ALLOWLIST` | vazio (todo o projeto) | area paths onde a escrita é permitida, por prefixo |
| `ADO_ATTACH_MAX_MB` | `25` | teto de tamanho por anexo |
| `ADO_ATTACH_EXT_ALLOWLIST` | vazio (todas) | extensões de anexo permitidas |
| `ADO_REPO_ALLOWLIST` | vazio (todos) | lista separada por vírgula de repos permitidos |
| `ADO_PROTECTED_BRANCHES` | `main,master,develop,release/*` | branches sob guarda reforçada |
| `ADO_AUDIT_LOG` | `./ado-mcp-audit.log` | caminho da trilha de auditoria |
| `ADO_TIMEOUT_MS` | `30000` | timeout das chamadas HTTP em ms |

`.env`, `*.log` e `node_modules` no `.gitignore`. Nenhum segredo entra em `.mcp.json` nem em qualquer repositório de trabalho.

## 8. Registro no Claude Code (user scope)

```bash
claude mcp add --scope user ado -- node ~/dev/ado-mcp-server/src/index.js
```

User scope → disponível em todos os projetos/worktrees; a config fica em `~/.claude.json`, fora dos repositórios de trabalho. As tools de escrita continuam sujeitas ao prompt de permissão do Claude Code (segunda barreira além do `ADO_MODE`).

## 9. Stack

Node 20 (nvm), `@modelcontextprotocol/sdk`, `axios`, `zod` (schemas das tools), `dotenv`. Sem framework.

## 10. Fora de escopo desta versão (adiado)

- **Semente de reúso:** o `core/` é REST puro. Se virar CLI manual ou serviço de time, adiciona-se um front novo (`bin/ado.js` ou HTTP) sobre o mesmo core, sem reescrever. Não construir agora.
- **Boards e backlogs** (`/work/boards`, `/work/backlogs`): colunas de board e ordenação de backlog não têm tool. A informação equivalente sai de `System.BoardColumn` via `wit_get`.
- **Lixeira** (`DELETE /wit/workitems`, `/wit/recyclebin`): excluir e restaurar continuam fora por §3, mesmo sendo reversíveis na API.
- **Editar/remover comentário** e **mover work item entre projetos ou tipos**: fora da superfície; a discussão é append-only e o item não muda de projeto.

## 11. Testes

Vitest sobre `core/` e `tools/` com o cliente HTTP dublado: montagem de URL, header de auth, JSON-patch de create/update/link, resolução de artifact link, fallback da API de comments, achatamento das áreas, e — crítico — que **guardas rejeitam**: escrita em `ADO_MODE=read`, mutação sem `confirm`, id ou alvo de link fora do projeto, projeto fora da allowlist, tipo fora da allowlist, HTML executável, anexo acima do limite, repo fora da allowlist.
