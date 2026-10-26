# AV2 — Testes e verificação

Este documento diz **exatamente** o que foi verificado, como, e o que ainda precisa ser confirmado no seu ambiente. A separação é deliberada: só afirmo como "verificado" o que foi realmente executado.

## 1. O que foi executado nesta validação (Windows, sem PostgreSQL disponível)

| Verificação | Comando | Resultado |
|---|---|---|
| Regressão AV1 + regras de serviço/utilitários AV2 (inclui o tratamento de `P2004`) | `npm test` | AV1 **40/40**, serviços **90/90**, utilitários **34/34** |
| Rotas HTTP com Fastify e repositórios em memória | `npm run test:http` | **55/55** |
| Build AV1 | `npm run build` | Exit code 0 |
| Build do servidor e geração do Prisma Client | `npm run build:server` | Exit code 0 |
| Validação do schema Prisma | `npx prisma validate` | Schema válido |
| Proteção do seed em produção | `NODE_ENV=production npm run db:seed` (forma equivalente no PowerShell) | Seed recusado antes de acessar o banco |
| Smoke test do processo compilado sem banco | Servidor iniciado com URL fictícia e `GET /saude` | HTTP **503**, banco indicado como indisponível |

O que os testes de serviços cobrem: autenticação (credencial errada e usuário inexistente com a mesma resposta; inativo), matriz de permissões por papel, CNPJ (dígitos, duplicidade), contrato (vigência, número único, atualização com versão), janela de datas do lote (futuro, > 90 dias, parâmetro global), criação de lote com equipamentos, **rollback** (falha no meio desfaz o lote e os equipamentos; falha ao gravar a movimentação não altera o status), triagem, máquina de estados, regra da justificativa, **conflito de versão**, rastreabilidade em ordem cronológica, relatório (valores exatos e polimorfismo por tipo) e paginação.

Os testes de serviço/utilitários e HTTP usam repositórios em memória; não são testes de integração com PostgreSQL. O teste HTTP usa o Fastify real por `app.inject`.

## 2. O que NÃO foi executado nesta validação (e por quê)

- `npx prisma migrate deploy` e aplicação das migrações em PostgreSQL.
- Seed em um banco de testes. A proteção de `NODE_ENV=production` foi executada sem conectar ao banco; o preenchimento dos dados permanece sem validação de integração.
- Testes de constraints, chaves estrangeiras, trigger append-only e erros reais do driver PostgreSQL.
- Rollback e concorrência otimista em transações reais do PostgreSQL.
- Instalação limpa com `npm ci` e execução em Windows 10 mínimo ou Ubuntu 24.04.03+.

O PostgreSQL não estava acessível em `127.0.0.1:5432`, e o daemon Docker Desktop não estava ativo. Não foi usada a URL do `.env` para evitar atingir um banco desconhecido. A compilação foi feita contra as dependências reais instaladas, não contra stubs.

## 3. Roteiro de verificação no seu ambiente

Execute na ordem; cada passo indica o resultado esperado.

### 3.1 Instalação e build

```bash
npm install
npm run build:server        # gera o Prisma Client e compila (esperado: sem erros)
npm run build               # AV1 continua compilando (esperado: sem erros)
npm test                    # AV1 (40) + AV2 (90 + 34), sem banco
npm run test:http           # rotas HTTP com o Fastify real (esperado: todas OK)
```

### 3.2 Banco, migrações e seed

```bash
docker compose up -d        # ou PostgreSQL local; ajuste DATABASE_URL no .env
npx prisma migrate deploy   # esperado: 2 migrações aplicadas
npm run db:seed             # esperado: resumo com usuários e IDs de teste
```

Execute migrações e seed somente em um banco de desenvolvimento/teste isolado. O seed recusa `NODE_ENV=production`; `SEED_RESET=1` é destrutivo e apaga os dados existentes desse banco.

### 3.3 Constraints no banco (via `psql`, ou `docker exec -it greencode-db psql -U greencode`)

Cada comando abaixo **deve falhar** com a mensagem indicada (comprova que o banco recusa estados inconsistentes mesmo sem passar pela API):

```sql
-- CNPJ fora do formato -> viola ck_organizacao_cnpj_formato
UPDATE "Organizacao" SET "cnpj" = '123' WHERE true;

-- Trilha de auditoria imutável -> "Movimentacao e imutavel (append-only)"
UPDATE "Movimentacao" SET "justificativa" = 'x' WHERE true;
DELETE FROM "Movimentacao";

-- Estado físico fora de 0..4 -> viola ck_equipamento_estado_fisico
UPDATE "Equipamento" SET "estadoFisico" = 9 WHERE true;

-- Código de barras duplicado -> viola Equipamento_codigoBarrasInterno_key
UPDATE "Equipamento" SET "codigoBarrasInterno" = 'BC-H-0001' WHERE "codigoBarrasInterno" = 'BC-H-0002';
```

### 3.4 API (com o servidor em execução)

| # | Chamada | Esperado |
|---|---|---|
| 1 | `GET /saude` | 200, `banco: "conectado"` |
| 2 | `GET /organizacoes` sem token | 401 |
| 3 | Login como `auditor` e `POST /organizacoes` | 403 |
| 4 | Login como `gestor` e `PATCH /equipamentos/<id AGUARDANDO_TRIAGEM do seed>/status` com `EM_DESMONTE` | 422 (desmonte sem triagem) |
| 5 | `POST /equipamentos/<id>/triagem` e, em seguida, `PATCH …/estado-fisico` `RUIM` sem justificativa | 200 e depois 422 |
| 6 | Repetir uma alteração enviando a `versao` antiga | 409 |
| 7 | `POST /lotes` com um `codigoBarrasInterno` já existente num dos itens | 409 e **nenhum** lote novo criado |
| 8 | `GET /equipamentos/<id>/rastreio` | Histórico em ordem cronológica |
| 9 | `GET /relatorios/valor-residual` como `auditor` | 200 com totais |
| 10 | Encerrar com Ctrl+C | Log "servidor encerrado com sucesso", processo termina |

## 4. Observações sobre a AV1 (encontradas durante o desenvolvimento)

Não alterei nenhum arquivo de código da AV1. Registro aqui o que observei, para decisão sua:

1. **`tsx` não estava em `devDependencies`**, apesar de `npm test` e `npm run dev` o usarem. Corrigido no `package.json` (necessário também para a AV2).
2. **Datas de criação não são restauradas ao carregar do arquivo** (`Ativo` sempre define `criadoEm = agora` e o `deJSON` não o restaura). Efeito: o `rastreio` do CLI mostra o horário da leitura, e a depreciação por idade do equipamento é sempre ~0. A AV2 não é afetada (lê `criadoEm` do banco). Correção sugerida: aceitar `criadoEm` opcional no construtor de `Ativo` e repassá-lo nos `deJSON`.
3. **`lote criar` sem `--data` usa a data em UTC**; à noite no Brasil (UTC−3) isso já é "amanhã" e a validação rejeita como data futura. A AV2 usa o calendário local do servidor.
