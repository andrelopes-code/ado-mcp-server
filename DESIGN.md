# ado-mcp-server — Design

**Data:** 2026-07-16
**Autor:** André Lopes
**Status:** spec aprovada (aguardando revisão) → plano de implementação

Servidor MCP local que dá ao Claude Code acesso controlado ao **Azure DevOps Server on-premise** via REST API, priorizando segurança: o Claude não pode destruir nada porque as operações destrutivas **não existem no código**.

---

## 1. Contexto e motivação

O Azure DevOps Server on-premise expõe a mesma REST API do serviço em nuvem (`{coleção}/_apis/...`), mas o `az devops` CLI e os MCPs oficiais não suportam on-prem de forma confiável. A REST API, porém, funciona — já existe prova no repositório ASTI (`devops_integracao/services/taskService.js` cria work items com PAT via Basic auth).

Este projeto é o "MCP confiável de on-prem" que falta: um wrapper fino, tipado e **seguro-por-padrão** sobre essa REST API.

## 2. Objetivos

- Dar ao Claude Code tools nativas para o fluxo diário: **work items (cards), pull requests, repos/branches**.
- Ser **robusto** e **impossível de causar estrago irreversível** no DevOps real.
- Rodar **isolado** do monorepo ASTI (projeto próprio, `.env` próprio, git próprio).
- Uso **pessoal**, nesta máquina, sob a conta do André.

## 3. Não-objetivos (YAGNI)

- Não é serviço hospedado nem multiusuário (pode virar depois — ver §10).
- Sem builds/pipelines nesta versão.
- Sem operações destrutivas: **nada de** deletar work item, deletar/abandonar branch, deletar repo, abandonar PR.
- **Sem `pr_complete`/merge** — o merge é ação humana no web UI. Decisão explícita: é a única operação verdadeiramente irreversível, então fica fora da superfície.

## 4. Arquitetura

Servidor MCP stdio em Node. Separação **core (REST puro) / tools (adaptador MCP)** — o core não conhece MCP e é o ponto de reúso para um futuro CLI ou serviço de time.

```
~/dev/ado-mcp-server/            ← isolado do ASTI, git próprio
├── .env                          (gitignored) segredos + modo
├── .env.example                  template documentado
├── .gitignore                    ignora .env, node_modules, *.log
├── package.json
├── README.md                     setup + geração do PAT mínimo + registro no Claude
├── DESIGN.md                     este documento
├── ado-mcp-audit.log             (gitignored) trilha de toda escrita executada
└── src/
    ├── index.js                  bootstrap MCP (StdioServerTransport), registra tools
    ├── config.js                 carrega/valida .env; falha barulhenta se faltar segredo
    ├── audit.js                   append no audit log (timestamp, tool, params, resultado)
    ├── core/                     REST puro — ZERO conhecimento de MCP, reusável
    │   ├── client.js             axios: base URL, Basic-PAT, api-version, paginação, mapeamento de erro
    │   ├── workitems.js          query/get/create/update/comment/link
    │   ├── pullrequests.js       list/get/create/add_reviewers/comment
    │   └── repos.js              list/branches/commits
    └── tools/                    adaptadores MCP finos: schema zod → chama core → aplica guardas
        ├── workitems.tools.js
        ├── pullrequests.tools.js
        └── repos.tools.js
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

### Camada 4 — Preview → confirm em toda mutação
Toda tool de escrita exige `confirm: true`. Sem isso, **não executa**: retorna o preview exato — método, URL, corpo/JSON-patch que enviaria, e os valores atuais dos campos que mudariam. Toda escrita é two-phase e visível; o prompt de permissão do Claude Code dispara na chamada com `confirm`.

### Camada 5 — Blast radius fixado
- `DEVOPS_PROJECT` único no `.env`; requisições a ids de outro projeto são recusadas.
- Allowlist opcional de repos (`ADO_REPO_ALLOWLIST`).
- **Uma tool = uma entidade.** Sem endpoints de bulk/"update all": força N chamadas discretas, cada uma barrada individualmente, em vez de uma catastrófica.

### Camada 6 — `pr_create` sem nenhuma opção destrutiva embutida
`pr_create` **nunca** envia `completionOptions`, autocomplete, `deleteSourceBranch` nem override de policy — o corpo é montado só com source/target/título/descrição/reviewers/work items. Criar PR *para* `main` é normal e permitido (é o propósito do PR); o que não existe em lugar nenhum é merge ou delete. Quando `targetRef` casa `ADO_PROTECTED_BRANCHES` (default `main,master,develop,release/*`), o preview destaca "PR mirando branch protegida" para o humano notar antes do `confirm` — é sinalização, não bloqueio, já que não há mutação da branch.

### Camada 7 — Audit log local
Toda escrita executada é anexada em `ado-mcp-audit.log`: timestamp ISO, tool, params (PAT nunca logado), método+URL, id/resultado. Se algo sair errado, você vê exatamente o quê e reverte pelo histórico do ADO (work items têm revisão; PRs reativam; comentários editam).

### Robustez geral
Validação zod na entrada; timeouts em toda request; retry só em leitura idempotente (nunca em escrita); erros mapeados para mensagens curtas e acionáveis, nunca engolidos; `config.js` falha barulhenta se `DEVOPS_URL`/`DEVOPS_PROJECT`/`DEVOPS_PAT` faltarem.

## 6. Catálogo de tools

Legenda: **R** = leitura (sempre disponível) · **W** = escrita (só em `ADO_MODE=write`, exige `confirm`, gera audit).

### Work items
| Tool | Tipo | Params principais | Guardas |
|---|---|---|---|
| `wit_query` | R | `wiql` (string) **ou** `preset` (`my_active`/`my_recent`) | — |
| `wit_get` | R | `ids` (array), `fields?` | recusa id fora do projeto |
| `wit_create` | W | `type`, `title`, `fields?`, `parentId?` | confirm; sem bulk |
| `wit_update` | W | `id`, `fields?`, `state?` | confirm; 1 item; recusa id fora do projeto; sem delete |
| `wit_comment` | W | `id`, `text` | confirm; via `System.History` (estável em qualquer api-version) |

### Pull requests
| Tool | Tipo | Params principais | Guardas |
|---|---|---|---|
| `pr_list` | R | `repo`, `status?` (`active`/`completed`/`abandoned`), `creator?`, `target?` | allowlist de repo |
| `pr_get` | R | `repo`, `prId` | allowlist de repo |
| `pr_create` | W | `repo`, `sourceRef`, `targetRef`, `title`, `description?`, `reviewers?`, `workItemIds?` | confirm; allowlist; **não faz merge** |
| `pr_add_reviewers` | W | `repo`, `prId`, `reviewers` | confirm; allowlist |
| `pr_comment` | W | `repo`, `prId`, `text`, `thread?` | confirm; allowlist |

> **Ausente por decisão de design:** `pr_complete`, `pr_abandon`.

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
| `DEVOPS_PROJECT` | — (obrigatório) | projeto único (blast radius) |
| `DEVOPS_PAT` | — (obrigatório) | PAT mínimo dedicado |
| `API_VERSION` | `6.0` | versão da REST API (comprovada no on-prem) |
| `ADO_MODE` | `read` | `read` (só leitura) \| `write` (habilita escritas) |
| `ADO_REPO_ALLOWLIST` | vazio (todos) | lista separada por vírgula de repos permitidos |
| `ADO_PROTECTED_BRANCHES` | `main,master,develop,release/*` | branches sob guarda reforçada |
| `ADO_AUDIT_LOG` | `./ado-mcp-audit.log` | caminho da trilha de auditoria |

`.env`, `*.log` e `node_modules` no `.gitignore`. Nenhum segredo entra em `.mcp.json` nem no repo ASTI.

## 8. Registro no Claude Code (user scope)

```bash
claude mcp add --scope user ado -- node /home/dreco/dev/ado-mcp-server/src/index.js
```

User scope → disponível em todos os projetos/worktrees; a config fica em `~/.claude.json`, longe do repo ASTI. As tools de escrita continuam sujeitas ao prompt de permissão do Claude Code (segunda barreira além do `ADO_MODE`).

## 9. Stack

Node 20 (nvm), `@modelcontextprotocol/sdk`, `axios`, `zod` (schemas das tools), `dotenv`. Sem framework.

## 10. Fora de escopo desta versão (adiado)

- **Semente de reúso:** o `core/` é REST puro. Se virar CLI manual ou serviço de time, adiciona-se um front novo (`bin/ado.js` ou HTTP) sobre o mesmo core, sem reescrever. Não construir agora.
- **`wit_link_artifact`** (linkar work item a um commit/PR avulso depois do fato): exige montar URL `vstfs:///Git/...` com project-id + repo-id + encode — frágil no on-prem. O caso real de PR↔card já é coberto por `pr_create.workItemIds`; commit↔card pela mensagem de commit (`#id`). Adicionar só quando surgir a necessidade concreta de linkar retroativamente.

## 11. Testes

Vitest opcional sobre o `core/` com axios mockado: monta de URL, header de auth, JSON-patch de create/update, mapeamento de erro, e — crítico — que **guardas rejeitam** (escrita em `ADO_MODE=read`, mutação sem `confirm`, id fora do projeto, repo fora da allowlist). Gerar só quando solicitado.
