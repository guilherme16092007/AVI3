import { CronParseado, parseCron, proximaExecucao } from "./cron";
import { LoggerFila } from "./ProcessadorTarefas";

interface Agendamento {
  nome: string;
  cron: CronParseado;
  acao: (slot: Date) => Promise<void>;
  timer?: NodeJS.Timeout;
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Agendador por tempo (equivalente ao node-cron). Cada disparo recebe o `slot` (instante cron nominal), que a
 * acao usa como chave de idempotencia: com varias instancias da aplicacao, so uma tarefa por slot e criada.
 */
export class AgendadorTarefas {
  private readonly itens: Agendamento[] = [];
  private ativo = false;

  constructor(private readonly log?: LoggerFila, private readonly relogio: () => Date = () => new Date()) {}

  agendar(nome: string, expressao: string, acao: (slot: Date) => Promise<void>): void {
    this.itens.push({ nome, cron: parseCron(expressao), acao });
  }

  /** Dispara a acao de um agendamento para um slot (usado pelo timer e pelos testes). */
  async dispararSlot(nome: string, slot: Date): Promise<void> {
    const item = this.itens.find((i) => i.nome === nome);
    if (!item) throw new Error(`Agendamento '${nome}' inexistente.`);
    try {
      await item.acao(slot);
      this.log?.info({ agendamento: nome, slot: slot.toISOString() }, "agendamento executado");
    } catch (erro) {
      this.log?.error({ agendamento: nome, err: erro }, "falha ao executar agendamento");
    }
  }

  iniciar(): void {
    if (this.ativo) return;
    this.ativo = true;
    for (const item of this.itens) this.armar(item);
  }

  private armar(item: Agendamento): void {
    if (!this.ativo) return;
    const slot = proximaExecucao(item.cron, this.relogio());
    if (!slot) return;
    const espera = Math.max(slot.getTime() - this.relogio().getTime(), 0);
    item.timer = setTimeout(() => {
      if (espera > MAX_TIMEOUT_MS) return this.armar(item); // espera longa: rearma em fatias
      void this.dispararSlot(item.nome, slot).finally(() => this.armar(item));
    }, Math.min(espera, MAX_TIMEOUT_MS));
    item.timer.unref();
  }

  parar(): void {
    this.ativo = false;
    for (const i of this.itens) if (i.timer) clearTimeout(i.timer);
  }
}
