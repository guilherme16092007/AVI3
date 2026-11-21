-- AV3: camada analitica, API publica (chaves de API) e fila de tarefas.
-- Migration ADITIVA: apenas CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT em objetos NOVOS.
-- Nenhuma tabela, coluna, dado ou trigger da AV2 e alterado ou removido.

-- CreateEnum
CREATE TYPE "PermissaoApi" AS ENUM ('RASTREABILIDADE_LER', 'LOTES_LER', 'LOTES_ESCREVER', 'ANALISES_LER', 'RELATORIOS_GERAR');

-- CreateEnum
CREATE TYPE "TipoRelatorio" AS ENUM ('EFICIENCIA_OPERACIONAL', 'RENTABILIDADE_EQUIPAMENTO', 'VIDA_UTIL_REMANESCENTE');

-- CreateEnum
CREATE TYPE "OrigemRelatorio" AS ENUM ('MANUAL', 'AGENDADO', 'API');

-- CreateEnum
CREATE TYPE "StatusTarefa" AS ENUM ('PENDENTE', 'EM_EXECUCAO', 'CONCLUIDA', 'FALHA');

-- CreateEnum
CREATE TYPE "FormatoSaida" AS ENUM ('JSON', 'CSV');

-- CreateTable
CREATE TABLE "ChaveApi" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "prefixo" VARCHAR(16) NOT NULL,
    "hashChave" VARCHAR(64) NOT NULL,
    "permissoes" "PermissaoApi"[],
    "organizacaoId" UUID,
    "usuarioServicoId" UUID,
    "limitePorMinuto" INTEGER NOT NULL DEFAULT 60,
    "expiraEm" TIMESTAMP(3),
    "revogadaEm" TIMESTAMP(3),
    "ultimoUsoEm" TIMESTAMP(3),
    "criadoPorId" UUID NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ChaveApi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelatorioAnalitico" (
    "id" UUID NOT NULL,
    "tipo" "TipoRelatorio" NOT NULL,
    "origem" "OrigemRelatorio" NOT NULL,
    "organizacaoId" UUID,
    "parametros" JSONB NOT NULL DEFAULT '{}',
    "resultado" JSONB NOT NULL,
    "versaoModelo" TEXT NOT NULL DEFAULT '1',
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "solicitanteId" UUID,
    "chaveApiId" UUID,

    CONSTRAINT "RelatorioAnalitico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrevisaoVidaUtilTipo" (
    "id" UUID NOT NULL,
    "relatorioId" UUID NOT NULL,
    "tipoEquipamento" "TipoEquipamento" NOT NULL,
    "modelo" TEXT NOT NULL,
    "amostras" INTEGER NOT NULL,
    "inclinacaoPorDia" DOUBLE PRECISION NOT NULL,
    "interceptoEstado" DOUBLE PRECISION NOT NULL,
    "r2" DOUBLE PRECISION,
    "diasRestantesMediana" DOUBLE PRECISION,
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrevisaoVidaUtilTipo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrevisaoEquipamento" (
    "id" UUID NOT NULL,
    "relatorioId" UUID NOT NULL,
    "equipamentoId" UUID NOT NULL,
    "estadoAtual" INTEGER NOT NULL,
    "diasRestantes" DOUBLE PRECISION,
    "dataProjetadaInservivel" TIMESTAMP(3),
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrevisaoEquipamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tarefa" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'GERAR_RELATORIO',
    "status" "StatusTarefa" NOT NULL DEFAULT 'PENDENTE',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "formato" "FormatoSaida" NOT NULL DEFAULT 'JSON',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "maxTentativas" INTEGER NOT NULL DEFAULT 3,
    "proximaExecucaoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciadaEm" TIMESTAMP(3),
    "bloqueadaAte" TIMESTAMP(3),
    "concluidaEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "relatorioId" UUID,
    "resultadoConteudo" TEXT,
    "resultadoMime" TEXT,
    "chaveIdempotencia" TEXT,
    "solicitanteId" UUID,
    "chaveApiId" UUID,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChaveApi_prefixo_key" ON "ChaveApi"("prefixo");

-- CreateIndex
CREATE INDEX "ChaveApi_organizacaoId_idx" ON "ChaveApi"("organizacaoId");

-- CreateIndex
CREATE INDEX "RelatorioAnalitico_tipo_organizacaoId_geradoEm_idx" ON "RelatorioAnalitico"("tipo", "organizacaoId", "geradoEm");

-- CreateIndex
CREATE INDEX "RelatorioAnalitico_geradoEm_idx" ON "RelatorioAnalitico"("geradoEm");

-- CreateIndex
CREATE UNIQUE INDEX "PrevisaoVidaUtilTipo_relatorioId_tipoEquipamento_key" ON "PrevisaoVidaUtilTipo"("relatorioId", "tipoEquipamento");

-- CreateIndex
CREATE INDEX "PrevisaoEquipamento_equipamentoId_geradoEm_idx" ON "PrevisaoEquipamento"("equipamentoId", "geradoEm");

-- CreateIndex
CREATE UNIQUE INDEX "PrevisaoEquipamento_relatorioId_equipamentoId_key" ON "PrevisaoEquipamento"("relatorioId", "equipamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "Tarefa_chaveIdempotencia_key" ON "Tarefa"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "Tarefa_status_proximaExecucaoEm_idx" ON "Tarefa"("status", "proximaExecucaoEm");

-- CreateIndex
CREATE INDEX "Tarefa_chaveApiId_status_idx" ON "Tarefa"("chaveApiId", "status");

-- AddForeignKey
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_usuarioServicoId_fkey" FOREIGN KEY ("usuarioServicoId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatorioAnalitico" ADD CONSTRAINT "RelatorioAnalitico_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatorioAnalitico" ADD CONSTRAINT "RelatorioAnalitico_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatorioAnalitico" ADD CONSTRAINT "RelatorioAnalitico_chaveApiId_fkey" FOREIGN KEY ("chaveApiId") REFERENCES "ChaveApi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrevisaoVidaUtilTipo" ADD CONSTRAINT "PrevisaoVidaUtilTipo_relatorioId_fkey" FOREIGN KEY ("relatorioId") REFERENCES "RelatorioAnalitico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrevisaoEquipamento" ADD CONSTRAINT "PrevisaoEquipamento_relatorioId_fkey" FOREIGN KEY ("relatorioId") REFERENCES "RelatorioAnalitico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrevisaoEquipamento" ADD CONSTRAINT "PrevisaoEquipamento_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_relatorioId_fkey" FOREIGN KEY ("relatorioId") REFERENCES "RelatorioAnalitico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_chaveApiId_fkey" FOREIGN KEY ("chaveApiId") REFERENCES "ChaveApi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Regras de integridade no banco (mesmo padrao da migration da AV2)
-- ---------------------------------------------------------------------
ALTER TABLE "ChaveApi"           ADD CONSTRAINT "ck_chaveapi_versao"          CHECK ("versao" >= 1);
ALTER TABLE "Tarefa"             ADD CONSTRAINT "ck_tarefa_versao"            CHECK ("versao" >= 1);

ALTER TABLE "ChaveApi" ADD CONSTRAINT "ck_chaveapi_permissoes"
  CHECK ("permissoes" IS NOT NULL AND cardinality("permissoes") > 0);
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ck_chaveapi_hash"
  CHECK ("hashChave" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ck_chaveapi_limite"
  CHECK ("limitePorMinuto" BETWEEN 1 AND 100000);
-- escrever lotes exige um usuario de servico (a quem os movimentos sao atribuidos para auditoria)
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ck_chaveapi_escrita_usuario"
  CHECK (NOT ('LOTES_ESCREVER' = ANY ("permissoes")) OR "usuarioServicoId" IS NOT NULL);

ALTER TABLE "Tarefa" ADD CONSTRAINT "ck_tarefa_tentativas"
  CHECK ("tentativas" >= 0 AND "maxTentativas" BETWEEN 1 AND 20);
ALTER TABLE "Tarefa" ADD CONSTRAINT "ck_tarefa_concluida"
  CHECK ("status" <> 'CONCLUIDA' OR "concluidaEm" IS NOT NULL);

ALTER TABLE "PrevisaoEquipamento" ADD CONSTRAINT "ck_previsaoequip_estado"
  CHECK ("estadoAtual" BETWEEN 0 AND 4);
ALTER TABLE "PrevisaoVidaUtilTipo" ADD CONSTRAINT "ck_previsaotipo_amostras"
  CHECK ("amostras" >= 0);
