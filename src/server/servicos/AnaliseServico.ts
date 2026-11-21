import { arredondar, mediana, media } from "../analise/estatistica";
import { VidaUtilResultado } from "../analise/vidaUtil";
import { Dependencias, FiltroRelatorio, NovaPrevisaoEquipamento, NovaPrevisaoTipo, Pagina, Paginacao } from "../repositorios/portas";
import { OrigemRelatorio, TipoRelatorio } from "../tiposAv3";
import { AnaliseEficienciaServico } from "./AnaliseEficienciaServico";
import { AnaliseRentabilidadeServico } from "./AnaliseRentabilidadeServico";
import { AnaliseVidaUtilServico } from "./AnaliseVidaUtilServico";
import { paraRelatorioDto, paraRelatorioResumoDto, RelatorioDto } from "./dtoAv3";
import { Ator, exigirPapel, PERMISSOES } from "./politicas";
import { exigirEncontrado, novoId } from "./util";
import { ErroNaoEncontrado } from "../erros";
import { MS_POR_DIA } from "../analise/estatistica";

/** Versao do modelo/formato dos resultados persistidos (permite comparar relatorios de epocas distintas). */
export const VERSAO_MODELO = "1";

export interface ContextoGeracao {
  organizacaoId: string | null;
  origem: OrigemRelatorio;
  solicitanteId?: string | null;
  chaveApiId?: string | null;
}

export type ResultadoAnalise = Awaited<ReturnType<AnaliseServico["calcular"]>>;

/**
 * Orquestra os tres servicos analiticos independentes, persiste os resultados (historico consultavel)
 * e mede a acuracia das previsoes passadas contra o que de fato aconteceu.
 */
export class AnaliseServico {
  readonly eficiencia: AnaliseEficienciaServico;
  readonly rentabilidade: AnaliseRentabilidadeServico;
  readonly vidaUtil: AnaliseVidaUtilServico;

  constructor(private readonly dep: Dependencias, private readonly relogio: () => Date = () => new Date()) {
    this.eficiencia = new AnaliseEficienciaServico(dep, relogio);
    this.rentabilidade = new AnaliseRentabilidadeServico(dep, relogio);
    this.vidaUtil = new AnaliseVidaUtilServico(dep, relogio);
  }

  /** Calculo sem autorizacao (uso interno do worker e de servicos que ja autorizaram o chamador). */
  async calcular(tipo: TipoRelatorio, filtro: { organizacaoId?: string }) {
    switch (tipo) {
      case TipoRelatorio.EFICIENCIA_OPERACIONAL:
        return this.eficiencia.calcular(filtro);
      case TipoRelatorio.RENTABILIDADE_EQUIPAMENTO:
        return this.rentabilidade.calcular(filtro);
      case TipoRelatorio.VIDA_UTIL_REMANESCENTE:
        return this.vidaUtil.calcular(filtro);
    }
  }

  /** Calcula e PERSISTE o relatorio (e, no caso de vida util, as previsoes normalizadas para medir acuracia). */
  async gerarEPersistir(tipo: TipoRelatorio, contexto: ContextoGeracao): Promise<RelatorioDto> {
    await this.exigirOrganizacao(contexto.organizacaoId);
    const resultado = await this.calcular(tipo, { organizacaoId: contexto.organizacaoId ?? undefined });
    const geradoEm = this.relogio();

    let previsoesTipo: NovaPrevisaoTipo[] | undefined;
    let previsoesEquipamento: NovaPrevisaoEquipamento[] | undefined;
    if (tipo === TipoRelatorio.VIDA_UTIL_REMANESCENTE) {
      const vida = resultado as VidaUtilResultado;
      previsoesTipo = vida.porTipo.map((t) => ({
        id: novoId(),
        tipoEquipamento: t.tipo,
        modelo: t.modelo,
        amostras: t.amostras,
        inclinacaoPorDia: t.inclinacaoPorDia,
        interceptoEstado: t.interceptoEstado,
        r2: t.r2,
        diasRestantesMediana: t.vidaUtilRestanteDias?.mediana ?? null,
      }));
      previsoesEquipamento = vida.equipamentos
        .filter((e) => e.dataProjetadaInservivel !== null)
        .map((e) => ({
          id: novoId(),
          equipamentoId: e.equipamentoId,
          estadoAtual: e.estadoAtualNumerico,
          diasRestantes: e.diasRestantes,
          dataProjetadaInservivel: new Date(`${e.dataProjetadaInservivel}T00:00:00.000Z`),
        }));
    }

    const salvo = await this.dep.repos.relatorios.salvar({
      id: novoId(),
      tipo,
      origem: contexto.origem,
      organizacaoId: contexto.organizacaoId,
      parametros: { organizacaoId: contexto.organizacaoId },
      resultado,
      versaoModelo: VERSAO_MODELO,
      geradoEm,
      solicitanteId: contexto.solicitanteId ?? null,
      chaveApiId: contexto.chaveApiId ?? null,
      previsoesTipo,
      previsoesEquipamento,
    });
    return paraRelatorioDto(salvo);
  }

  /** Ultimo relatorio persistido do escopo (organizacaoId null = global). */
  async ultimo(tipo: TipoRelatorio, organizacaoId: string | null): Promise<RelatorioDto> {
    const relatorio = await this.dep.repos.relatorios.ultimo(tipo, organizacaoId);
    if (!relatorio) {
      throw new ErroNaoEncontrado(
        "Nenhum relatorio gerado ainda para este escopo. Solicite a geracao em POST /api/v1/public/relatorios (ou aguarde a execucao agendada)."
      );
    }
    return paraRelatorioDto(relatorio);
  }

  // ----- operacoes autorizadas por papel (API interna, JWT) -----

  async calcularAoVivo(ator: Ator, tipo: TipoRelatorio, filtro: { organizacaoId?: string }) {
    exigirPapel(ator, PERMISSOES.analiseVer);
    await this.exigirOrganizacao(filtro.organizacaoId ?? null);
    return this.calcular(tipo, filtro);
  }

  async gerarManual(ator: Ator, tipo: TipoRelatorio, organizacaoId: string | null): Promise<RelatorioDto> {
    exigirPapel(ator, PERMISSOES.analiseGerar);
    return this.gerarEPersistir(tipo, { organizacaoId, origem: OrigemRelatorio.MANUAL, solicitanteId: ator.id });
  }

  async historico(ator: Ator, filtro: FiltroRelatorio, paginacao: Paginacao) {
    exigirPapel(ator, PERMISSOES.analiseVer);
    const pagina = await this.dep.repos.relatorios.listar(filtro, paginacao);
    return { ...pagina, itens: pagina.itens.map(paraRelatorioResumoDto) } as Pagina<ReturnType<typeof paraRelatorioResumoDto>>;
  }

  async detalhar(ator: Ator, id: string): Promise<RelatorioDto> {
    exigirPapel(ator, PERMISSOES.analiseVer);
    return paraRelatorioDto(exigirEncontrado(await this.dep.repos.relatorios.buscarPorId(id), "Relatorio nao encontrado."));
  }

  /**
   * Compara previsoes de vida util (persistidas) com as realizacoes: equipamentos que de fato chegaram a
   * INSERVIVEL depois da previsao. Erro = dias reais - dias previstos (positivo: durou MAIS que o previsto).
   */
  async acuracia(ator: Ator) {
    exigirPapel(ator, PERMISSOES.analiseVer);
    const realizadas = await this.dep.repos.relatorios.previsoesRealizadas();
    const avaliadas = realizadas
      .filter((p) => p.diasRestantesPrevistos !== null)
      .map((p) => {
        const diasReais = (p.inservivelEm.getTime() - p.geradoEm.getTime()) / MS_POR_DIA;
        const erroDias = diasReais - (p.diasRestantesPrevistos as number);
        return {
          equipamentoId: p.equipamentoId,
          relatorioId: p.relatorioId,
          diasPrevistos: arredondar(p.diasRestantesPrevistos, 1) as number,
          diasReais: arredondar(diasReais, 1) as number,
          erroDias: arredondar(erroDias, 1) as number,
        };
      });
    const erros = avaliadas.map((a) => a.erroDias);
    const absolutos = erros.map(Math.abs);
    return {
      geradoEm: this.relogio().toISOString(),
      previsoesAvaliadas: avaliadas.length,
      erroMedioDias: arredondar(media(erros), 1),
      erroAbsolutoMedioDias: arredondar(media(absolutos), 1),
      erroAbsolutoMedianoDias: arredondar(mediana(absolutos), 1),
      interpretacao:
        "erroDias = dias reais - dias previstos; positivo significa que o equipamento durou mais do que o previsto. Somente previsoes ja realizadas (equipamento chegou a INSERVIVEL apos a previsao) entram na conta.",
      itens: avaliadas.slice(0, 100),
    };
  }

  private async exigirOrganizacao(organizacaoId: string | null | undefined): Promise<void> {
    if (!organizacaoId) return;
    exigirEncontrado(await this.dep.repos.organizacoes.buscarPorId(organizacaoId), "Organizacao nao encontrada.");
  }
}
