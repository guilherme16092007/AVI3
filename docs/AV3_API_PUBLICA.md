# AV3 — Guia da API pública (`/api/v1/public`)

Documentação interativa (Swagger UI): `http://localhost:3000/api/v1/public/docs` — especificação OpenAPI: `/api/v1/public/openapi.json`.

## 1. Obtendo uma chave

Um **ADMINISTRADOR** cria a chave (a resposta é a única vez que o segredo aparece):

```bash
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","senha":"Admin@12345"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -s -X POST localhost:3000/api/v1/admin/chaves-api -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "nome": "Cooperativa Recicla+",
  "permissoes": ["RASTREABILIDADE_LER","LOTES_LER","ANALISES_LER","RELATORIOS_GERAR"],
  "organizacaoId": "<UUID da organizacao>",
  "limitePorMinuto": 120
}'
```

| Campo | Regra |
|---|---|
| `permissoes` | `RASTREABILIDADE_LER`, `LOTES_LER`, `LOTES_ESCREVER`, `ANALISES_LER`, `RELATORIOS_GERAR` |
| escopo | **obrigatório**: `organizacaoId` (restrita) **ou** `escopoGlobal: true` |
| `usuarioServicoId` | obrigatório com `LOTES_ESCREVER` (ADMINISTRADOR/GESTOR_ALMOXARIFADO; recebe a autoria dos registros) |
| `limitePorMinuto` | 1–100000 (padrão `API_LIMITE_PADRAO_POR_MINUTO`) |
| `expiraEm` | opcional, data/hora futura |

Gerenciamento: `GET /api/v1/admin/chaves-api`, `GET …/{id}`, `POST …/{id}/revogar` (`{"versao": n}` opcional).

## 2. Chamando a API

Envie a chave em **`X-API-Key`**:

```bash
KEY=gck_xxxxxxxxxxxx.yyyyyyyy...
curl -s localhost:3000/api/v1/public/me -H "X-API-Key: $KEY"
```

| Método e rota | Permissão | Descrição |
|---|---|---|
| `GET /me` | — | identidade, permissões, escopo e limite da chave |
| `GET /rastreabilidade/equipamentos/{id}` | `RASTREABILIDADE_LER` | equipamento + histórico (sem operador/observações internas) |
| `GET /lotes?limite&offset&organizacaoId` | `LOTES_LER` | lista paginada |
| `GET /lotes/{id}` | `LOTES_LER` | lote com equipamentos |
| `POST /lotes` | `LOTES_ESCREVER` | submete um lote (mesmas regras de negócio do sistema interno) |
| `GET /analises/{tipo}/ultimo` | `ANALISES_LER` | último relatório persistido; `tipo` = `eficiencia-operacional` \| `rentabilidade` \| `vida-util` |
| `POST /relatorios` | `RELATORIOS_GERAR` | **202** + tarefa; corpo `{"tipo":"VIDA_UTIL_REMANESCENTE","formato":"CSV"}` |
| `GET /relatorios/{id}` | `RELATORIOS_GERAR` | status (polling) |
| `GET /relatorios/{id}/download` | `RELATORIOS_GERAR` | arquivo JSON/CSV (409 enquanto não `CONCLUIDA`) |

Chave restrita a uma organização só enxerga dados dela; o resto responde **404** (ou **403** se tentar pedir explicitamente outra organização).

### Fluxo assíncrono

```bash
curl -si -X POST localhost:3000/api/v1/public/relatorios -H "X-API-Key: $KEY" -H 'content-type: application/json' \
     -d '{"tipo":"RENTABILIDADE_EQUIPAMENTO","formato":"CSV"}'
# HTTP/1.1 202 Accepted   Location: /api/v1/public/relatorios/<id>   {"status":"PENDENTE", ...}

curl -s localhost:3000/api/v1/public/relatorios/<id> -H "X-API-Key: $KEY"      # PENDENTE → EM_EXECUCAO → CONCLUIDA | FALHA
curl -s -OJ localhost:3000/api/v1/public/relatorios/<id>/download -H "X-API-Key: $KEY"
```

Estados: `PENDENTE` (inclui nova tentativa agendada: veja `proximaTentativaEm`/`erro`), `EM_EXECUCAO`, `CONCLUIDA`, `FALHA` (tentativas esgotadas ou erro não recuperável).

## 3. Limites, erros e versionamento

- **Limite por chave:** cabeçalhos `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; ao exceder → `429` com `Retry-After`. Chaves inválidas repetidas bloqueiam o IP (`LIMITE_TENTATIVAS_INVALIDAS`). Máx. de relatórios simultâneos por chave: `JOBS_LIMITE_ATIVAS_POR_CHAVE` (`LIMITE_TAREFAS_ATIVAS`).
- **Erros** (formato único): `{"statusCode":403,"erro":"ACESSO_NEGADO","mensagem":"…","detalhes":…}` — 400 requisição inválida, 401 chave ausente/inválida, 403 sem permissão/escopo, 404, 409, 422 regra de negócio, 429.
- **Versão:** `/api/v1` na URL e `X-API-Version: 1` na resposta; mudanças incompatíveis só em `/api/v2`.

## 4. API interna e administrativa (JWT)

| Rota | Papéis | |
|---|---|---|
| `GET /api/v1/internal/analises/{tipo}?organizacaoId=` | ADMINISTRADOR, AUDITOR | cálculo ao vivo |
| `POST /api/v1/internal/analises/{tipo}/gerar` | ADMINISTRADOR, AUDITOR | calcula e persiste (201) |
| `POST /api/v1/internal/analises/executar` | ADMINISTRADOR, AUDITOR | enfileira (202) |
| `GET /api/v1/internal/analises/historico`, `…/relatorios/{id}` | ADMINISTRADOR, AUDITOR | histórico persistido |
| `GET /api/v1/internal/analises/previsoes/acuracia` | ADMINISTRADOR, AUDITOR | previsão × realização |
| `GET /api/v1/internal/tarefas`, `…/{id}`, `…/{id}/download` | ADMINISTRADOR, AUDITOR | fila |
| `* /api/v1/admin/chaves-api…` | ADMINISTRADOR | chaves de API |

`tipo` nas rotas internas usa os mesmos slugs da API pública.
