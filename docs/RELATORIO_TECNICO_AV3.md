# Relatório técnico — AV3 (camada analítica, API pública e processamento assíncrono)

A AV3 é uma **continuação direta** da AV2: mesma stack (Node.js, TypeScript, Fastify, Prisma/PostgreSQL), mesma organização **Controller → Service → Repository**, nenhuma tabela, coluna, rota ou regra da AV2 foi alterada ou removida. Tudo o que é novo é aditivo.

```
                 ┌────────────── /api/v1/public  (X-API-Key) ──────────────┐
 Parceiro  ───▶  │ rate limit → autentica chave → permissão + escopo (org)  │
                 └───────────────┬──────────────────────────────────────────┘
                                 │ ParceiroServico (fachada; reaproveita LoteServico/EquipamentoServico)
 Front-end ───▶ /api/v1/internal, /api/v1/admin (JWT por papel) ──┐        │
                                                                   ▼        ▼
                                  AnaliseServico ── Eficiência | Rentabilidade | Vida útil  (serviços independentes)
                                        │                         │
                                        ▼                         ▼ (pedidos pesados)
                        RelatorioAnalitico + Previsões      RelatorioAssincronoServico ──▶ tabela Tarefa (fila no PostgreSQL)
                                        ▲                                                       │
                                        └──────────── ProcessadorTarefas (worker) ◀─────────────┤
                                                      AgendadorTarefas (cron) ──── enfileira ───┘
```

## 1. Camada analítica

Três serviços independentes (`AnaliseEficienciaServico`, `AnaliseRentabilidadeServico`, `AnaliseVidaUtilServico`), orquestrados por `AnaliseServico`. Os cálculos em si são **funções puras** (`src/server/analise/*`), testáveis sem banco; o serviço só lê dados (`AnaliseRepositorio`, um *read model*), chama a função pura e persiste.

| Categoria exigida | O que é calculado | Onde |
|---|---|---|
| Eficiência operacional | Duração do lote = triagem do **último** equipamento − data de entrada (só lotes totalmente triados; os demais ficam `EM_ANDAMENTO`). Média, mediana, desvio, p90. Tempo por operador (cadastro → triagem), por mês de conclusão, e **gargalos**: lotes atípicos (> média + 1,5 desvio), operador mais lento e mês mais lento (só comparados com amostra ≥ 3 / ≥ 2 períodos). | `analise/eficiencia.ts` |
| Rentabilidade | Valor médio/mediano/total de recuperação por tipo, tipo×estado físico, fabricante e modelo, com imposto e valor líquido; ranking de prioridade. Reutiliza a regra de valorização do domínio da AV1 (mesma da AV2) via `servicos/dominio.ts`. | `analise/rentabilidade.ts` |
| Vida útil remanescente | Regressão linear simples (OLS) por tipo: estado físico × idade em dias, projetando quando cada equipamento atinge `INSERVIVEL`. Fallback explícito na depreciação parametrizada quando há poucos dados. | `analise/vidaUtil.ts` |

**Por que biblioteca estatística própria (e não `simple-statistics`/`mathjs`).** O enunciado *sugere* essas bibliotecas ("você pode empregar"). Usei funções próprias com **os mesmos nomes e semântica** do `simple-statistics` (`mean`, `median`, `standardDeviation`, `quantile`, `linearRegression`) porque (a) o conjunto necessário é pequeno (≈80 linhas) e totalmente coberto por testes com valores conhecidos; (b) elimina uma dependência de runtime e de cadeia de suprimentos; (c) garante build idêntico em Windows e Linux; (d) a troca futura é trivial. O ambiente em que a AV3 foi desenvolvida também não tinha acesso ao registro npm.

**Limitações assumidas e declaradas nos próprios relatórios** (campos `limitacoes`/`observacoes`): o domínio não registra data de fabricação — a "idade" é o tempo desde o cadastro no greencode; o domínio não aplica preço diferenciado por marca/modelo — essas dimensões são agrupamentos de composição do inventário. Quando o modelo usa a depreciação do parâmetro em vez dos dados, o campo `modelo` vale `DEPRECIACAO_PARAMETRO` e `motivoModelo` explica por quê.

### Modelagem das tabelas analíticas (migration `20261120120000_av3_analitica_api_publica_fila`)

- **`RelatorioAnalitico`** — um registro por execução: `tipo`, `origem` (MANUAL/AGENDADO/API), `organizacaoId` (nulo = global), `parametros`, `resultado` (JSONB), `versaoModelo`, `geradoEm`, solicitante (usuário ou chave). JSONB porque o formato do resultado difere por tipo e evolui; `versaoModelo` permite comparar relatórios de épocas diferentes. Índice `(tipo, organizacaoId, geradoEm)` serve "último relatório do escopo" e o histórico.
- **`PrevisaoVidaUtilTipo`** — parâmetros da regressão por tipo e relatório (modelo, nº de amostras, inclinação, intercepto, R², mediana). Normalizada para permitir acompanhar a deriva do modelo.
- **`PrevisaoEquipamento`** — previsão individual (`diasRestantes`, `dataProjetadaInservivel`) por equipamento e relatório. É o que permite **comparar previsão × realização**: `GET /api/v1/internal/analises/previsoes/acuracia` cruza essas linhas com o momento em que o equipamento de fato chegou a `INSERVIVEL` (erro = dias reais − previstos).
- Resultados nunca são sobrescritos: relatórios anteriores permanecem para consulta histórica.

## 2. Processamento assíncrono, retry e agendamento

**Fila no próprio PostgreSQL (tabela `Tarefa`) em vez de BullMQ + Redis.** O enunciado propõe BullMQ/Redis como uma possibilidade. Optei por uma fila persistida no PostgreSQL porque: (1) o requisito de portabilidade exige **Windows 10+ e Ubuntu**, e o Redis não roda nativamente no Windows — a AV3 passa a exigir só o que a AV2 já exigia; (2) a enfileiração é **transacional com os demais dados** e sobrevive a reinícios sem configuração extra de persistência; (3) a carga prevista (relatórios, não milhões de mensagens/s) cabe com folga. O padrão externo é o pedido no enunciado: `POST` devolve **202 + id da tarefa + `Location`**; o cliente faz *polling* em `GET /relatorios/{id}` e baixa o arquivo (JSON ou CSV) em `/download` — `webhook` não foi implementado (o enunciado aceita "polling ou webhook").

- **Reivindicação segura entre vários workers:** cada tarefa só é obtida por quem consegue o `UPDATE … WHERE status='PENDENTE' AND versao=<lida>` (otimismo, o mesmo mecanismo de versão da AV2); se dois workers disputam, um vence e o outro segue para a próxima. Não há execução duplicada.
- **Lease:** uma tarefa reivindicada recebe `bloqueadaAte`. Se o worker morrer, o próximo ciclo devolve a tarefa à fila (ou a marca `FALHA` se as tentativas acabaram).
- **Política de retry:** até **3 tentativas** (`JOBS_MAX_TENTATIVAS`), **backoff exponencial** `5 s · 2^(n−1)` com *jitter* de até 20 % e teto de 5 min. Erros de negócio/validação/autorização (4xx) **não** sofrem retry (não melhoram com nova tentativa); erros de infraestrutura sofrem. Esgotadas as tentativas: `FALHA` com `ultimoErro` visível na consulta de status. O código está em `fila/politicaRetry.ts` e `fila/ProcessadorTarefas.ts`.
- **Proteção contra abuso:** no máximo 5 relatórios simultâneos por chave (`429 LIMITE_TAREFAS_ATIVAS`).
- **Agendamento (`AgendadorTarefas` + `fila/cron.ts`)** equivale ao `node-cron`: expressão de 5 campos (`ANALISE_CRON`, padrão `0 2 * * *`). Cada disparo recebe o *slot* nominal e usa `agendado:<tipo>:<slot>` como **chave de idempotência única** — com N instâncias da API, só uma tarefa por slot é criada. Gera os três relatórios globais, mantendo o histórico atualizado.
- **Encerramento gracioso:** `parar()` deixa de reivindicar e aguarda as tarefas em andamento.

## 3. API pública

- **Segregação de preocupações por prefixo** (e por política de segurança distinta): `/api/v1/public` (chave de API), `/api/v1/internal` e `/api/v1/admin` (JWT + papéis). As rotas da AV2 (`/lotes`, `/equipamentos`…) permanecem **inalteradas**, para não quebrar o front-end/clientes existentes; novas rotas internas seguem o prefixo versionado.
- **Versionamento:** versão maior na URL (`/api/v1`) + cabeçalho `X-API-Version`. Mudança incompatível ⇒ `/api/v2`, com a v1 mantida e sinalizada por `Deprecation`/`Sunset` por ao menos 6 meses (documentado na própria OpenAPI). A versão da API pública evolui independentemente da interna.
- **Chaves de API:** formato `gck_<prefixo>.<segredo 256 bits>`. O banco guarda **apenas o hash SHA-256** (segredo aleatório de alta entropia ⇒ hash rápido é adequado; *bcrypt/scrypt* seriam desperdício por requisição); o segredo é mostrado **uma única vez**. Comparação em tempo constante; chave inexistente/errada/revogada/expirada devolve a mesma mensagem (sem enumeração). Revogação imediata (`ChaveApi.revogadaEm`), expiração opcional, `ultimoUsoEm`.
- **Permissões por contrato:** `RASTREABILIDADE_LER`, `LOTES_LER`, `LOTES_ESCREVER`, `ANALISES_LER`, `RELATORIOS_GERAR`. **Escopo por organização** obrigatório: a chave é restrita a uma organização ou explicitamente `escopoGlobal` (nunca global por esquecimento); recurso fora do escopo responde **404**. Escrita de lotes é atribuída a um *usuário de serviço* (papel ADMINISTRADOR/GESTOR) para preservar a auditoria; os mesmos serviços de negócio da AV2 são reaproveitados — nenhuma regra foi duplicada.
- **Minimização de dados:** o histórico público de rastreabilidade omite o operador e observações livres internas.
- **Rate limit:** janela deslizante **por chave** (`limitePorMinuto`, parte do plano comercial) com `X-RateLimit-*` e `429 + Retry-After`; mais um limite **por IP para chaves inválidas** (anti força bruta). Implementação própria em `plugins/limiteTaxa.ts`, equivalente ao `@fastify/rate-limit` com *store* em memória.
- **Documentação interativa:** OpenAPI 3.0.3 **derivada dos schemas das rotas** (o contrato documentado é o validado) em `/api/v1/public/openapi.json`, Swagger UI em `/api/v1/public/docs`, com exemplos, parâmetros e códigos de erro (400/401/403/404/409/429). Equivale ao `@fastify/swagger`; o Swagger UI carrega seus assets de um CDN (a spec JSON funciona offline).

## 4. Evoluindo para centenas ou milhares de parceiros

1. **Rate limit compartilhado:** hoje o contador é em memória (correto com 1 instância). Com várias instâncias, trocar `LimitadorTaxa` por um *store* Redis (a interface `consumir/consultar` já isola isso) — ou `@fastify/rate-limit` com `redis`.
2. **Fila:** o *claim* otimista escala a algumas dezenas de workers; acima disso, migrar para `SELECT … FOR UPDATE SKIP LOCKED` (sem contenção) e, em volumes muito maiores, para BullMQ/Redis ou SQS — o `ProcessadorTarefas` depende só da porta `TarefaRepositorio`, então a troca não toca nos serviços. Rodar API e workers em processos separados já é possível (`WORKER_HABILITADO=false` + `npm run start:worker`), escalando cada um de forma independente.
3. **Armazenamento dos arquivos:** o conteúdo do relatório fica em `Tarefa.resultadoConteudo` (simples e transacional). Para arquivos grandes, gravar em object storage (S3/MinIO) e guardar só a URL assinada, com expiração e limpeza (*retention*) das tarefas e previsões antigas.
4. **Cálculo analítico:** hoje a leitura é paginada por cursor e agregada em memória. Para milhões de equipamentos, mover agregações para SQL (`GROUP BY`/*materialized views*) ou para uma réplica de leitura, e calcular relatórios por organização de forma incremental.
5. **Gestão de parceiros:** planos (limites e permissões por contrato) como entidade própria, cotas mensais, *webhooks* assinados (HMAC) em vez de *polling*, rotação de chaves com sobreposição, painel de uso por chave (já existe `ultimoUsoEm`) e métricas (Prometheus) de latência/429/fila.
6. **API Gateway/WAF** na frente da API pública para TLS, proteção volumétrica e *quotas* globais.

## 5. Limitações conhecidas e pendências

- Os repositórios **Prisma** da AV3 e a **migration SQL** foram escritos e verificados por tipos (o client foi regenerado e todo o projeto compila), mas **não foram executados contra um PostgreSQL real** no ambiente de desenvolvimento (sem banco nem rede). A lógica de negócio foi validada com repositórios em memória que implementam as mesmas portas. Rode `npx prisma migrate deploy` e o `npm run db:seed` no seu ambiente para fechar essa validação (ver `docs/AV3_INSTALACAO_E_TESTES.md`).
- Webhook de conclusão não implementado (somente *polling*).
- Rate limit em memória (uma instância).
