import { ErroValidacao } from "../../types";
import { ErroNaoEncontrado, ErroPermissao } from "../erros";
import { Dependencias, Paginacao } from "../repositorios/portas";
import { PermissaoApi, TipoRelatorio } from "../tiposAv3";
import { AnaliseServico } from "./AnaliseServico";
import { ChaveApiAutenticada, exigirPermissaoApi } from "./ChaveApiServico";
import { EquipamentoServico } from "./EquipamentoServico";
import { CriarLoteEntrada, LoteServico } from "./LoteServico";
import { RelatorioAssincronoServico, SolicitarRelatorioEntrada } from "./RelatorioAssincronoServico";
import { Ator } from "./politicas";

export type CriarLotePublicoEntrada = Omit<CriarLoteEntrada, "organizacaoId"> & { organizacaoId?: string };

/**
 * Fachada da API PUBLICA: aplica as permissoes da chave e o ESCOPO por organizacao antes de delegar
 * aos servicos de dominio ja existentes (LoteServico, EquipamentoServico). Nada de regra de negocio e duplicado.
 * Recursos fora do escopo da chave respondem 404 (nao revelam que existem).
 */
export class ParceiroServico {
  constructor(
    private readonly dep: Dependencias,
    private readonly lotes: LoteServico,
    private readonly equipamentos: EquipamentoServico,
    private readonly analises: AnaliseServico,
    private readonly assincronos: RelatorioAssincronoServico
  ) {}

  quemSou(chave: ChaveApiAutenticada) {
    return {
      id: chave.id,
      nome: chave.nome,
      prefixo: chave.prefixo,
      permissoes: chave.permissoes,
      escopo: chave.organizacaoId ? "ORGANIZACAO" : "GLOBAL",
      organizacaoId: chave.organizacaoId,
      limitePorMinuto: chave.limitePorMinuto,
    };
  }

  async rastrear(chave: ChaveApiAutenticada, equipamentoId: string) {
    exigirPermissaoApi(chave, PermissaoApi.RASTREABILIDADE_LER);
    const equipamento = await this.dep.repos.equipamentos.buscarPorId(equipamentoId);
    if (!equipamento) throw new ErroNaoEncontrado("Equipamento nao encontrado.");
    const lote = await this.dep.repos.lotes.buscarPorId(equipamento.loteId);
    this.exigirNoEscopo(chave, lote?.organizacaoId, "Equipamento nao encontrado.");

    const completo = await this.equipamentos.rastrear(equipamentoId);
    return {
      equipamento: { ...completo.equipamento, organizacaoId: lote?.organizacaoId ?? null },
      // Dados internos (nome do operador e observacoes livres) nao sao expostos a parceiros.
      historico: completo.historico.map(({ usuario: _usuario, observacao: _observacao, ...publico }) => publico),
    };
  }

  async listarLotes(chave: ChaveApiAutenticada, paginacao: Paginacao, organizacaoId?: string) {
    exigirPermissaoApi(chave, PermissaoApi.LOTES_LER);
    return this.lotes.listar({ organizacaoId: this.escopo(chave, organizacaoId) }, paginacao);
  }

  async detalharLote(chave: ChaveApiAutenticada, id: string) {
    exigirPermissaoApi(chave, PermissaoApi.LOTES_LER);
    const lote = await this.lotes.detalhar(id);
    this.exigirNoEscopo(chave, lote.organizacaoId, "Lote nao encontrado.");
    return lote;
  }

  async criarLote(chave: ChaveApiAutenticada, entrada: CriarLotePublicoEntrada) {
    exigirPermissaoApi(chave, PermissaoApi.LOTES_ESCREVER);
    const organizacaoId = this.escopo(chave, entrada.organizacaoId);
    if (!organizacaoId) {
      throw new ErroValidacao("organizacaoId e obrigatorio para chaves de escopo global.", ["organizacaoId"]);
    }
    return this.lotes.criar(await this.atorDeServico(chave), { ...entrada, organizacaoId });
  }

  async ultimaAnalise(chave: ChaveApiAutenticada, tipo: TipoRelatorio, organizacaoId?: string) {
    exigirPermissaoApi(chave, PermissaoApi.ANALISES_LER);
    return this.analises.ultimo(tipo, this.escopo(chave, organizacaoId) ?? null);
  }

  solicitarRelatorio(chave: ChaveApiAutenticada, entrada: SolicitarRelatorioEntrada) {
    return this.assincronos.solicitar({ tipo: "CHAVE_API", chave }, entrada);
  }

  consultarRelatorio(chave: ChaveApiAutenticada, tarefaId: string) {
    return this.assincronos.consultar({ tipo: "CHAVE_API", chave }, tarefaId);
  }

  baixarRelatorio(chave: ChaveApiAutenticada, tarefaId: string) {
    return this.assincronos.baixar({ tipo: "CHAVE_API", chave }, tarefaId);
  }

  /** Organizacao efetiva da consulta: chave restrita => sempre a dela (e erro se pedir outra); global => a pedida (opcional). */
  private escopo(chave: ChaveApiAutenticada, solicitada?: string): string | undefined {
    if (chave.organizacaoId) {
      if (solicitada && solicitada !== chave.organizacaoId) {
        throw new ErroPermissao("Esta chave de API so tem acesso a dados da sua propria organizacao.");
      }
      return chave.organizacaoId;
    }
    return solicitada;
  }

  private exigirNoEscopo(chave: ChaveApiAutenticada, organizacaoDoRecurso: string | undefined, mensagem: string): void {
    if (chave.organizacaoId && organizacaoDoRecurso !== chave.organizacaoId) throw new ErroNaoEncontrado(mensagem);
  }

  private async atorDeServico(chave: ChaveApiAutenticada): Promise<Ator> {
    const usuario = chave.usuarioServicoId ? await this.dep.repos.usuarios.buscarPorId(chave.usuarioServicoId) : null;
    if (!usuario || !usuario.ativo) {
      throw new ErroPermissao("O usuario de servico desta chave esta inativo ou foi removido; contate o administrador do greencode.");
    }
    return { id: usuario.id, username: usuario.username, papel: usuario.papel };
  }
}
