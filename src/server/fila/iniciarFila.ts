import { Ambiente } from "../config/env";
import { Repositorios } from "../repositorios/portas";
import { Servicos } from "../servicos";
import { TipoRelatorio } from "../tiposAv3";
import { AgendadorTarefas } from "./AgendadorTarefas";
import { LoggerFila, ProcessadorTarefas } from "./ProcessadorTarefas";

export interface InfraFila {
  processador: ProcessadorTarefas;
  agendador: AgendadorTarefas;
  iniciar(): void;
  parar(): Promise<void>;
}

/** Monta worker + agendador a partir do ambiente (usado pelo servidor HTTP e pelo processo worker dedicado). */
export function criarInfraFila(servicos: Servicos, repos: Repositorios, ambiente: Ambiente, log?: LoggerFila): InfraFila {
  const processador = new ProcessadorTarefas({
    tarefas: repos.tarefas,
    executar: (t) => servicos.relatoriosAssincronos.executar(t),
    concorrencia: ambiente.WORKER_CONCORRENCIA,
    intervaloMs: ambiente.WORKER_INTERVALO_MS,
    leaseMs: ambiente.JOBS_LEASE_MS,
    backoffBaseMs: ambiente.JOBS_BACKOFF_BASE_MS,
    log,
  });

  const agendador = new AgendadorTarefas(log);
  if (ambiente.ANALISE_CRON) {
    agendador.agendar("analises-recorrentes", ambiente.ANALISE_CRON, async (slot) => {
      for (const tipo of Object.values(TipoRelatorio)) await servicos.relatoriosAssincronos.enfileirarAgendado(tipo, slot);
    });
  }

  return {
    processador,
    agendador,
    iniciar: () => {
      processador.iniciar();
      agendador.iniciar();
    },
    parar: async () => {
      agendador.parar();
      await processador.parar();
    },
  };
}
