import { paraCsv } from "../../src/server/analise/csv";
import { calcularEficiencia } from "../../src/server/analise/eficiencia";
import {
  arredondar, desvioPadrao, media, mediana, percentil, regressaoLinear,
} from "../../src/server/analise/estatistica";
import { calcularRentabilidade } from "../../src/server/analise/rentabilidade";
import { calcularVidaUtil } from "../../src/server/analise/vidaUtil";
import { EquipamentoAnalitico, MovimentacaoAnalitica } from "../../src/server/repositorios/portas";
import { EstadoFisico, StatusEquipamento, TipoEquipamento, TipoMovimentacao } from "../../src/types";

let total = 0;
let falhas = 0;
function afirmar(condicao: boolean, descricao: string): void {
  total += 1;
  if (condicao) console.log(`  \x1b[32mOK\x1b[0m     ${descricao}`);
  else {
    falhas += 1;
    console.log(`  \x1b[31mFALHOU\x1b[0m ${descricao}`);
  }
}
const perto = (a: number | null | undefined, b: number, tol = 0.01): boolean => a !== null && a !== undefined && Math.abs(a - b) <= tol;

const H = 3_600_000;
const D = 86_400_000;
const T0 = new Date("2026-11-01T00:00:00.000Z");
const em = (ms: number): Date => new Date(T0.getTime() + ms);

function mov(tipo: TipoMovimentacao, quando: Date, usuario: string, estadoNovo: EstadoFisico | null = null): MovimentacaoAnalitica {
  return { tipo, criadoEm: quando, usuarioId: `id-${usuario}`, usuarioUsername: usuario, estadoFisicoAnterior: null, estadoFisicoNovo: estadoNovo, statusNovo: null };
}

interface OpcoesEq {
  id: string;
  lote: string;
  entrada?: string;
  cadastro: Date;
  triagem?: { quando: Date; usuario: string };
  tipo?: TipoEquipamento;
  estado?: EstadoFisico;
  status?: StatusEquipamento;
  fabricante?: string | null;
  movs?: MovimentacaoAnalitica[];
}
function eq(o: OpcoesEq): EquipamentoAnalitico {
  const movs = o.movs ?? [
    mov(TipoMovimentacao.CADASTRO, o.cadastro, "cadastrador", EstadoFisico.BOM),
    ...(o.triagem ? [mov(TipoMovimentacao.TRIAGEM, o.triagem.quando, o.triagem.usuario, o.estado ?? EstadoFisico.BOM)] : []),
  ];
  return {
    id: o.id, loteId: o.lote, organizacaoId: "org-1", loteDataEntrada: new Date(`${o.entrada ?? "2026-11-01"}T00:00:00.000Z`),
    tipo: o.tipo ?? TipoEquipamento.NOTEBOOK, numeroSerie: `SN-${o.id}`, fabricante: o.fabricante === undefined ? "Dell" : o.fabricante,
    modelo: "M1", codigoBarrasInterno: `GC-${o.id}`, estadoFisico: o.estado ?? EstadoFisico.BOM,
    status: o.status ?? (o.triagem ? StatusEquipamento.TRIADO : StatusEquipamento.AGUARDANDO_TRIAGEM),
    criadoEm: o.cadastro, movimentacoes: movs,
  };
}

console.log("\n=== 1. Biblioteca estatistica ===");
afirmar(media([1, 2, 3, 4]) === 2.5, "media([1,2,3,4]) = 2,5");
afirmar(mediana([1, 2, 3, 4]) === 2.5 && mediana([5, 1, 3]) === 3, "mediana de quantidade par e impar");
afirmar(perto(desvioPadrao([2, 4, 4, 4, 5, 5, 7, 9]), 2, 1e-9), "desvio-padrao populacional do exemplo classico = 2");
afirmar(perto(percentil([1, 2, 3, 4, 5], 90), 4.6, 1e-9) && percentil([7], 50) === 7, "percentil 90 por interpolacao linear = 4,6");
afirmar(media([]) === null && mediana([]) === null && desvioPadrao([]) === null, "colecoes vazias devolvem null (nunca NaN)");
const reg = regressaoLinear([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }]);
afirmar(!!reg && perto(reg.inclinacao, 2, 1e-9) && perto(reg.intercepto, 1, 1e-9) && perto(reg.r2, 1, 1e-9), "OLS em y = 1 + 2x recupera inclinacao 2, intercepto 1 e R2 = 1");
const regRuido = regressaoLinear([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 3 }]);
afirmar(!!regRuido && perto(regRuido.inclinacao, 0.9, 1e-9) && (regRuido.r2 as number) < 1, "OLS com ruido: inclinacao 0,9 e R2 < 1");
afirmar(regressaoLinear([{ x: 1, y: 1 }]) === null && regressaoLinear([{ x: 2, y: 1 }, { x: 2, y: 5 }]) === null, "OLS sem pontos suficientes ou com x constante -> null");
afirmar(regressaoLinear([{ x: 0, y: 3 }, { x: 5, y: 3 }])?.r2 === null, "OLS com y constante -> R2 null (indefinido)");
afirmar(arredondar(1.23456, 2) === 1.23 && arredondar(NaN) === null && arredondar(null) === null, "arredondar a 2 casas e trata NaN/null como null");

console.log("\n=== 2. CSV seguro ===");
const csv = paraCsv([{ nome: "Ana, Silva", nota: 'diz "oi"', formula: "=1+1", n: 3.5, vazio: null }]);
afirmar(csv.startsWith("\uFEFF"), "CSV comeca com BOM UTF-8 (Excel/Windows)");
afirmar(csv.includes('"Ana, Silva"') && csv.includes('"diz ""oi"""'), "virgulas e aspas escapadas (RFC 4180)");
afirmar(csv.includes(",'=1+1,"), "texto iniciado por '=' recebe apostrofo (protecao contra CSV injection)");
afirmar(csv.includes(",3.5,"), "numeros nao sao alterados");
afirmar(paraCsv([{ a: -5 }]).includes("\r\n-5\r\n"), "numero negativo NAO recebe apostrofo");

console.log("\n=== 3. Eficiencia operacional ===");
const eqs: EquipamentoAnalitico[] = [
  // Lote A: 2 triagens por ana (2h e 4h); ultimo equipamento triado 5h apos a entrada -> 5h
  eq({ id: "a1", lote: "A", cadastro: em(1 * H), triagem: { quando: em(3 * H), usuario: "ana" } }),
  eq({ id: "a2", lote: "A", cadastro: em(1 * H), triagem: { quando: em(5 * H), usuario: "ana" } }),
  eq({ id: "b1", lote: "B", cadastro: em(1 * H), triagem: { quando: em(11 * H), usuario: "bia" } }),
  eq({ id: "c1", lote: "C", cadastro: em(1 * H), triagem: { quando: em(4 * H), usuario: "ana" } }),
  eq({ id: "e1", lote: "E", cadastro: em(1 * H), triagem: { quando: em(10 * H), usuario: "bia" } }),
  eq({ id: "e2", lote: "E", cadastro: em(1 * H), triagem: { quando: em(12 * H), usuario: "bia" } }),
  eq({ id: "f1", lote: "F", cadastro: em(1 * H), triagem: { quando: em(41 * H), usuario: "caio" } }),
  // Lote G em outubro (periodo diferente)
  eq({ id: "g1", lote: "G", entrada: "2026-10-01", cadastro: new Date("2026-10-01T01:00:00Z"), triagem: { quando: new Date("2026-10-01T03:00:00Z"), usuario: "caio" } }),
  // Lote D: um triado (ana 1h) e outro pendente -> em andamento
  eq({ id: "d1", lote: "D", cadastro: em(1 * H), triagem: { quando: em(2 * H), usuario: "ana" } }),
  eq({ id: "d2", lote: "D", cadastro: em(1 * H) }),
];
const ef = calcularEficiencia(eqs, em(100 * H));
afirmar(ef.resumo.lotesAnalisados === 7 && ef.resumo.lotesConcluidos === 6 && ef.resumo.lotesEmAndamento === 1, "7 lotes: 6 concluidos e 1 em andamento (lote com equipamento sem triagem)");
const duracao = (id: string) => ef.lotes.find((l) => l.loteId === id)?.duracaoHoras;
afirmar(duracao("A") === 5 && duracao("B") === 11 && duracao("C") === 4 && duracao("E") === 12 && duracao("F") === 41 && duracao("G") === 3, "duracao do lote = triagem do ULTIMO equipamento - data de entrada (A=5h, B=11h, C=4h, E=12h, F=41h, G=3h)");
afirmar(duracao("D") === null && ef.lotes.find((l) => l.loteId === "D")?.situacao === "EM_ANDAMENTO", "lote D nao tem duracao (EM_ANDAMENTO)");
afirmar(perto(ef.resumo.tempoMedioHoras, 12.67) && ef.resumo.medianaHoras === 8 && ef.resumo.minimoHoras === 3 && ef.resumo.maximoHoras === 41, "media 12,67h, mediana 8h, minimo 3h, maximo 41h");
const op = (u: string) => ef.porOperador.find((o) => o.usuario === u);
afirmar(op("ana")?.triagens === 4 && perto(op("ana")?.tempoMedioHoras, 2.5), "operador ana: 4 triagens, tempo medio 2,5h (cadastro -> triagem)");
afirmar(op("bia")?.triagens === 3 && perto(op("bia")?.tempoMedioHoras, 10), "operador bia: 3 triagens, tempo medio 10h");
afirmar(ef.gargalos.operadorMaisLento?.usuario === "bia" && perto(ef.gargalos.operadorMaisLento.razaoSobreMediaGeral, 1.1), "gargalo: operador mais lento = bia (~1,1x a media geral); caio fica de fora por ter < 3 triagens");
afirmar(ef.gargalos.lotesAtipicos.length === 1 && ef.gargalos.lotesAtipicos[0].loteId === "F", "gargalo: apenas o lote F (41h) excede media + 1,5 desvio");
afirmar(ef.porMes.length === 2 && ef.porMes[0].mes === "2026-10" && ef.porMes[0].tempoMedioHoras === 3 && ef.gargalos.mesMaisLento?.mes === "2026-11", "variacao por periodo: outubro (3h) vs novembro; mes mais lento = 2026-11");
const efVazio = calcularEficiencia([], em(0));
afirmar(efVazio.resumo.lotesAnalisados === 0 && efVazio.resumo.tempoMedioHoras === null && efVazio.gargalos.operadorMaisLento === null, "sem dados: resumo vazio com null (sem erro)");

console.log("\n=== 4. Rentabilidade por tipo/estado/marca ===");
const agora = new Date();
const rent = [
  eq({ id: "r1", lote: "R", cadastro: agora, tipo: TipoEquipamento.SERVIDOR, estado: EstadoFisico.NOVO, fabricante: "Dell" }),
  eq({ id: "r2", lote: "R", cadastro: agora, tipo: TipoEquipamento.SERVIDOR, estado: EstadoFisico.NOVO, fabricante: "Dell" }),
  eq({ id: "r3", lote: "R", cadastro: agora, tipo: TipoEquipamento.SERVIDOR, estado: EstadoFisico.INSERVIVEL, fabricante: null }),
  eq({ id: "r4", lote: "R", cadastro: agora, tipo: TipoEquipamento.MONITOR, estado: EstadoFisico.BOM, fabricante: "LG" }),
];
const rr = calcularRentabilidade(rent, { aliquotaImpostoPercentual: 10, coeficienteDepreciacaoAnual: 0 }, agora);
afirmar(rr.totais.quantidade === 4, "4 equipamentos analisados");
const srvNovo = rr.porTipoEEstado.find((g) => g.tipo === "SERVIDOR" && g.estadoFisico === "NOVO");
afirmar(srvNovo?.quantidade === 2 && srvNovo.valorMedio === 6000 && srvNovo.valorLiquidoMedio === 5400, "SERVIDOR NOVO: 2 itens, valor medio R$ 6.000 e liquido R$ 5.400 (10% de imposto) - mesma regra da AV2");
afirmar(rr.ranking[0].tipo === "SERVIDOR" && rr.ranking[0].estadoFisico === "NOVO" && rr.ranking[0].posicao === 1, "ranking de prioridade: SERVIDOR NOVO em 1o lugar");
afirmar(rr.porTipo[0].tipo === "SERVIDOR" && rr.porTipo[0].quantidade === 3, "porTipo ordenado por valor medio: SERVIDOR (3 itens) antes de MONITOR");
afirmar(rr.porFabricante.some((f) => f.fabricante === "(nao informado)" && f.quantidade === 1) && rr.porFabricante.find((f) => f.fabricante === "Dell")?.quantidade === 2, "agrupamento por fabricante inclui '(nao informado)'");
afirmar(rr.porModelo.length === 3 && rr.observacoes.length === 2, "agrupamento por fabricante+modelo e observacoes de metodo presentes");
afirmar(perto(rr.totais.valorTotal, rr.equipamentos.reduce((s, l) => s + l.valorResidual, 0)) && perto(rr.totais.valorLiquido, rr.totais.valorTotal - rr.totais.impostoEstimado), "totais consistentes com as linhas");
const rrVazio = calcularRentabilidade([], { aliquotaImpostoPercentual: 0, coeficienteDepreciacaoAnual: 0 }, agora);
afirmar(rrVazio.totais.valorMedio === null && rrVazio.ranking.length === 0, "sem dados: valores medios null e ranking vazio");

console.log("\n=== 5. Vida util remanescente (regressao) ===");
// 3 notebooks com degradacao perfeitamente linear: estado = 4 - 0,01 * dias  (CADASTRO=4 em 0d; 3 em 100d; 2 em 200d)
function notebookLinear(id: string, estadoAtual: EstadoFisico, status = StatusEquipamento.TRIADO): EquipamentoAnalitico {
  const base = new Date("2026-01-01T00:00:00Z");
  const mv = (dias: number, estado: EstadoFisico, tipo: TipoMovimentacao) => mov(tipo, new Date(base.getTime() + dias * D), "gestor", estado);
  return eq({
    id, lote: "V", cadastro: base, estado: estadoAtual, status,
    movs: [mv(0, EstadoFisico.NOVO, TipoMovimentacao.CADASTRO), mv(100, EstadoFisico.BOM, TipoMovimentacao.TRIAGEM), mv(200, EstadoFisico.REGULAR, TipoMovimentacao.MUDANCA_ESTADO)],
  });
}
const vNow = new Date("2026-11-20T00:00:00Z");
const vida = calcularVidaUtil(
  [notebookLinear("n1", EstadoFisico.REGULAR), notebookLinear("n2", EstadoFisico.BOM), notebookLinear("n3", EstadoFisico.REGULAR, StatusEquipamento.RECICLADO)],
  { coeficienteDepreciacaoAnual: 20, agora: vNow }
);
const tn = vida.porTipo.find((t) => t.tipo === "NOTEBOOK");
afirmar(tn?.modelo === "OLS" && tn.amostras === 9 && perto(tn.inclinacaoPorDia, -0.01, 1e-6) && perto(tn.interceptoEstado, 4, 1e-3) && perto(tn.r2, 1, 1e-3), "tipo com dados suficientes usa OLS: 9 observacoes, inclinacao -0,01/dia, intercepto 4, R2 = 1");
const n1 = vida.equipamentos.find((e) => e.equipamentoId === "n1");
const n2 = vida.equipamentos.find((e) => e.equipamentoId === "n2");
afirmar(perto(n1?.diasRestantes, 200, 0.2) && perto(n2?.diasRestantes, 300, 0.2), "projecao = estado atual / |inclinacao|: REGULAR(2) -> 200 dias; BOM(3) -> 300 dias");
afirmar(n1?.dataProjetadaInservivel === new Date(vNow.getTime() + 200 * D).toISOString().slice(0, 10), "data projetada para INSERVIVEL = hoje + dias restantes");
const n3 = vida.equipamentos.find((e) => e.equipamentoId === "n3");
afirmar(n3?.dataProjetadaInservivel === null && tn?.equipamentosAtivos === 2, "equipamento RECICLADO sai da projecao (nao conta como ativo)");
afirmar(tn?.vidaUtilRestanteDias?.mediana === 250 && tn.vidaUtilRestanteDias.minimo === 200 && tn.vidaUtilRestanteDias.maximo === 300, "resumo do tipo (ativos): mediana 250, minimo 200, maximo 300 dias");

const pouco = calcularVidaUtil([eq({ id: "p1", lote: "P", cadastro: new Date("2026-10-01T00:00:00Z"), estado: EstadoFisico.BOM, tipo: TipoEquipamento.DESKTOP })], { coeficienteDepreciacaoAnual: 20, agora: vNow });
const pd = pouco.porTipo[0];
afirmar(pd.modelo === "DEPRECIACAO_PARAMETRO" && /insuficientes/.test(pd.motivoModelo), "poucas amostras -> fallback na depreciacao parametrizada, com motivo explicito");
afirmar(perto(pouco.equipamentos[0].diasRestantes, 3 / ((4 * 0.2) / 365.25), 0.2), "fallback: BOM(3) com 20%/ano => 3 / (0,8/365,25) = ~1.369,7 dias");

// dados sem degradacao (estado constante) -> inclinacao 0 -> fallback
function constante(id: string): EquipamentoAnalitico {
  const base = new Date("2026-01-01T00:00:00Z");
  return eq({ id, lote: "K", cadastro: base, estado: EstadoFisico.BOM, tipo: TipoEquipamento.MONITOR, movs: [0, 50, 100].map((d, i) => mov(i === 0 ? TipoMovimentacao.CADASTRO : TipoMovimentacao.TRIAGEM, new Date(base.getTime() + d * D), "g", EstadoFisico.BOM)) });
}
const semDeg = calcularVidaUtil([constante("k1"), constante("k2"), constante("k3")], { coeficienteDepreciacaoAnual: 20, agora: vNow });
afirmar(semDeg.porTipo[0].modelo === "DEPRECIACAO_PARAMETRO" && /nao mostram degradacao/.test(semDeg.porTipo[0].motivoModelo), "dados sem degradacao observavel -> fallback (nao projeta vida infinita)");
const zero = calcularVidaUtil([eq({ id: "z1", lote: "Z", cadastro: vNow, estado: EstadoFisico.INSERVIVEL })], { coeficienteDepreciacaoAnual: 20, agora: vNow });
afirmar(zero.equipamentos[0].diasRestantes === 0, "equipamento ja INSERVIVEL: 0 dias restantes");
const semCoef = calcularVidaUtil([eq({ id: "s1", lote: "S", cadastro: vNow, estado: EstadoFisico.BOM })], { coeficienteDepreciacaoAnual: 0, agora: vNow });
afirmar(semCoef.equipamentos[0].diasRestantes === null && semCoef.resumo.comPrevisao === 0, "sem depreciacao parametrizada e sem dados: sem previsao (null), sem erro");

console.log("\n" + "=".repeat(64));
console.log(`RESULTADO: ${total - falhas}/${total} verificacoes passaram.`);
console.log("=".repeat(64));
if (falhas > 0) process.exit(1);
