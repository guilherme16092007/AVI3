import { ErroValidacao } from "../../types";
import { nomeArquivoRelatorio, renderizarRelatorio } from "../analise/exportacao";
import { ErroConflito, ErroLimiteExcedido, ErroNaoEncontrado, ErroPermissao } from "../erros";
import { Dependencias, FiltroTarefa, Pagina, Paginacao, ResultadoTarefa, TarefaRegistro } from "../repositorios/portas";
import { FormatoSaida, OrigemRelatorio, PermissaoApi, StatusTarefa, TipoRelatorio } from "../tiposAv3";
import { AnaliseServico } from "./AnaliseServico";
import { ChaveApiAutenticada, exigirPermissaoApi } from "./ChaveApiServico";
import { paraTarefaDto, TarefaDto } from "./dtoAv3";
import { Ator, exigirPapel, PERMISSOES } from "./politicas";
import { exigirEncontrado, mapearPagina, novoId } from "./util";

export type Solicitante = { tipo: "USUARIO"; ator: Ator } | { tipo: "CHAVE_API"; chave: ChaveApiAutenticada };

export interface SolicitarRelatorioEntrada {
  tipo: TipoRelatorio;
  formato?: FormatoSaida;
  organizacaoId?: string | null;
}

export interface PayloadRelatorio {
  tipo: TipoRelatorio;
  organizacaoId: string | null;
  origem: OrigemRelatorio;
}

export interface ConfiguracaoFila {
  maxTentativas: number;
  limiteTarefasAtivasPorChave: number;
}

export interface ArquivoBaixavel {
  conteudo: string;
  mime: string;
  nomeArquivo: string;
}

/**
 * Processamento assincrono de relatorios: a requisicao apenas ENFILEIRA a tarefa (202 + identificador);
 * o worker gera o relatorio e o cliente consulta o status (polling) e baixa o arquivo quando CONCLUIDA.
 */
export class RelatorioAssincronoServico {
  constructor(
    private readonly dep: Dependencias,
    private readonly analises: AnaliseServico,
    private readonly config: ConfiguracaoFila,
    private readonly relogio: () => Date = () => new Date()
  ) {}

  async solicitar(solicitante: Solicitante, entrada: SolicitarRelatorioEntrada): Promise<TarefaDto> {
    let organizacaoId = entrada.organizacaoId ?? null;
    let origem = OrigemRelatorio.MANUAL;
    let solicitanteId: string | null = null;
    let chaveApiId: string | null = null;

    if (solicitante.tipo === "USUARIO") {
      exigirPapel(solicitante.ator, PERMISSOES.analiseGerar);
      solicitanteId = solicitante.ator.id;
    } else {
      const chave = solicitante.chave;
      exigirPermissaoApi(chave, PermissaoApi.RELATORIOS_GERAR);
      if (chave.organizacaoId) {
        if (organizacaoId && organizacaoId !== chave.organizacaoId) {
          throw new ErroPermissao("Esta chave de API so pode solicitar relatorios da sua propria organizacao.");
        }
        organizacaoId = chave.organizacaoId;
      }
      const ativas = await this.dep.repos.tarefas.contarAtivas(chave.id);
      if (ativas >= this.config.limiteTarefasAtivasPorChave) {
        throw new ErroLimiteExcedido(
          `Limite de ${this.config.limiteTarefasAtivasPorChave} relatorios em processamento simultaneo atingido. Aguarde a conclusao de algum e tente novamente.`,
          "LIMITE_TAREFAS_ATIVAS"
        );
      }
      origem = OrigemRelatorio.API;
      chaveApiId = chave.id;
    }

    if (organizacaoId) {
      exigirEncontrado(await this.dep.repos.organizacoes.buscarPorId(organizacaoId), "Organizacao nao encontrada.");
    }

    const payload: PayloadRelatorio = { tipo: entrada.tipo, organizacaoId, origem };
    const { tarefa } = await this.dep.repos.tarefas.criar({
      id: novoId(),
      tipo: "GERAR_RELATORIO",
      payload,
      formato: entrada.formato ?? FormatoSaida.JSON,
      maxTentativas: this.config.maxTentativas,
      proximaExecucaoEm: this.relogio(),
      chaveIdempotencia: null,
      solicitanteId,
      chaveApiId,
    });
    return paraTarefaDto(tarefa);
  }

  /** Usado pelo agendador: idempotente por (tipo, slot), seguro com varias instancias da aplicacao. */
  async enfileirarAgendado(tipo: TipoRelatorio, slot: Date): Promise<boolean> {
    const payload: PayloadRelatorio = { tipo, organizacaoId: null, origem: OrigemRelatorio.AGENDADO };
    const { criada } = await this.dep.repos.tarefas.criar({
      id: novoId(),
      tipo: "GERAR_RELATORIO",
      payload,
      formato: FormatoSaida.JSON,
      maxTentativas: this.config.maxTentativas,
      proximaExecucaoEm: this.relogio(),
      chaveIdempotencia: `agendado:${tipo}:${slot.toISOString()}`,
      solicitanteId: null,
      chaveApiId: null,
    });
    return criada;
  }

  async consultar(solicitante: Solicitante, id: string): Promise<TarefaDto> {
    return paraTarefaDto(await this.buscarAutorizada(solicitante, id));
  }

  async baixar(solicitante: Solicitante, id: string): Promise<ArquivoBaixavel> {
    const tarefa = await this.buscarAutorizada(solicitante, id);
    if (tarefa.status !== StatusTarefa.CONCLUIDA || tarefa.resultadoConteudo === null || !tarefa.relatorioId) {
      throw new ErroConflito(`O relatorio ainda nao esta disponivel (status: ${tarefa.status}). Consulte o status e tente novamente.`, {
        status: tarefa.status,
      });
    }
    const payload = tarefa.payload as PayloadRelatorio;
    return {
      conteudo: tarefa.resultadoConteudo,
      mime: tarefa.resultadoMime ?? "application/octet-stream",
      nomeArquivo: nomeArquivoRelatorio(payload.tipo, tarefa.relatorioId, tarefa.formato),
    };
  }

  async listar(ator: Ator, filtro: FiltroTarefa, paginacao: Paginacao): Promise<Pagina<TarefaDto>> {
    exigirPapel(ator, PERMISSOES.analiseVer);
    return mapearPagina(await this.dep.repos.tarefas.listar(filtro, paginacao), paraTarefaDto);
  }

  /** Handler do worker: gera + persiste o relatorio e devolve o arquivo (JSON/CSV) a ser guardado na tarefa. */
  async executar(tarefa: TarefaRegistro): Promise<ResultadoTarefa> {
    const payload = this.lerPayload(tarefa.payload);
    const relatorio = await this.analises.gerarEPersistir(payload.tipo, {
      organizacaoId: payload.organizacaoId,
      origem: payload.origem,
      solicitanteId: tarefa.solicitanteId,
      chaveApiId: tarefa.chaveApiId,
    });
    const arquivo = renderizarRelatorio(payload.tipo, relatorio.resultado, tarefa.formato, relatorio.id);
    return { relatorioId: relatorio.id, conteudo: arquivo.conteudo, mime: arquivo.mime };
  }

  private lerPayload(bruto: unknown): PayloadRelatorio {
    const p = (bruto ?? {}) as Partial<PayloadRelatorio>;
    if (!p.tipo || !Object.values(TipoRelatorio).includes(p.tipo)) {
      throw new ErroValidacao("Payload da tarefa invalido: tipo de relatorio desconhecido.", ["tipo"]);
    }
    return { tipo: p.tipo, organizacaoId: p.organizacaoId ?? null, origem: p.origem ?? OrigemRelatorio.MANUAL };
  }

  /** Tarefas de outra chave/usuario aparecem como inexistentes (404) para nao vazar a existencia do identificador. */
  private async buscarAutorizada(solicitante: Solicitante, id: string): Promise<TarefaRegistro> {
    if (solicitante.tipo === "USUARIO") {
      exigirPapel(solicitante.ator, PERMISSOES.analiseVer);
      return exigirEncontrado(await this.dep.repos.tarefas.buscarPorId(id), "Tarefa nao encontrada.");
    }
    exigirPermissaoApi(solicitante.chave, PermissaoApi.RELATORIOS_GERAR);
    const tarefa = await this.dep.repos.tarefas.buscarPorId(id);
    if (!tarefa || tarefa.chaveApiId !== solicitante.chave.id) throw new ErroNaoEncontrado("Tarefa nao encontrada.");
    return tarefa;
  }
}
