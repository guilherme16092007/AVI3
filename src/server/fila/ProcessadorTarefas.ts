import { ResultadoTarefa, TarefaRegistro, TarefaRepositorio } from "../repositorios/portas";
import { calcularBackoffMs, erroRecuperavel } from "./politicaRetry";

export interface LoggerFila {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface OpcoesProcessador {
  tarefas: TarefaRepositorio;
  executar: (tarefa: TarefaRegistro) => Promise<ResultadoTarefa>;
  concorrencia: number;
  intervaloMs: number;
  leaseMs: number;
  backoffBaseMs: number;
  backoffMaxMs?: number;
  relogio?: () => Date;
  aleatorio?: () => number;
  log?: LoggerFila;
}

const SEM_LOG: LoggerFila = { info: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * Worker da fila (polling no PostgreSQL). A cada ciclo: libera tarefas com lease vencido, reivindica ate
 * `concorrencia` tarefas e as executa em paralelo. Falhas sofrem retry com backoff exponencial ate
 * `maxTentativas` (definido por tarefa); depois ficam FALHA com o ultimo erro registrado.
 */
export class ProcessadorTarefas {
  private ativo = false;
  private timer: NodeJS.Timeout | undefined;
  private cicloAtual: Promise<void> = Promise.resolve();
  private acordar: (() => void) | undefined;

  constructor(private readonly o: OpcoesProcessador) {}

  private get agora(): Date {
    return (this.o.relogio ?? (() => new Date()))();
  }
  private get log(): LoggerFila {
    return this.o.log ?? SEM_LOG;
  }

  /** Executa um ciclo completo e devolve quantas tarefas foram processadas (publico para testes e drenagem). */
  async processarCiclo(): Promise<number> {
    const liberadas = await this.o.tarefas.liberarExpiradas(this.agora);
    if (liberadas > 0) this.log.warn({ liberadas }, "tarefas com lease expirado devolvidas a fila");

    const lote = await this.o.tarefas.reivindicar(this.agora, this.o.leaseMs, this.o.concorrencia);
    await Promise.all(lote.map((t) => this.executarUma(t)));
    return lote.length;
  }

  private async executarUma(tarefa: TarefaRegistro): Promise<void> {
    try {
      const resultado = await this.o.executar(tarefa);
      await this.o.tarefas.concluir(tarefa.id, resultado, this.agora);
      this.log.info({ tarefaId: tarefa.id, tentativa: tarefa.tentativas }, "tarefa concluida");
    } catch (erro) {
      await this.tratarFalha(tarefa, erro);
    }
  }

  private async tratarFalha(tarefa: TarefaRegistro, erro: unknown): Promise<void> {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    const esgotada = tarefa.tentativas >= tarefa.maxTentativas;
    const definitiva = esgotada || !erroRecuperavel(erro);
    const agora = this.agora;
    const proxima = definitiva
      ? null
      : new Date(
          agora.getTime() +
            calcularBackoffMs(tarefa.tentativas, {
              baseMs: this.o.backoffBaseMs,
              maxMs: this.o.backoffMaxMs ?? 300_000,
              aleatorio: this.o.aleatorio,
            })
        );
    try {
      await this.o.tarefas.registrarFalha(tarefa.id, mensagem, proxima, agora);
      this.log.warn(
        { tarefaId: tarefa.id, tentativa: tarefa.tentativas, maxTentativas: tarefa.maxTentativas, definitiva, proximaEm: proxima?.toISOString(), erro: mensagem },
        definitiva ? "tarefa falhou definitivamente" : "tarefa falhou; novo retry agendado"
      );
    } catch (e) {
      this.log.error({ tarefaId: tarefa.id, err: e }, "nao foi possivel registrar a falha da tarefa (o lease expirara e ela sera recuperada)");
    }
  }

  iniciar(): void {
    if (this.ativo) return;
    this.ativo = true;
    const laco = async (): Promise<void> => {
      while (this.ativo) {
        let processadas = 0;
        try {
          processadas = await this.processarCiclo();
        } catch (erro) {
          this.log.error({ err: erro }, "falha no ciclo do worker");
        }
        if (!this.ativo) break;
        if (processadas === 0) {
          await new Promise<void>((resolve) => {
            this.acordar = resolve;
            this.timer = setTimeout(resolve, this.o.intervaloMs);
          });
        }
      }
    };
    this.cicloAtual = laco();
  }

  /** Para de reivindicar novas tarefas e aguarda as em andamento terminarem (encerramento gracioso). */
  async parar(): Promise<void> {
    this.ativo = false;
    if (this.timer) clearTimeout(this.timer);
    this.acordar?.();
    await this.cicloAtual;
  }
}
