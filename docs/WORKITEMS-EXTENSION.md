# Extensão de work items — superfície da API e cobertura implementada

Escopo: gerenciamento completo de work items (epic, feature, PBI, task, bug), incluindo hierarquia, links, discussão, campos ricos, anexos e metadados de processo. Status: implementado; este documento é a referência da API por trás das tools.

Base das rotas: `${DEVOPS_URL}/${projeto}/_apis`, onde `projeto` é `DEVOPS_PROJECT` ou o `project` passado na tool (`src/core/client.js`). Rotas marcadas **org** ficam em `${DEVOPS_URL}/_apis`.

## 1. Superfície da API de Work Item Tracking

### 1.1 Leitura

| Endpoint | Uso | Estado |
|---|---|---|
| `GET /wit/workitems?ids=&fields=&$expand=&asOf=` | lote até 200 ids; `$expand=relations\|fields\|links\|all` | GA |
| `GET /wit/workitems/{id}?$expand=all` | item único com relations | GA |
| `POST /wit/wiql` | WIQL flat, `tree` e `oneHop`; tree retorna `workItemRelations` | GA |
| `GET /wit/wiql/{queryId}` | executa query salva | GA |
| `GET /wit/queries/{path}?$expand=all&$depth=2` | árvore de queries salvas | GA |
| `GET /wit/workItems/{id}/comments?$top=&continuationToken=` | discussão real, paginada, com autor e data | preview (`-preview.3`) |
| `GET /wit/workItems/{id}/comments/{commentId}` | comentário isolado | preview |
| `GET /wit/workitems/{id}/updates` | diff campo a campo por revisão | GA |
| `GET /wit/workitems/{id}/revisions/{rev}` | snapshot de revisão | GA |
| `GET /wit/workitemtypes` | tipos do processo do projeto | GA |
| `GET /wit/workitemtypes/{type}/states` | estados válidos e categoria de estado | GA (ADO Server 2020+) |
| `GET /wit/workitemtypes/{type}/fields?$expand=all` | campos, obrigatoriedade, allowedValues | GA |
| `GET /wit/workitemtypecategories` | mapeia categoria → tipo (Epic/Feature/Requirement/Task/Bug) | GA |
| `GET /wit/fields/{refName}` | tipo de dado do campo | GA |
| **org** `GET /_apis/wit/workitemrelationtypes` | catálogo de `rel` disponíveis no servidor | GA |
| `GET /wit/classificationnodes/Areas?$depth=5` | árvore de Area Path | GA |
| `GET /wit/classificationnodes/Iterations?$depth=5` | árvore de Iteration Path | GA |
| `GET /work/teamsettings/iterations` | sprints do time, com datas | GA |
| `GET /wit/tags` | tags existentes no projeto | preview |
| `GET /wit/recyclebin` | itens excluídos | GA |

### 1.2 Escrita

Todas em JSON Patch (`application/json-patch+json`), exceto anexo e `$batch`.

| Endpoint | Uso |
|---|---|
| `POST /wit/workitems/${type}` | cria; aceita `/fields/*` e `/relations/-` na mesma chamada |
| `PATCH /wit/workitems/{id}` | atualiza campos, relations e `System.History` |
| `POST /wit/$batch` | até 200 operações em uma chamada |
| `POST /wit/attachments?fileName=&uploadType=simple` | upload binário (`application/octet-stream`) → `{id,url}` |
| `POST /wit/workItems/{id}/comments` | comentário na API nova (preview) |
| `PATCH`/`DELETE /wit/workItems/{id}/comments/{commentId}` | editar/remover comentário (preview) |
| `DELETE /wit/workitems/{id}?destroy=false` | envia para a lixeira |
| `PATCH /wit/recyclebin/{id}` `{"IsDeleted":false}` | restaura |
| `DELETE /wit/recyclebin/{id}` | destrói permanentemente |

Query params de escrita relevantes:

- `validateOnly=true` — o servidor valida regras e devolve o resultado sem persistir.
- `bypassRules=true` — ignora regras do processo; exige permissão elevada.
- `suppressNotifications=true` — não dispara e-mail.
- `$expand=relations` — devolve o item já expandido após a mutação.

### 1.3 Operações JSON Patch necessárias

```jsonc
{ "op": "test",    "path": "/rev", "value": 12 }                  // concorrência otimista
{ "op": "add",     "path": "/fields/System.Tags", "value": "a; b" }
{ "op": "add",     "path": "/relations/-", "value": { "rel": "...", "url": "...", "attributes": { "comment": "..." } } }
{ "op": "remove",  "path": "/relations/3" }                       // índice, exige GET $expand=relations antes
```

### 1.4 Tipos de link

| `rel` | Semântica |
|---|---|
| `System.LinkTypes.Hierarchy-Reverse` / `-Forward` | pai / filho |
| `System.LinkTypes.Related` | relacionado |
| `System.LinkTypes.Dependency-Reverse` / `-Forward` | predecessor / sucessor |
| `System.LinkTypes.Duplicate-Forward` / `-Reverse` | duplicado |
| `Microsoft.VSTS.Common.TestedBy-Forward` / `-Reverse` | testado por |
| `AttachedFile` | anexo (`url` = retorno do upload) |
| `Hyperlink` | URL externa |
| `ArtifactLink` | commit, branch, PR, build |

URIs de `ArtifactLink` (usam GUIDs, não nomes):

```
vstfs:///Git/PullRequestId/{projectId}%2F{repoId}%2F{pullRequestId}
vstfs:///Git/Commit/{projectId}%2F{repoId}%2F{commitSha}
vstfs:///Git/Ref/{projectId}%2F{repoId}%2FGB{branchName}
```

`attributes.name` deve ser `Pull Request`, `Fixed in Commit` ou `Branch`.

### 1.5 Campos por tipo de dado

| Tipo | Formato aceito |
|---|---|
| `html` (`System.Description`, `Microsoft.VSTS.TCM.ReproSteps`, `Microsoft.VSTS.Common.AcceptanceCriteria`) | HTML em string |
| `identity` (`System.AssignedTo`) | `uniqueName` ou `Nome <email>` |
| `treePath` (`System.AreaPath`, `System.IterationPath`) | caminho com `\` |
| `dateTime` (`Microsoft.VSTS.Scheduling.TargetDate`) | ISO 8601 |
| `boolean`, `double`, `integer` | valor nativo JSON |
| `System.Tags` | string única separada por `; ` — exige read-modify-write |

## 2. Client — o que a extensão exigiu

| Necessidade | Solução | Onde |
|---|---|---|
| Rota organizacional (`projects`, `workitemrelationtypes`) | `orgUrl()` monta URL absoluta; axios ignora a `baseURL` e mantém auth e `api-version` | `src/core/client.js` |
| `api-version` de preview por chamada | `previewVersion()`; axios 1.19 faz merge profundo de `params`, então só essa chave é sobrescrita | `src/core/client.js` |
| Corpo binário para anexo | `post` com `Buffer` e `Content-Type: application/octet-stream` — sem alteração no client | `src/core/witlinks.js` |
| Troca de projeto em runtime | `createContext()` memoiza um cliente axios por projeto; a `baseURL` continua fixando o projeto | `src/core/client.js` |
| Tipos de campo além de string/number | `fieldMap` aceita `string \| number \| boolean \| null` | `src/tools/workitems.tools.js` |
| Descrição e relações na leitura | `fields` e `$expand` opcionais; a API recusa os dois juntos, então `expand` desliga `fields` | `src/core/workitems.js` |

`delete` e `put` continuam ausentes do client por decisão de escopo: lixeira e remoção de comentário estão fora da superfície (DESIGN §3).

## 3. Superfície de tools implementada

12 tools de work item mais `project_list`. Metadados ficam agrupados em `wit_meta` com `kind` para não inflar a lista de tools no contexto do cliente.

| Tool | Endpoints | Modo |
|---|---|---|
| `wit_query` | `POST /wit/wiql`, `GET /wit/wiql/{id}` | leitura |
| `wit_get` | `GET /wit/workitems` com `fields`/`expand`/`asOf` | leitura |
| `wit_tree` | WIQL `queryType=tree` + hidratação | leitura |
| `wit_comments` | `GET .../comments` | leitura |
| `wit_history` | `GET .../updates` | leitura |
| `wit_meta` | `kind: types \| states \| fields \| categories \| relationtypes \| areas \| iterations \| tags` | leitura |
| `wit_create` | `POST /wit/workitems/${type}` com relations inline | escrita |
| `wit_update` | `PATCH /wit/workitems/{id}` ou `POST /wit/$batch` | escrita |
| `wit_link` | `add /relations/-` (hierarquia, related, artifact, hyperlink) | escrita |
| `wit_unlink` | `remove /relations/{index}` | escrita |
| `wit_comment` | `POST .../comments`, fallback `System.History` | escrita |
| `wit_attach` | upload + relation `AttachedFile` | escrita |

Fora do alvo por conflito com o escopo de projeto: `move` entre projetos, mudança de tipo, exclusão (lixeira ou permanente), edição e remoção de comentário.

`project_list` (`GET /_apis/projects`, organizacional) lista a coleção e marca quais projetos o parâmetro `project` aceita.

### 3.1 Schemas relevantes

```js
// toda tool aceita, além disto, project? — default DEVOPS_PROJECT
wit_get:     { ids, fields?, expand?: 'none'|'relations'|'fields'|'links'|'all', asOf? }
wit_create:  { type, title, fields?, parentId?, relations?: [{ rel, targetId?, url?, repo?, artifactValue?, comment? }],
               tags?: string[], areaPath?, iterationPath?, confirm? }
wit_update:  { id? | ids?: number[], fields?, state?, tags?: { add?, remove? },
               expectedRev?: number, confirm? }
wit_link:    { id, rel, targetId? | url? | (repo + artifactValue), comment?, expectedRev?, confirm? }
wit_unlink:  { id, rel, targetId? | url?, expectedRev?, confirm? }   // resolve o índice internamente
wit_comment: { id, text, confirm? }
wit_attach:  { id, filePath, comment?, confirm? }
```

`wit_unlink` recebe alvo semântico, não índice: o índice de `/relations/{i}` muda a cada mutação e expor índice cru gera remoção do link errado.

## 4. Guard-rails

O modelo existente — `ADO_MODE`, `confirm:true`, preview, auditoria — cobriu a escrita nova sem mudança estrutural. Acrescentado:

1. **Escopo de projeto nos alvos de link.** `buildRelation` resolve `targetId` via `getOne` antes de montar a relação, reaproveitando `assertProjectScope`.
2. **Preview validado pelo servidor.** `wit_create`, `wit_update` e `wit_link` reenviam o payload com `validateOnly=true` na fase de preview; o veredito do ADO entra na resposta.
3. **Concorrência otimista.** `expectedRev` emite `{op:'test', path:'/rev'}` no início do patch.
4. **Allowlist de tipos.** `ADO_WIT_TYPE_ALLOWLIST`, checada antes de qualquer request.
5. **Allowlist de area path.** `ADO_WIT_AREA_ALLOWLIST`, por prefixo, em create e update.
6. **Anexo.** Tamanho e extensão checados no preview; o upload só ocorre depois do `confirm`, junto do patch da relação.
7. **HTML.** `script`, `iframe`, handler inline e `javascript:` recusados em qualquer campo string.
8. **Allowlist de projeto.** `ADO_PROJECT_ALLOWLIST` decide quais projetos o parâmetro `project` alcança; o projeto efetivo entra no preview e na auditoria.
9. **`bypassRules` não é exposto** como parâmetro de tool.

## 5. Degradação em on-prem antigo

Dois endpoints são preview e podem não existir na instância. Ambos caem para uma rota GA em vez de falhar:

| Endpoint preview | Fallback | Efeito |
|---|---|---|
| `GET/POST /wit/workItems/{id}/comments` | `System.History` via `PATCH` e `/updates` | `wit_comments` devolve `source: "system-history"`; sem edição de comentário |
| `GET /wit/workitemtypes/{type}/states` | `allowedValues` de `System.State` | estados sem a categoria (`Proposed`/`InProgress`/`Completed`) |

`GET /wit/tags` também é preview e não tem fallback: `wit_meta kind: tags` falha onde o endpoint não existir. Tags continuam graváveis por `wit_update`.

## 6. Verificação contra a instância real

Os testes usam o cliente HTTP dublado; o comportamento do servidor on-prem ainda não foi exercitado. Checar, em ordem, com `ADO_MODE=write`:

1. `wit_meta kind: types` e `kind: relationtypes` — confirmam baseURL de projeto e rota organizacional.
2. `wit_comments` em um card com discussão — o campo `source` diz se a API de comments existe na instância (`API_VERSION=6.0` → `6.0-preview.3`).
3. `wit_create` sem `confirm` — o preview deve trazer o veredito do `validateOnly`.
4. `wit_link` com `rel: pull_request` — valida a montagem de `vstfs:///` a partir dos GUIDs devolvidos por `GET /git/repositories/{repo}`.
5. `wit_attach` com um arquivo pequeno — confirma o limite de upload aceito pela instância.
