import { ChaveApiRegistro, RelatorioRegistro, TarefaRegistro } from "../repositorios/portas";
import { StatusTarefa } from "../tiposAv3";

export function paraChaveApiDto(c: ChaveApiRegistro) {
  return {
    id: c.id,
    nome: c.nome,
    prefixo: c.prefixo,
    permissoes: c.permissoes,
    escopo: c.organizacaoId ? "ORGANIZACAO" : "GLOBAL",
    organizacaoId: c.organizacaoId,
    usuarioServicoId: c.usuarioServicoId,
    limitePorMinuto: c.limitePorMinuto,
    expiraEm: c.expiraEm ? c.expiraEm.toISOString() : null,
    revogadaEm: c.revogadaEm ? c.revogadaEm.toISOString() : null,
    ultimoUsoEm: c.ultimoUsoEm ? c.ultimoUsoEm.toISOString() : null,
    criadoEm: c.criadoEm.toISOString(),
    versao: c.versao,
  };
}
export type ChaveApiDto = ReturnType<typeof paraChaveApiDto>;

export function paraRelatorioDto(r: RelatorioRegistro) {
  return {
    id: r.id,
    tipo: r.tipo,
    origem: r.origem,
    organizacaoId: r.organizacaoId,
    geradoEm: r.geradoEm.toISOString(),
    versaoModelo: r.versaoModelo,
    parametros: r.parametros,
    resultado: r.resultado,
  };
}
export type RelatorioDto = ReturnType<typeof paraRelatorioDto>;

export function paraRelatorioResumoDto(r: RelatorioRegistro) {
  const { resultado: _resultado, parametros: _parametros, ...resumo } = paraRelatorioDto(r);
  return resumo;
}

export function paraTarefaDto(t: TarefaRegistro) {
  const payload = (t.payload ?? {}) as { tipo?: string; organizacaoId?: string | null };
  return {
    id: t.id,
    status: t.status,
    tipoRelatorio: payload.tipo ?? null,
    organizacaoId: payload.organizacaoId ?? null,
    formato: t.formato,
    tentativas: t.tentativas,
    maxTentativas: t.maxTentativas,
    proximaTentativaEm: t.status === StatusTarefa.PENDENTE && t.tentativas > 0 ? t.proximaExecucaoEm.toISOString() : null,
    criadoEm: t.criadoEm.toISOString(),
    iniciadaEm: t.iniciadaEm ? t.iniciadaEm.toISOString() : null,
    concluidaEm: t.concluidaEm ? t.concluidaEm.toISOString() : null,
    erro: t.status === StatusTarefa.FALHA || (t.status === StatusTarefa.PENDENTE && t.tentativas > 0) ? t.ultimoErro : null,
    relatorioId: t.relatorioId,
    downloadDisponivel: t.status === StatusTarefa.CONCLUIDA && t.resultadoConteudo !== null,
  };
}
export type TarefaDto = ReturnType<typeof paraTarefaDto>;
