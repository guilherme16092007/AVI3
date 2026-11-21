import {
  EstadoFisico,
  Papel,
  StatusEquipamento,
  StatusLote,
  TipoEquipamento,
  TipoMovimentacao,
  TipoOrganizacao,
} from "../../types";
import { FormatoSaida, OrigemRelatorio, PermissaoApi, StatusTarefa, TipoRelatorio, TipoTarefa } from "../tiposAv3";

export interface Paginacao {
  limite: number;
  offset: number;
}

export interface Pagina<T> {
  itens: T[];
  total: number;
  limite: number;
  offset: number;
}

export interface UsuarioRegistro {
  id: string;
  username: string;
  papel: Papel;
  senhaHash: string;
  ativo: boolean;
  ultimoLoginEm: Date | null;
  criadoEm: Date;
  atualizadoEm: Date;
  versao: number;
}

export interface NovoUsuario {
  id: string;
  username: string;
  papel: Papel;
  senhaHash: string;
}

export interface UsuarioRepositorio {
  buscarPorId(id: string): Promise<UsuarioRegistro | null>;
  buscarPorUsername(username: string): Promise<UsuarioRegistro | null>;
  listar(paginacao: Paginacao): Promise<Pagina<UsuarioRegistro>>;
  criar(dados: NovoUsuario): Promise<UsuarioRegistro>;
  registrarLogin(id: string): Promise<void>;
}

export interface OrganizacaoRegistro {
  id: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  tipo: TipoOrganizacao;
  contatoResponsavel: string;
  emailContato: string;
  diasPrazoArmazenamento: number;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
  versao: number;
}

export interface NovaOrganizacao {
  id: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  tipo: TipoOrganizacao;
  contatoResponsavel: string;
  emailContato: string;
  diasPrazoArmazenamento: number;
}

export interface LoteResumo {
  id: string;
  dataEntrada: Date;
  notaFiscal: string;
  transportadora: string;
  status: StatusLote;
}

export interface OrganizacaoDetalhe extends OrganizacaoRegistro {
  contrato: ContratoRegistro | null;
  lotes: LoteResumo[];
}

export interface OrganizacaoRepositorio {
  buscarPorId(id: string): Promise<OrganizacaoRegistro | null>;
  buscarDetalhe(id: string): Promise<OrganizacaoDetalhe | null>;
  existeCnpj(cnpj: string): Promise<boolean>;
  listar(paginacao: Paginacao): Promise<Pagina<OrganizacaoRegistro>>;
  criar(dados: NovaOrganizacao): Promise<OrganizacaoRegistro>;
}

export interface ContratoRegistro {
  id: string;
  organizacaoId: string;
  numero: string;
  dataInicio: Date;
  dataFim: Date;
  clausulas: unknown;
  criadoEm: Date;
  atualizadoEm: Date;
  versao: number;
}

export interface NovoContrato {
  id: string;
  organizacaoId: string;
  numero: string;
  dataInicio: Date;
  dataFim: Date;
  clausulas: unknown;
}

export interface AtualizacaoContrato {
  numero: string;
  dataInicio: Date;
  dataFim: Date;
  clausulas: unknown;
}

export interface ContratoRepositorio {
  buscarPorOrganizacao(organizacaoId: string): Promise<ContratoRegistro | null>;
  numeroEmUsoPorOutraOrganizacao(numero: string, organizacaoId: string): Promise<boolean>;
  criar(dados: NovoContrato): Promise<ContratoRegistro>;
  atualizarComVersao(id: string, versaoEsperada: number, dados: AtualizacaoContrato): Promise<ContratoRegistro>;
}

export interface LoteRegistro {
  id: string;
  organizacaoId: string;
  dataEntrada: Date;
  notaFiscal: string;
  transportadora: string;
  status: StatusLote;
  quantidadeEquipamentos: number;
  criadoEm: Date;
  atualizadoEm: Date;
  versao: number;
}

export interface NovoLote {
  id: string;
  organizacaoId: string;
  dataEntrada: Date;
  notaFiscal: string;
  transportadora: string;
}

export interface LoteDetalhe extends LoteRegistro {
  equipamentos: EquipamentoRegistro[];
}

export interface LoteRepositorio {
  buscarPorId(id: string): Promise<LoteRegistro | null>;
  buscarDetalhe(id: string): Promise<LoteDetalhe | null>;
  listar(filtro: { organizacaoId?: string }, paginacao: Paginacao): Promise<Pagina<LoteRegistro>>;
  criar(dados: NovoLote): Promise<LoteRegistro>;
}

export interface EquipamentoRegistro {
  id: string;
  loteId: string;
  tipo: TipoEquipamento;
  numeroSerie: string;
  fabricante: string | null;
  modelo: string | null;
  codigoBarrasInterno: string;
  estadoFisico: EstadoFisico;
  status: StatusEquipamento;
  criadoEm: Date;
  atualizadoEm: Date;
  versao: number;
}

export interface NovoEquipamento {
  id: string;
  loteId: string;
  tipo: TipoEquipamento;
  numeroSerie: string;
  fabricante: string | null;
  modelo: string | null;
  codigoBarrasInterno: string;
  estadoFisico: EstadoFisico;
  status: StatusEquipamento;
}

export interface FiltroEquipamento {
  loteId?: string;
  status?: StatusEquipamento;
}

export interface EquipamentoRepositorio {
  buscarPorId(id: string): Promise<EquipamentoRegistro | null>;
  listar(filtro: FiltroEquipamento, paginacao: Paginacao): Promise<Pagina<EquipamentoRegistro>>;
  listarTodos(filtro: FiltroEquipamento): Promise<EquipamentoRegistro[]>;
  codigosExistentes(codigos: string[]): Promise<string[]>;
  criarVarios(dados: NovoEquipamento[]): Promise<void>;
  atualizarComVersao(
    id: string,
    versaoEsperada: number,
    dados: { estadoFisico?: EstadoFisico; status?: StatusEquipamento }
  ): Promise<EquipamentoRegistro>;
}

export interface NovaMovimentacao {
  id: string;
  equipamentoId: string;
  usuarioId: string;
  tipo: TipoMovimentacao;
  estadoFisicoAnterior: EstadoFisico | null;
  estadoFisicoNovo: EstadoFisico | null;
  statusAnterior: StatusEquipamento | null;
  statusNovo: StatusEquipamento | null;
  justificativa: string | null;
  observacao: string | null;
}

export interface MovimentacaoRegistro extends NovaMovimentacao {
  usuarioUsername: string;
  criadoEm: Date;
  versao: number;
}

export interface MovimentacaoRepositorio {
  criarVarias(dados: NovaMovimentacao[]): Promise<void>;
  listarPorEquipamento(equipamentoId: string): Promise<MovimentacaoRegistro[]>;
}

export interface ParametroRegistro {
  aliquotaImpostoPercentual: number;
  coeficienteDepreciacaoAnual: number;
  limiteDiasRetroativosLote: number;
  atualizadoEm: Date;
  versao: number;
}

export interface ParametroRepositorio {
  obter(): Promise<ParametroRegistro>;
  atualizarComVersao(
    versaoEsperada: number,
    dados: Partial<Pick<ParametroRegistro, "aliquotaImpostoPercentual" | "coeficienteDepreciacaoAnual" | "limiteDiasRetroativosLote">>
  ): Promise<ParametroRegistro>;
}

// ---------------------------------------------------------------------
// AV3: chaves de API, relatorios analiticos, fila de tarefas e leitura analitica
// ---------------------------------------------------------------------

export interface ChaveApiRegistro {
  id: string;
  nome: string;
  prefixo: string;
  hashChave: string;
  permissoes: PermissaoApi[];
  organizacaoId: string | null;
  usuarioServicoId: string | null;
  limitePorMinuto: number;
  expiraEm: Date | null;
  revogadaEm: Date | null;
  ultimoUsoEm: Date | null;
  criadoPorId: string;
  criadoEm: Date;
  atualizadoEm: Date;
  versao: number;
}

export interface NovaChaveApi {
  id: string;
  nome: string;
  prefixo: string;
  hashChave: string;
  permissoes: PermissaoApi[];
  organizacaoId: string | null;
  usuarioServicoId: string | null;
  limitePorMinuto: number;
  expiraEm: Date | null;
  criadoPorId: string;
}

export interface ChaveApiRepositorio {
  criar(dados: NovaChaveApi): Promise<ChaveApiRegistro>;
  buscarPorId(id: string): Promise<ChaveApiRegistro | null>;
  buscarPorPrefixo(prefixo: string): Promise<ChaveApiRegistro | null>;
  listar(paginacao: Paginacao): Promise<Pagina<ChaveApiRegistro>>;
  revogar(id: string, versaoEsperada: number, quando: Date): Promise<ChaveApiRegistro>;
  registrarUso(id: string, quando: Date): Promise<void>;
}

export interface NovaPrevisaoTipo {
  id: string;
  tipoEquipamento: TipoEquipamento;
  modelo: string;
  amostras: number;
  inclinacaoPorDia: number;
  interceptoEstado: number;
  r2: number | null;
  diasRestantesMediana: number | null;
}

export interface NovaPrevisaoEquipamento {
  id: string;
  equipamentoId: string;
  estadoAtual: EstadoFisico;
  diasRestantes: number | null;
  dataProjetadaInservivel: Date | null;
}

export interface NovoRelatorio {
  id: string;
  tipo: TipoRelatorio;
  origem: OrigemRelatorio;
  organizacaoId: string | null;
  parametros: unknown;
  resultado: unknown;
  versaoModelo: string;
  geradoEm: Date;
  solicitanteId: string | null;
  chaveApiId: string | null;
  previsoesTipo?: NovaPrevisaoTipo[];
  previsoesEquipamento?: NovaPrevisaoEquipamento[];
}

export interface RelatorioRegistro {
  id: string;
  tipo: TipoRelatorio;
  origem: OrigemRelatorio;
  organizacaoId: string | null;
  parametros: unknown;
  resultado: unknown;
  versaoModelo: string;
  geradoEm: Date;
  solicitanteId: string | null;
  chaveApiId: string | null;
}

/** `organizacaoId` indefinido = sem filtro; `null` = apenas relatorios globais; string = apenas da organizacao. */
export interface FiltroRelatorio {
  tipo?: TipoRelatorio;
  organizacaoId?: string | null;
}

/** Previsao individual cuja "realizacao" (equipamento chegou a INSERVIVEL) ja aconteceu. */
export interface PrevisaoRealizada {
  relatorioId: string;
  equipamentoId: string;
  geradoEm: Date;
  diasRestantesPrevistos: number | null;
  inservivelEm: Date;
}

export interface RelatorioRepositorio {
  salvar(dados: NovoRelatorio): Promise<RelatorioRegistro>;
  buscarPorId(id: string): Promise<RelatorioRegistro | null>;
  ultimo(tipo: TipoRelatorio, organizacaoId: string | null): Promise<RelatorioRegistro | null>;
  listar(filtro: FiltroRelatorio, paginacao: Paginacao): Promise<Pagina<RelatorioRegistro>>;
  previsoesRealizadas(): Promise<PrevisaoRealizada[]>;
}

export interface TarefaRegistro {
  id: string;
  tipo: TipoTarefa;
  status: StatusTarefa;
  payload: unknown;
  formato: FormatoSaida;
  tentativas: number;
  maxTentativas: number;
  proximaExecucaoEm: Date;
  iniciadaEm: Date | null;
  bloqueadaAte: Date | null;
  concluidaEm: Date | null;
  ultimoErro: string | null;
  relatorioId: string | null;
  resultadoConteudo: string | null;
  resultadoMime: string | null;
  chaveIdempotencia: string | null;
  solicitanteId: string | null;
  chaveApiId: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
  versao: number;
}

export interface NovaTarefa {
  id: string;
  tipo: TipoTarefa;
  payload: unknown;
  formato: FormatoSaida;
  maxTentativas: number;
  proximaExecucaoEm: Date;
  chaveIdempotencia: string | null;
  solicitanteId: string | null;
  chaveApiId: string | null;
}

export interface FiltroTarefa {
  status?: StatusTarefa;
  chaveApiId?: string;
}

export interface ResultadoTarefa {
  relatorioId: string;
  conteudo: string;
  mime: string;
}

export interface TarefaRepositorio {
  /** Idempotente: se `chaveIdempotencia` ja existir, devolve a tarefa existente com `criada = false`. */
  criar(dados: NovaTarefa): Promise<{ tarefa: TarefaRegistro; criada: boolean }>;
  buscarPorId(id: string): Promise<TarefaRegistro | null>;
  listar(filtro: FiltroTarefa, paginacao: Paginacao): Promise<Pagina<TarefaRegistro>>;
  contarAtivas(chaveApiId: string): Promise<number>;
  /** Reivindica ate `limite` tarefas PENDENTES vencidas (atomico por tarefa); incrementa `tentativas` e define o lease. */
  reivindicar(agora: Date, leaseMs: number, limite: number): Promise<TarefaRegistro[]>;
  concluir(id: string, resultado: ResultadoTarefa, agora: Date): Promise<TarefaRegistro>;
  /** `proximaExecucaoEm = null` marca a tarefa como FALHA definitiva; caso contrario volta a PENDENTE para novo retry. */
  registrarFalha(id: string, erro: string, proximaExecucaoEm: Date | null, agora: Date): Promise<TarefaRegistro>;
  /** Tarefas EM_EXECUCAO com lease vencido (worker morreu): voltam a PENDENTE ou, se esgotadas, FALHA. */
  liberarExpiradas(agora: Date): Promise<number>;
}

export interface MovimentacaoAnalitica {
  tipo: TipoMovimentacao;
  criadoEm: Date;
  usuarioId: string;
  usuarioUsername: string;
  estadoFisicoAnterior: EstadoFisico | null;
  estadoFisicoNovo: EstadoFisico | null;
  statusNovo: StatusEquipamento | null;
}

/** Visao de leitura (read model) usada pelos calculos analiticos: equipamento + lote + historico ordenado. */
export interface EquipamentoAnalitico {
  id: string;
  loteId: string;
  organizacaoId: string;
  loteDataEntrada: Date;
  tipo: TipoEquipamento;
  numeroSerie: string;
  fabricante: string | null;
  modelo: string | null;
  codigoBarrasInterno: string;
  estadoFisico: EstadoFisico;
  status: StatusEquipamento;
  criadoEm: Date;
  movimentacoes: MovimentacaoAnalitica[];
}

export interface AnaliseRepositorio {
  listarEquipamentos(filtro: { organizacaoId?: string }): Promise<EquipamentoAnalitico[]>;
}

export interface Repositorios {
  usuarios: UsuarioRepositorio;
  organizacoes: OrganizacaoRepositorio;
  contratos: ContratoRepositorio;
  lotes: LoteRepositorio;
  equipamentos: EquipamentoRepositorio;
  movimentacoes: MovimentacaoRepositorio;
  parametros: ParametroRepositorio;
  chavesApi: ChaveApiRepositorio;
  relatorios: RelatorioRepositorio;
  tarefas: TarefaRepositorio;
  analise: AnaliseRepositorio;
}

export interface ExecutorTransacao {
  executar<T>(fn: (repositorios: Repositorios) => Promise<T>): Promise<T>;
}

export interface Dependencias {
  repos: Repositorios;
  transacao: ExecutorTransacao;
}
