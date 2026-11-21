import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { carregarAmbiente } from "./config/env";
import { criarInfraFila } from "./fila/iniciarFila";
import { criarRepositoriosPrisma, ExecutorTransacaoPrisma } from "./repositorios/prisma";
import { criarServicos } from "./servicos";

/**
 * Processo worker dedicado (sem HTTP): permite escalar horizontalmente o processamento de relatorios
 * independentemente da API. Use junto com WORKER_HABILITADO=false nas instancias da API.
 */
async function main(): Promise<void> {
  const ambiente = carregarAmbiente();
  const prisma = new PrismaClient();
  const repos = criarRepositoriosPrisma(prisma);
  const servicos = criarServicos(
    { repos, transacao: new ExecutorTransacaoPrisma(prisma) },
    { maxTentativasTarefa: ambiente.JOBS_MAX_TENTATIVAS }
  );
  const log = {
    info: (o: object, m?: string) => console.log(JSON.stringify({ nivel: "info", msg: m, ...o })),
    warn: (o: object, m?: string) => console.warn(JSON.stringify({ nivel: "warn", msg: m, ...o })),
    error: (o: object, m?: string) => console.error(JSON.stringify({ nivel: "error", msg: m, ...o })),
  };
  const fila = criarInfraFila(servicos, repos, ambiente, log);
  fila.iniciar();
  log.info({ concorrencia: ambiente.WORKER_CONCORRENCIA, cron: ambiente.ANALISE_CRON || "desligado" }, "worker iniciado");

  let encerrando = false;
  const encerrar = async (sinal: string): Promise<void> => {
    if (encerrando) return;
    encerrando = true;
    log.info({ sinal }, "encerrando worker (aguardando tarefas em andamento)");
    const limite = setTimeout(() => process.exit(1), ambiente.SHUTDOWN_TIMEOUT_MS);
    limite.unref();
    await fila.parar();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void encerrar("SIGINT"));
  process.on("SIGTERM", () => void encerrar("SIGTERM"));
}

main().catch((erro) => {
  console.error("Falha ao iniciar o worker:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
