import type { Prisma } from "@prisma/client";
import { EstadoFisico, StatusEquipamento, TipoEquipamento, TipoMovimentacao } from "../../../types";
import { ErroConflito } from "../../erros";
import { FormatoSaida, OrigemRelatorio, PermissaoApi, StatusTarefa, TipoRelatorio, TipoTarefa } from "../../tiposAv3";
import {
  AnaliseRepositorio,
  ChaveApiRegistro,
  ChaveApiRepositorio,
  EquipamentoAnalitico,
  FiltroRelatorio,
  FiltroTarefa,
  NovaChaveApi,
  NovaTarefa,
  NovoRelatorio,
  Pagina,
  Paginacao,
  PrevisaoRealizada,
  RelatorioRegistro,
  RelatorioRepositorio,
  ResultadoTarefa,
  TarefaRegistro,
  TarefaRepositorio,
} from "../portas";

type Db = Prisma.TransactionClient;

function emBanco(valor: string): any {
  return valor;
}
function emDominio<E extends string>(valor: string): E {
  return valor as E;
}
function conflito(recurso: string): ErroConflito {
  return new ErroConflito(`${recurso} alterado por outra requisicao (versao desatualizada). Busque o recurso novamente.`);
}

// ---------------------------------------------------------------- chaves de API

interface LinhaChave {
  id: string;
  nome: string;
  prefixo: string;
  hashChave: string;
  permissoes: string[];
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
const paraChave = (l: LinhaChave): ChaveApiRegistro => ({ ...l, permissoes: l.permissoes.map((p) => emDominio<PermissaoApi>(p)) });

export class ChaveApiRepositorioPrisma implements ChaveApiRepositorio {
  constructor(private readonly db: Db) {}

  async criar(d: NovaChaveApi): Promise<ChaveApiRegistro> {
    const linha = await this.db.chaveApi.create({
      data: {
        id: d.id,
        nome: d.nome,
        prefixo: d.prefixo,
        hashChave: d.hashChave,
        permissoes: emBanco(d.permissoes as unknown as string),
        organizacaoId: d.organizacaoId,
        usuarioServicoId: d.usuarioServicoId,
        limitePorMinuto: d.limitePorMinuto,
        expiraEm: d.expiraEm,
        criadoPorId: d.criadoPorId,
      },
    });
    return paraChave(linha);
  }

  async buscarPorId(id: string): Promise<ChaveApiRegistro | null> {
    const linha = await this.db.chaveApi.findUnique({ where: { id } });
    return linha ? paraChave(linha) : null;
  }

  async buscarPorPrefixo(prefixo: string): Promise<ChaveApiRegistro | null> {
    const linha = await this.db.chaveApi.findUnique({ where: { prefixo } });
    return linha ? paraChave(linha) : null;
  }

  async listar(p: Paginacao): Promise<Pagina<ChaveApiRegistro>> {
    const [linhas, total] = await Promise.all([
      this.db.chaveApi.findMany({ skip: p.offset, take: p.limite, orderBy: [{ criadoEm: "desc" }, { id: "asc" }] }),
      this.db.chaveApi.count(),
    ]);
    return { itens: linhas.map(paraChave), total, limite: p.limite, offset: p.offset };
  }

  async revogar(id: string, versaoEsperada: number, quando: Date): Promise<ChaveApiRegistro> {
    const r = await this.db.chaveApi.updateMany({
      where: { id, versao: versaoEsperada, revogadaEm: null },
      data: { revogadaEm: quando, versao: { increment: 1 } },
    });
    if (r.count === 0) throw conflito("Chave de API");
    const linha = await this.db.chaveApi.findUnique({ where: { id } });
    if (!linha) throw conflito("Chave de API");
    return paraChave(linha);
  }

  async registrarUso(id: string, quando: Date): Promise<void> {
    await this.db.chaveApi.updateMany({ where: { id }, data: { ultimoUsoEm: quando } });
  }
}

// ---------------------------------------------------------------- relatorios

interface LinhaRelatorio {
  id: string;
  tipo: string;
  origem: string;
  organizacaoId: string | null;
  parametros: unknown;
  resultado?: unknown;
  versaoModelo: string;
  geradoEm: Date;
  solicitanteId: string | null;
  chaveApiId: string | null;
}
const paraRelatorio = (l: LinhaRelatorio): RelatorioRegistro => ({
  ...l,
  tipo: emDominio<TipoRelatorio>(l.tipo),
  origem: emDominio<OrigemRelatorio>(l.origem),
  resultado: l.resultado ?? null,
});

const LIMITE_PREVISOES_AVALIADAS = 10_000;

export class RelatorioRepositorioPrisma implements RelatorioRepositorio {
  constructor(private readonly db: Db) {}

  async salvar(d: NovoRelatorio): Promise<RelatorioRegistro> {
    const linha = await this.db.relatorioAnalitico.create({
      data: {
        id: d.id,
        tipo: emBanco(d.tipo),
        origem: emBanco(d.origem),
        organizacaoId: d.organizacaoId,
        parametros: d.parametros as Prisma.InputJsonValue,
        resultado: d.resultado as Prisma.InputJsonValue,
        versaoModelo: d.versaoModelo,
        geradoEm: d.geradoEm,
        solicitanteId: d.solicitanteId,
        chaveApiId: d.chaveApiId,
        ...(d.previsoesTipo && d.previsoesTipo.length > 0
          ? {
              previsoesTipo: {
                createMany: {
                  data: d.previsoesTipo.map((p) => ({
                    id: p.id,
                    tipoEquipamento: emBanco(p.tipoEquipamento),
                    modelo: p.modelo,
                    amostras: p.amostras,
                    inclinacaoPorDia: p.inclinacaoPorDia,
                    interceptoEstado: p.interceptoEstado,
                    r2: p.r2,
                    diasRestantesMediana: p.diasRestantesMediana,
                    geradoEm: d.geradoEm,
                  })),
                },
              },
            }
          : {}),
        ...(d.previsoesEquipamento && d.previsoesEquipamento.length > 0
          ? {
              previsoesEquipamento: {
                createMany: {
                  data: d.previsoesEquipamento.map((p) => ({
                    id: p.id,
                    equipamentoId: p.equipamentoId,
                    estadoAtual: p.estadoAtual,
                    diasRestantes: p.diasRestantes,
                    dataProjetadaInservivel: p.dataProjetadaInservivel,
                    geradoEm: d.geradoEm,
                  })),
                },
              },
            }
          : {}),
      },
    });
    return paraRelatorio(linha);
  }

  async buscarPorId(id: string): Promise<RelatorioRegistro | null> {
    const linha = await this.db.relatorioAnalitico.findUnique({ where: { id } });
    return linha ? paraRelatorio(linha) : null;
  }

  async ultimo(tipo: TipoRelatorio, organizacaoId: string | null): Promise<RelatorioRegistro | null> {
    const linha = await this.db.relatorioAnalitico.findFirst({
      where: { tipo: emBanco(tipo), organizacaoId },
      orderBy: [{ geradoEm: "desc" }, { id: "asc" }],
    });
    return linha ? paraRelatorio(linha) : null;
  }

  async listar(filtro: FiltroRelatorio, p: Paginacao): Promise<Pagina<RelatorioRegistro>> {
    const where: Prisma.RelatorioAnaliticoWhereInput = {};
    if (filtro.tipo) where.tipo = emBanco(filtro.tipo);
    if (filtro.organizacaoId !== undefined) where.organizacaoId = filtro.organizacaoId;
    const [linhas, total] = await Promise.all([
      this.db.relatorioAnalitico.findMany({
        where,
        skip: p.offset,
        take: p.limite,
        orderBy: [{ geradoEm: "desc" }, { id: "asc" }],
        // A listagem e um resumo: o JSON volumoso de `resultado` nao e carregado.
        select: {
          id: true, tipo: true, origem: true, organizacaoId: true, parametros: true,
          versaoModelo: true, geradoEm: true, solicitanteId: true, chaveApiId: true,
        },
      }),
      this.db.relatorioAnalitico.count({ where }),
    ]);
    return { itens: linhas.map(paraRelatorio), total, limite: p.limite, offset: p.offset };
  }

  async previsoesRealizadas(): Promise<PrevisaoRealizada[]> {
    const linhas = await this.db.previsaoEquipamento.findMany({
      where: { diasRestantes: { not: null }, equipamento: { estadoFisico: EstadoFisico.INSERVIVEL } },
      orderBy: { geradoEm: "desc" },
      take: LIMITE_PREVISOES_AVALIADAS,
      select: {
        relatorioId: true,
        equipamentoId: true,
        geradoEm: true,
        diasRestantes: true,
        equipamento: {
          select: {
            movimentacoes: {
              where: { estadoFisicoNovo: EstadoFisico.INSERVIVEL },
              orderBy: { criadoEm: "asc" },
              select: { criadoEm: true },
            },
          },
        },
      },
    });
    const resultado: PrevisaoRealizada[] = [];
    for (const l of linhas) {
      // A realizacao conta somente se o equipamento ficou INSERVIVEL DEPOIS da previsao.
      const posterior = l.equipamento.movimentacoes.find((m) => m.criadoEm.getTime() > l.geradoEm.getTime());
      if (!posterior) continue;
      resultado.push({
        relatorioId: l.relatorioId,
        equipamentoId: l.equipamentoId,
        geradoEm: l.geradoEm,
        diasRestantesPrevistos: l.diasRestantes,
        inservivelEm: posterior.criadoEm,
      });
    }
    return resultado;
  }
}

// ---------------------------------------------------------------- fila de tarefas

interface LinhaTarefa {
  id: string;
  tipo: string;
  status: string;
  payload: unknown;
  formato: string;
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
const paraTarefa = (l: LinhaTarefa): TarefaRegistro => ({
  ...l,
  tipo: emDominio<TipoTarefa>(l.tipo),
  status: emDominio<StatusTarefa>(l.status),
  formato: emDominio<FormatoSaida>(l.formato),
});

const MAX_ERRO = 2_000;

export class TarefaRepositorioPrisma implements TarefaRepositorio {
  constructor(private readonly db: Db) {}

  async criar(d: NovaTarefa): Promise<{ tarefa: TarefaRegistro; criada: boolean }> {
    if (d.chaveIdempotencia) {
      const existente = await this.db.tarefa.findUnique({ where: { chaveIdempotencia: d.chaveIdempotencia } });
      if (existente) return { tarefa: paraTarefa(existente), criada: false };
    }
    try {
      const linha = await this.db.tarefa.create({
        data: {
          id: d.id,
          tipo: d.tipo,
          payload: d.payload as Prisma.InputJsonValue,
          formato: emBanco(d.formato),
          maxTentativas: d.maxTentativas,
          proximaExecucaoEm: d.proximaExecucaoEm,
          chaveIdempotencia: d.chaveIdempotencia,
          solicitanteId: d.solicitanteId,
          chaveApiId: d.chaveApiId,
        },
      });
      return { tarefa: paraTarefa(linha), criada: true };
    } catch (erro) {
      // Corrida entre duas instancias com a mesma chave de idempotencia: a outra venceu, devolve a dela.
      if (d.chaveIdempotencia && (erro as { code?: string }).code === "P2002") {
        const existente = await this.db.tarefa.findUnique({ where: { chaveIdempotencia: d.chaveIdempotencia } });
        if (existente) return { tarefa: paraTarefa(existente), criada: false };
      }
      throw erro;
    }
  }

  async buscarPorId(id: string): Promise<TarefaRegistro | null> {
    const linha = await this.db.tarefa.findUnique({ where: { id } });
    return linha ? paraTarefa(linha) : null;
  }

  async listar(f: FiltroTarefa, p: Paginacao): Promise<Pagina<TarefaRegistro>> {
    const where: Prisma.TarefaWhereInput = {};
    if (f.status) where.status = emBanco(f.status);
    if (f.chaveApiId) where.chaveApiId = f.chaveApiId;
    const [linhas, total] = await Promise.all([
      this.db.tarefa.findMany({ where, skip: p.offset, take: p.limite, orderBy: [{ criadoEm: "desc" }, { id: "asc" }] }),
      this.db.tarefa.count({ where }),
    ]);
    return { itens: linhas.map(paraTarefa), total, limite: p.limite, offset: p.offset };
  }

  async contarAtivas(chaveApiId: string): Promise<number> {
    return this.db.tarefa.count({ where: { chaveApiId, status: { in: [emBanco(StatusTarefa.PENDENTE), emBanco(StatusTarefa.EM_EXECUCAO)] } } });
  }

  /**
   * Reivindicacao otimista: cada tarefa so e obtida por quem consegue o UPDATE condicionado a (status=PENDENTE, versao lida).
   * Duas instancias disputando a mesma tarefa: exatamente uma vence (count = 1); a outra segue para a proxima candidata.
   */
  async reivindicar(agora: Date, leaseMs: number, limite: number): Promise<TarefaRegistro[]> {
    const candidatas = await this.db.tarefa.findMany({
      where: { status: emBanco(StatusTarefa.PENDENTE), proximaExecucaoEm: { lte: agora } },
      orderBy: [{ proximaExecucaoEm: "asc" }, { criadoEm: "asc" }],
      take: limite * 2,
    });
    const obtidas: TarefaRegistro[] = [];
    for (const c of candidatas) {
      if (obtidas.length >= limite) break;
      const r = await this.db.tarefa.updateMany({
        where: { id: c.id, status: emBanco(StatusTarefa.PENDENTE), versao: c.versao },
        data: {
          status: emBanco(StatusTarefa.EM_EXECUCAO),
          tentativas: { increment: 1 },
          iniciadaEm: agora,
          bloqueadaAte: new Date(agora.getTime() + leaseMs),
          versao: { increment: 1 },
        },
      });
      if (r.count !== 1) continue;
      const linha = await this.db.tarefa.findUnique({ where: { id: c.id } });
      if (linha) obtidas.push(paraTarefa(linha));
    }
    return obtidas;
  }

  async concluir(id: string, resultado: ResultadoTarefa, agora: Date): Promise<TarefaRegistro> {
    const r = await this.db.tarefa.updateMany({
      where: { id, status: emBanco(StatusTarefa.EM_EXECUCAO) },
      data: {
        status: emBanco(StatusTarefa.CONCLUIDA),
        concluidaEm: agora,
        relatorioId: resultado.relatorioId,
        resultadoConteudo: resultado.conteudo,
        resultadoMime: resultado.mime,
        bloqueadaAte: null,
        ultimoErro: null,
        versao: { increment: 1 },
      },
    });
    if (r.count === 0) throw conflito("Tarefa (nao esta mais em execucao; lease possivelmente expirado)");
    const linha = await this.db.tarefa.findUnique({ where: { id } });
    if (!linha) throw conflito("Tarefa");
    return paraTarefa(linha);
  }

  async registrarFalha(id: string, erro: string, proximaExecucaoEm: Date | null, agora: Date): Promise<TarefaRegistro> {
    const r = await this.db.tarefa.updateMany({
      where: { id, status: emBanco(StatusTarefa.EM_EXECUCAO) },
      data: {
        ...(proximaExecucaoEm
          ? { status: emBanco(StatusTarefa.PENDENTE), proximaExecucaoEm }
          : { status: emBanco(StatusTarefa.FALHA), concluidaEm: agora }),
        ultimoErro: erro.slice(0, MAX_ERRO),
        bloqueadaAte: null,
        versao: { increment: 1 },
      },
    });
    if (r.count === 0) throw conflito("Tarefa (nao esta mais em execucao; lease possivelmente expirado)");
    const linha = await this.db.tarefa.findUnique({ where: { id } });
    if (!linha) throw conflito("Tarefa");
    return paraTarefa(linha);
  }

  async liberarExpiradas(agora: Date): Promise<number> {
    const expiradas = await this.db.tarefa.findMany({
      where: { status: emBanco(StatusTarefa.EM_EXECUCAO), bloqueadaAte: { lt: agora } },
      take: 100,
    });
    let liberadas = 0;
    for (const t of expiradas) {
      const esgotada = t.tentativas >= t.maxTentativas;
      const r = await this.db.tarefa.updateMany({
        where: { id: t.id, status: emBanco(StatusTarefa.EM_EXECUCAO), versao: t.versao },
        data: {
          ...(esgotada
            ? { status: emBanco(StatusTarefa.FALHA), concluidaEm: agora }
            : { status: emBanco(StatusTarefa.PENDENTE), proximaExecucaoEm: agora }),
          ultimoErro: "Lease expirado: o worker que executava a tarefa foi interrompido.",
          bloqueadaAte: null,
          versao: { increment: 1 },
        },
      });
      if (r.count === 1) liberadas += 1;
    }
    return liberadas;
  }
}

// ---------------------------------------------------------------- leitura analitica

const TAMANHO_LOTE_LEITURA = 500;

export class AnaliseRepositorioPrisma implements AnaliseRepositorio {
  constructor(private readonly db: Db) {}

  /** Le equipamento + lote + historico em paginas por cursor (memoria limitada por pagina, nao por consulta unica). */
  async listarEquipamentos(filtro: { organizacaoId?: string }): Promise<EquipamentoAnalitico[]> {
    const where: Prisma.EquipamentoWhereInput = filtro.organizacaoId ? { lote: { organizacaoId: filtro.organizacaoId } } : {};
    const saida: EquipamentoAnalitico[] = [];
    let cursor: string | undefined;

    for (;;) {
      const linhas = await this.db.equipamento.findMany({
        where,
        take: TAMANHO_LOTE_LEITURA,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        include: {
          lote: { select: { organizacaoId: true, dataEntrada: true } },
          movimentacoes: {
            orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
            include: { usuario: { select: { username: true } } },
          },
        },
      });
      if (linhas.length === 0) break;

      for (const l of linhas) {
        saida.push({
          id: l.id,
          loteId: l.loteId,
          organizacaoId: l.lote.organizacaoId,
          loteDataEntrada: l.lote.dataEntrada,
          tipo: emDominio<TipoEquipamento>(l.tipo),
          numeroSerie: l.numeroSerie,
          fabricante: l.fabricante,
          modelo: l.modelo,
          codigoBarrasInterno: l.codigoBarrasInterno,
          estadoFisico: l.estadoFisico as EstadoFisico,
          status: emDominio<StatusEquipamento>(l.status),
          criadoEm: l.criadoEm,
          movimentacoes: l.movimentacoes.map((m) => ({
            tipo: emDominio<TipoMovimentacao>(m.tipo),
            criadoEm: m.criadoEm,
            usuarioId: m.usuarioId,
            usuarioUsername: m.usuario.username,
            estadoFisicoAnterior: m.estadoFisicoAnterior as EstadoFisico | null,
            estadoFisicoNovo: m.estadoFisicoNovo as EstadoFisico | null,
            statusNovo: m.statusNovo === null ? null : emDominio<StatusEquipamento>(m.statusNovo),
          })),
        });
      }
      cursor = linhas[linhas.length - 1].id;
      if (linhas.length < TAMANHO_LOTE_LEITURA) break;
    }
    return saida;
  }
}
