# AV3 — Instalação, execução e testes

Compatível com **Windows 10 ou superior**, **Ubuntu 24.04.03 ou superior** e derivadas: a AV3 **não adiciona dependências** nem exige Redis ou binários nativos novos — só Node.js 18.18+ e PostgreSQL 14+ (como na AV2).

## Instalação (sobre a cópia da AV2)

```bash
# 1. extraia GreenCode_AV3_Arquivos_Atualizados.zip sobre a pasta da AV2 (mesmos caminhos; aceite substituir)
npm install                       # nenhuma dependência nova; apenas atualiza metadados
cp .env.example .env              # só se ainda não tiver .env; acrescente as variáveis AV3 (abaixo) ao seu .env existente
docker compose up -d              # PostgreSQL (ou use o seu)
npx prisma migrate deploy         # aplica SOMENTE a migration nova (aditiva; não toca nos dados da AV2)
npm run db:seed                   # opcional (banco vazio): massa de exemplo + chave de API de demonstração
npm run build:server
npm run start:server              # API + worker + agendador no mesmo processo
```

No Windows (PowerShell) troque `cp` por `Copy-Item .env.example .env`.

**Processo worker separado** (escala independente; use `WORKER_HABILITADO=false` nas instâncias da API): `npm run start:worker`.

## Variáveis novas (todas opcionais, com padrão)

`WORKER_HABILITADO` (true) · `WORKER_CONCORRENCIA` (2) · `WORKER_INTERVALO_MS` (2000) · `JOBS_MAX_TENTATIVAS` (3) · `JOBS_BACKOFF_BASE_MS` (5000) · `JOBS_LEASE_MS` (300000) · `JOBS_LIMITE_ATIVAS_POR_CHAVE` (5) · `ANALISE_CRON` (`0 2 * * *`, vazio desliga) · `API_LIMITE_PADRAO_POR_MINUTO` (60) · `API_LIMITE_IP_POR_MINUTO` (30). Valores inválidos impedem a inicialização com mensagem clara.

## Testes

```bash
npm test            # AV1 + AV2 + AV3
npm run test:av3    # somente a AV3
npm run test:http   # HTTP da AV2 (regressão)
```

`test:av3` roda: `analise.test.ts` (estatística, CSV, eficiência, rentabilidade, vida útil), `fila.test.ts` (cron, retry/backoff, lease, concorrência, idempotência, agendador, limitador, ambiente) e `publica.test.ts` (HTTP de ponta a ponta: chaves, permissões, escopo, rate limit, fila assíncrona, API interna, acurácia, OpenAPI, regressão da AV2). Usam repositórios em memória (as mesmas portas dos repositórios Prisma), sem precisar de banco.

## Verificação manual rápida

1. `npm run db:seed` imprime uma `X-API-Key` de demonstração (escopo: Hospital Central).
2. Abra `http://localhost:3000/api/v1/public/docs`, clique **Authorize**, cole a chave e teste `GET /me`, `GET /lotes`, `POST /relatorios`.
3. Veja o histórico: `GET /api/v1/internal/analises/historico` (JWT de admin/auditor).
