import { ErroConflito } from "../../src/server/erros";
import {
  AnaliseRepositorio,
  ChaveApiRegistro,
  ChaveApiRepositorio,
  EquipamentoAnalitico,
  EquipamentoRegistro,
  LoteRegistro,
  MovimentacaoRegistro,
  Pagina,
  Paginacao,
  PrevisaoRealizada,
  RelatorioRegistro,
  RelatorioRepositorio,
  TarefaRegistro,
  TarefaRepositorio,
  UsuarioRegistro,
} from "../../src/server/repositorios/portas";
import { EstadoFisico } from "../../src/types";
import { StatusTarefa } from "../../src/server/tiposAv3";

export interface PrevisaoArmazenada {
  relatorioId: string;
  equipamentoId: string;
  geradoEm: Date;
  diasRestantes: number | null;
}

/** Estado adicional da AV3 mantido pelo BancoMemoria (e restaurado no rollback de transacoes). */
export interface EstadoAv3 {
  chavesApi: ChaveApiRegistro[];
  relatorios: RelatorioRegistro[];
  previsoesEquipamento: PrevisaoArmazenada[];
  tarefas: TarefaRegistro[];
}

export interface EstadoLeitura extends EstadoAv3 {
  usuarios: UsuarioRegistro[];
  lotes: Array<Omit<LoteRegistro, "quantidadeEquipamentos">>;
  equipamentos: EquipamentoRegistro[];
  movimentacoes: MovimentacaoRegistro[];
}

function paginar<T>(todos: T[], p: Paginacao): Pagina<T> {
  return { itens: todos.slice(p.offset, p.offset + p.limite), total: todos.length, limite: p.limite, offset: p.offset };
}

export function criarReposAv3(estado: () => EstadoLeitura) {
  const chavesApi: ChaveApiRepositorio = {
    async criar(d) {
      const e = estado();
      if (e.chavesApi.some((c) => c.prefixo === d.prefixo)) {
        throw Object.assign(new Error("Unique constraint failed on the fields: (prefixo)"), { code: "P2002" });
      }
      const agora = new Date();
      const registro: ChaveApiRegistro = {
        ...d, revogadaEm: null, ultimoUsoEm: null, criadoEm: agora, atualizadoEm: agora, versao: 1,
      };
      e.chavesApi.push(registro);
      return registro;
    },
    async buscarPorId(id) {
      return estado().chavesApi.find((c) => c.id === id) ?? null;
    },
    async buscarPorPrefixo(prefixo) {
      return estado().chavesApi.find((c) => c.prefixo === prefixo) ?? null;
    },
    async listar(p) {
      return paginar([...estado().chavesApi].sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime()), p);
    },
    async revogar(id, versaoEsperada, quando) {
      const c = estado().chavesApi.find((x) => x.id === id && x.versao === versaoEsperada && x.revogadaEm === null);
      if (!c) throw new ErroConflito("Chave de API alterada por outra requisicao.");
      c.revogadaEm = quando;
      c.versao += 1;
      c.atualizadoEm = quando;
      return c;
    },
    async registrarUso(id, quando) {
      const c = estado().chavesApi.find((x) => x.id === id);
      if (c) c.ultimoUsoEm = quando;
    },
  };

  const relatorios: RelatorioRepositorio = {
    async salvar(d) {
      const e = estado();
      const { previsoesTipo: _t, previsoesEquipamento, ...resto } = d;
      const registro: RelatorioRegistro = { ...resto };
      e.relatorios.push(registro);
      for (const p of previsoesEquipamento ?? []) {
        e.previsoesEquipamento.push({
          relatorioId: d.id, equipamentoId: p.equipamentoId, geradoEm: d.geradoEm, diasRestantes: p.diasRestantes,
        });
      }
      return registro;
    },
    async buscarPorId(id) {
      return estado().relatorios.find((r) => r.id === id) ?? null;
    },
    async ultimo(tipo, organizacaoId) {
      return (
        [...estado().relatorios]
          .filter((r) => r.tipo === tipo && r.organizacaoId === organizacaoId)
          .sort((a, b) => b.geradoEm.getTime() - a.geradoEm.getTime())[0] ?? null
      );
    },
    async listar(filtro, p) {
      const itens = estado()
        .relatorios.filter((r) => (!filtro.tipo || r.tipo === filtro.tipo) && (filtro.organizacaoId === undefined || r.organizacaoId === filtro.organizacaoId))
        .sort((a, b) => b.geradoEm.getTime() - a.geradoEm.getTime())
        .map((r) => ({ ...r, resultado: null }));
      return paginar(itens, p);
    },
    async previsoesRealizadas() {
      const e = estado();
      const saida: PrevisaoRealizada[] = [];
      for (const p of e.previsoesEquipamento) {
        const eq = e.equipamentos.find((x) => x.id === p.equipamentoId);
        if (!eq || eq.estadoFisico !== EstadoFisico.INSERVIVEL || p.diasRestantes === null) continue;
        const mov = e.movimentacoes
          .filter((m) => m.equipamentoId === p.equipamentoId && m.estadoFisicoNovo === EstadoFisico.INSERVIVEL && m.criadoEm.getTime() > p.geradoEm.getTime())
          .sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())[0];
        if (mov) saida.push({ relatorioId: p.relatorioId, equipamentoId: p.equipamentoId, geradoEm: p.geradoEm, diasRestantesPrevistos: p.diasRestantes, inservivelEm: mov.criadoEm });
      }
      return saida;
    },
  };

  const tarefas: TarefaRepositorio = {
    async criar(d) {
      const e = estado();
      if (d.chaveIdempotencia) {
        const existente = e.tarefas.find((t) => t.chaveIdempotencia === d.chaveIdempotencia);
        if (existente) return { tarefa: existente, criada: false };
      }
      const agora = new Date();
      const tarefa: TarefaRegistro = {
        ...d,
        status: StatusTarefa.PENDENTE, tentativas: 0, iniciadaEm: null, bloqueadaAte: null, concluidaEm: null, ultimoErro: null,
        relatorioId: null, resultadoConteudo: null, resultadoMime: null, criadoEm: agora, atualizadoEm: agora, versao: 1,
      };
      e.tarefas.push(tarefa);
      return { tarefa, criada: true };
    },
    async buscarPorId(id) {
      return estado().tarefas.find((t) => t.id === id) ?? null;
    },
    async listar(f, p) {
      const itens = estado()
        .tarefas.filter((t) => (!f.status || t.status === f.status) && (!f.chaveApiId || t.chaveApiId === f.chaveApiId))
        .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
      return paginar(itens, p);
    },
    async contarAtivas(chaveApiId) {
      return estado().tarefas.filter((t) => t.chaveApiId === chaveApiId && (t.status === StatusTarefa.PENDENTE || t.status === StatusTarefa.EM_EXECUCAO)).length;
    },
    async reivindicar(agora, leaseMs, limite) {
      const candidatas = estado()
        .tarefas.filter((t) => t.status === StatusTarefa.PENDENTE && t.proximaExecucaoEm.getTime() <= agora.getTime())
        .sort((a, b) => a.proximaExecucaoEm.getTime() - b.proximaExecucaoEm.getTime() || a.criadoEm.getTime() - b.criadoEm.getTime())
        .slice(0, limite);
      for (const t of candidatas) {
        t.status = StatusTarefa.EM_EXECUCAO;
        t.tentativas += 1;
        t.iniciadaEm = agora;
        t.bloqueadaAte = new Date(agora.getTime() + leaseMs);
        t.versao += 1;
      }
      return candidatas;
    },
    async concluir(id, r, agora) {
      const t = estado().tarefas.find((x) => x.id === id && x.status === StatusTarefa.EM_EXECUCAO);
      if (!t) throw new ErroConflito("Tarefa nao esta mais em execucao.");
      Object.assign(t, { status: StatusTarefa.CONCLUIDA, concluidaEm: agora, relatorioId: r.relatorioId, resultadoConteudo: r.conteudo, resultadoMime: r.mime, bloqueadaAte: null, ultimoErro: null });
      t.versao += 1;
      return t;
    },
    async registrarFalha(id, erro, proxima, agora) {
      const t = estado().tarefas.find((x) => x.id === id && x.status === StatusTarefa.EM_EXECUCAO);
      if (!t) throw new ErroConflito("Tarefa nao esta mais em execucao.");
      if (proxima) Object.assign(t, { status: StatusTarefa.PENDENTE, proximaExecucaoEm: proxima });
      else Object.assign(t, { status: StatusTarefa.FALHA, concluidaEm: agora });
      Object.assign(t, { ultimoErro: erro, bloqueadaAte: null });
      t.versao += 1;
      return t;
    },
    async liberarExpiradas(agora) {
      let n = 0;
      for (const t of estado().tarefas) {
        if (t.status !== StatusTarefa.EM_EXECUCAO || !t.bloqueadaAte || t.bloqueadaAte.getTime() >= agora.getTime()) continue;
        if (t.tentativas >= t.maxTentativas) Object.assign(t, { status: StatusTarefa.FALHA, concluidaEm: agora });
        else Object.assign(t, { status: StatusTarefa.PENDENTE, proximaExecucaoEm: agora });
        Object.assign(t, { ultimoErro: "Lease expirado: o worker que executava a tarefa foi interrompido.", bloqueadaAte: null });
        t.versao += 1;
        n += 1;
      }
      return n;
    },
  };

  const analise: AnaliseRepositorio = {
    async listarEquipamentos(filtro) {
      const e = estado();
      const saida: EquipamentoAnalitico[] = [];
      for (const eq of [...e.equipamentos].sort((a, b) => a.id.localeCompare(b.id))) {
        const lote = e.lotes.find((l) => l.id === eq.loteId);
        if (!lote || (filtro.organizacaoId && lote.organizacaoId !== filtro.organizacaoId)) continue;
        saida.push({
          id: eq.id, loteId: eq.loteId, organizacaoId: lote.organizacaoId, loteDataEntrada: lote.dataEntrada,
          tipo: eq.tipo, numeroSerie: eq.numeroSerie, fabricante: eq.fabricante, modelo: eq.modelo,
          codigoBarrasInterno: eq.codigoBarrasInterno, estadoFisico: eq.estadoFisico, status: eq.status, criadoEm: eq.criadoEm,
          movimentacoes: e.movimentacoes
            .filter((m) => m.equipamentoId === eq.id)
            .sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())
            .map((m) => ({
              tipo: m.tipo, criadoEm: m.criadoEm, usuarioId: m.usuarioId,
              usuarioUsername: e.usuarios.find((u) => u.id === m.usuarioId)?.username ?? "desconhecido",
              estadoFisicoAnterior: m.estadoFisicoAnterior, estadoFisicoNovo: m.estadoFisicoNovo, statusNovo: m.statusNovo,
            })),
        });
      }
      return saida;
    },
  };

  return { chavesApi, relatorios, tarefas, analise };
}
