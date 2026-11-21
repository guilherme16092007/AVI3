import { randomUUID } from "crypto";
import { carregarAmbiente } from "../../src/server/config/env";
import { ErroNaoEncontrado, ErroPermissao } from "../../src/server/erros";
import { AgendadorTarefas } from "../../src/server/fila/AgendadorTarefas";
import { correspondeCron, parseCron, proximaExecucao } from "../../src/server/fila/cron";
import { calcularBackoffMs, erroRecuperavel } from "../../src/server/fila/politicaRetry";
import { ProcessadorTarefas } from "../../src/server/fila/ProcessadorTarefas";
import { LimitadorTaxa } from "../../src/server/plugins/limiteTaxa";
import { TarefaRegistro } from "../../src/server/repositorios/portas";
import { criarServicos } from "../../src/server/servicos";
import { FormatoSaida, StatusTarefa, TipoRelatorio } from "../../src/server/tiposAv3";
import { ErroValidacao } from "../../src/types";
import { BancoMemoria } from "./memoria";

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
const dorme = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log("\n=== 1. Cron (agendamento por tempo) ===");
  const local = (a: number, m: number, d: number, h = 0, mi = 0) => new Date(a, m - 1, d, h, mi, 0, 0);
  let prox = proximaExecucao("0 2 * * *", local(2026, 11, 20, 10, 0));
  afirmar(prox?.getTime() === local(2026, 11, 21, 2, 0).getTime(), "'0 2 * * *' apos 20/11 10:00 -> 21/11 02:00");
  prox = proximaExecucao("0 2 * * *", local(2026, 11, 20, 1, 0));
  afirmar(prox?.getTime() === local(2026, 11, 20, 2, 0).getTime(), "'0 2 * * *' apos 20/11 01:00 -> 20/11 02:00 (mesmo dia)");
  prox = proximaExecucao("*/15 * * * *", local(2026, 11, 20, 10, 7));
  afirmar(prox?.getTime() === local(2026, 11, 20, 10, 15).getTime(), "'*/15 * * * *' apos 10:07 -> 10:15");
  afirmar(proximaExecucao("0 2 * * *", local(2026, 11, 21, 2, 0))?.getTime() === local(2026, 11, 22, 2, 0).getTime(), "proxima execucao e ESTRITAMENTE posterior ao instante dado");
  prox = proximaExecucao("30 8 * * 1", local(2026, 11, 20, 0, 0)); // 20/11/2026 e sexta
  afirmar(prox?.getDay() === 1 && prox.getHours() === 8 && prox.getMinutes() === 30 && prox.getDate() === 23, "'30 8 * * 1' (segunda 08:30) apos sexta 20/11 -> 23/11");
  const c = parseCron("0 0 1 * 1");
  afirmar(correspondeCron(c, local(2026, 12, 1)) && correspondeCron(c, local(2026, 11, 23)) && !correspondeCron(c, local(2026, 11, 24)), "dia-do-mes e dia-da-semana restritos => OR (semantica padrao do cron)");
  afirmar(parseCron("0 0 * * 7").diaSemana.has(0), "dia da semana 7 equivale a domingo");
  afirmar(parseCron("1-5,10 */6 * * *").minuto.size === 6 && parseCron("1-5,10 */6 * * *").hora.size === 4, "listas, intervalos e passos (1-5,10 e */6)");
  for (const invalida of ["", "* * * *", "61 * * * *", "*/0 * * * *", "a b c d e", "5-1 * * * *"]) {
    let lancou = false;
    try { parseCron(invalida); } catch { lancou = true; }
    afirmar(lancou, `expressao invalida rejeitada: '${invalida}'`);
  }

  console.log("\n=== 2. Politica de retry ===");
  const sem = { baseMs: 1000, maxMs: 10_000, aleatorio: () => 0 };
  afirmar(calcularBackoffMs(1, sem) === 1000 && calcularBackoffMs(2, sem) === 2000 && calcularBackoffMs(3, sem) === 4000, "backoff exponencial: 1s, 2s, 4s");
  afirmar(calcularBackoffMs(10, sem) === 10_000, "backoff limitado ao teto (maxMs)");
  afirmar(calcularBackoffMs(1, { ...sem, aleatorio: () => 1 }) === 1200, "jitter de ate 20% somado ao atraso");
  afirmar(!erroRecuperavel(new ErroValidacao("x")) && !erroRecuperavel(new ErroNaoEncontrado("x")) && !erroRecuperavel(new ErroPermissao("x")), "erros de validacao/404/403 NAO sofrem retry");
  afirmar(erroRecuperavel(new Error("conexao recusada")), "erro generico (infra) e recuperavel");

  console.log("\n=== 3. Processador da fila: sucesso, retry com backoff e falha definitiva ===");
  const banco = new BancoMemoria();
  let agoraMs = new Date("2026-11-20T12:00:00Z").getTime();
  const relogio = () => new Date(agoraMs);
  const novaTarefa = async (chave: string | null = null, max = 3) =>
    (await banco.repos.tarefas.criar({
      id: randomUUID(), tipo: "GERAR_RELATORIO", payload: { tipo: TipoRelatorio.EFICIENCIA_OPERACIONAL }, formato: FormatoSaida.JSON,
      maxTentativas: max, proximaExecucaoEm: relogio(), chaveIdempotencia: chave, solicitanteId: null, chaveApiId: null,
    })).tarefa;
  const estadoDe = async (id: string): Promise<TarefaRegistro> => (await banco.repos.tarefas.buscarPorId(id)) as TarefaRegistro;

  let chamadas = 0;
  let comportamento: (t: TarefaRegistro) => Promise<{ relatorioId: string; conteudo: string; mime: string }> = async () => ({ relatorioId: "r", conteudo: "{}", mime: "application/json" });
  const proc = new ProcessadorTarefas({
    tarefas: banco.repos.tarefas, executar: (t) => { chamadas += 1; return comportamento(t); },
    concorrencia: 2, intervaloMs: 10, leaseMs: 60_000, backoffBaseMs: 1000, relogio, aleatorio: () => 0,
  });

  let t = await novaTarefa();
  afirmar((await proc.processarCiclo()) === 1, "ciclo processa a tarefa pendente");
  let e = await estadoDe(t.id);
  afirmar(e.status === StatusTarefa.CONCLUIDA && e.tentativas === 1 && e.resultadoConteudo === "{}" && e.concluidaEm !== null, "tarefa CONCLUIDA na 1a tentativa com resultado salvo");
  afirmar((await proc.processarCiclo()) === 0, "fila vazia: ciclo nao processa nada");

  // retry: falha 2x e sucesso na 3a
  let falhasRestantes = 2;
  comportamento = async () => {
    if (falhasRestantes-- > 0) throw new Error("banco indisponivel");
    return { relatorioId: "r2", conteudo: "ok", mime: "text/plain" };
  };
  t = await novaTarefa();
  await proc.processarCiclo();
  e = await estadoDe(t.id);
  afirmar(e.status === StatusTarefa.PENDENTE && e.tentativas === 1 && e.ultimoErro === "banco indisponivel" && e.proximaExecucaoEm.getTime() === agoraMs + 1000, "1a falha: volta a PENDENTE com retry em +1s e erro registrado");
  afirmar((await proc.processarCiclo()) === 0, "antes do backoff vencer a tarefa NAO e reexecutada");
  agoraMs += 1000;
  await proc.processarCiclo();
  e = await estadoDe(t.id);
  afirmar(e.status === StatusTarefa.PENDENTE && e.tentativas === 2 && e.proximaExecucaoEm.getTime() === agoraMs + 2000, "2a falha: novo retry em +2s (backoff exponencial)");
  agoraMs += 2000;
  await proc.processarCiclo();
  e = await estadoDe(t.id);
  afirmar(e.status === StatusTarefa.CONCLUIDA && e.tentativas === 3 && e.ultimoErro === null, "3a tentativa conclui; erro anterior limpo");

  // falha definitiva por esgotar tentativas
  comportamento = async () => { throw new Error("sempre falha"); };
  t = await novaTarefa(null, 2);
  await proc.processarCiclo();
  agoraMs += 1000;
  await proc.processarCiclo();
  e = await estadoDe(t.id);
  afirmar(e.status === StatusTarefa.FALHA && e.tentativas === 2 && e.ultimoErro === "sempre falha" && e.concluidaEm !== null, "esgotadas as tentativas (2): FALHA definitiva com o ultimo erro");
  agoraMs += 3_600_000;
  afirmar((await proc.processarCiclo()) === 0, "tarefa FALHA nao e mais reexecutada");

  // erro nao recuperavel: 1 tentativa apenas
  comportamento = async () => { throw new ErroValidacao("payload invalido"); };
  t = await novaTarefa(null, 5);
  await proc.processarCiclo();
  e = await estadoDe(t.id);
  afirmar(e.status === StatusTarefa.FALHA && e.tentativas === 1, "erro de validacao: FALHA imediata (sem gastar retries inuteis)");

  console.log("\n=== 4. Lease (worker que morre) e concorrencia ===");
  comportamento = async () => ({ relatorioId: "r3", conteudo: "recuperada", mime: "text/plain" });
  t = await novaTarefa();
  const reivindicadas = await banco.repos.tarefas.reivindicar(relogio(), 60_000, 5);
  afirmar(reivindicadas.length === 1 && reivindicadas[0].status === StatusTarefa.EM_EXECUCAO, "worker A reivindica a tarefa (EM_EXECUCAO)");
  afirmar((await banco.repos.tarefas.reivindicar(relogio(), 60_000, 5)).length === 0, "worker B NAO consegue reivindicar a mesma tarefa (sem execucao duplicada)");
  await proc.processarCiclo();
  afirmar((await estadoDe(t.id)).status === StatusTarefa.EM_EXECUCAO, "enquanto o lease vale a tarefa continua com o worker A");
  agoraMs += 61_000; // worker A morreu: lease expirou
  afirmar((await proc.processarCiclo()) === 1, "lease expirado: tarefa devolvida a fila e executada por outro worker");
  e = await estadoDe(t.id);
  afirmar(e.status === StatusTarefa.CONCLUIDA && e.tentativas === 2 && e.resultadoConteudo === "recuperada", "tarefa recuperada concluida na 2a tentativa");

  t = await novaTarefa(null, 1);
  await banco.repos.tarefas.reivindicar(relogio(), 1000, 1);
  agoraMs += 5000;
  comportamento = async () => { throw new Error("nao deveria rodar"); };
  await proc.processarCiclo();
  e = await estadoDe(t.id);
  afirmar(e.status === StatusTarefa.FALHA && /Lease expirado/.test(e.ultimoErro ?? ""), "lease expirado com tentativas esgotadas -> FALHA (evita laco infinito)");

  comportamento = async () => ({ relatorioId: "r", conteudo: "x", mime: "text/plain" });
  for (let i = 0; i < 5; i++) await novaTarefa();
  afirmar((await proc.processarCiclo()) === 2 && (await proc.processarCiclo()) === 2 && (await proc.processarCiclo()) === 1, "concorrencia 2: 5 tarefas processadas em ciclos de 2+2+1");

  console.log("\n=== 5. Idempotencia e agendador ===");
  const a = await banco.repos.tarefas.criar({ id: randomUUID(), tipo: "GERAR_RELATORIO", payload: {}, formato: FormatoSaida.JSON, maxTentativas: 3, proximaExecucaoEm: relogio(), chaveIdempotencia: "k1", solicitanteId: null, chaveApiId: null });
  const b = await banco.repos.tarefas.criar({ id: randomUUID(), tipo: "GERAR_RELATORIO", payload: {}, formato: FormatoSaida.JSON, maxTentativas: 3, proximaExecucaoEm: relogio(), chaveIdempotencia: "k1", solicitanteId: null, chaveApiId: null });
  afirmar(a.criada && !b.criada && a.tarefa.id === b.tarefa.id, "mesma chave de idempotencia nao cria tarefa duplicada");

  const banco2 = new BancoMemoria();
  const servicos = criarServicos(banco2, { relogio });
  const agendador = new AgendadorTarefas(undefined, relogio);
  agendador.agendar("analises", "0 2 * * *", async (slot) => {
    for (const tipo of Object.values(TipoRelatorio)) await servicos.relatoriosAssincronos.enfileirarAgendado(tipo, slot);
  });
  const slot = new Date("2026-11-21T05:00:00Z");
  await agendador.dispararSlot("analises", slot);
  await agendador.dispararSlot("analises", slot); // segunda instancia disparando o MESMO slot
  afirmar(banco2.estado.tarefas.length === 3, "disparo do mesmo slot por 2 instancias gera apenas 3 tarefas (1 por tipo de relatorio)");
  await agendador.dispararSlot("analises", new Date("2026-11-22T05:00:00Z"));
  afirmar(banco2.estado.tarefas.length === 6, "slot seguinte gera novas 3 tarefas");
  let lancou = false;
  try { agendador.agendar("ruim", "isto nao e cron", async () => undefined); } catch { lancou = true; }
  afirmar(lancou, "agendar com expressao cron invalida falha na hora");

  // o processador executa as tarefas agendadas de ponta a ponta (gera relatorio persistido)
  const procReal = new ProcessadorTarefas({
    tarefas: banco2.repos.tarefas, executar: (tr) => servicos.relatoriosAssincronos.executar(tr),
    concorrencia: 6, intervaloMs: 10, leaseMs: 60_000, backoffBaseMs: 1000, relogio,
  });
  await procReal.processarCiclo();
  afirmar(banco2.estado.tarefas.every((x) => x.status === StatusTarefa.CONCLUIDA) && banco2.estado.relatorios.length === 6, "worker real: 6 tarefas agendadas concluidas e 6 relatorios persistidos (historico)");
  afirmar(banco2.estado.relatorios.every((r) => r.organizacaoId === null && r.origem === "AGENDADO"), "relatorios agendados sao globais e marcados com origem AGENDADO");

  console.log("\n=== 6. Loop em tempo real (iniciar/parar) ===");
  const banco3 = new BancoMemoria();
  let executadas = 0;
  const procLoop = new ProcessadorTarefas({
    tarefas: banco3.repos.tarefas, executar: async () => { executadas += 1; return { relatorioId: "x", conteudo: "y", mime: "text/plain" }; },
    concorrencia: 1, intervaloMs: 15, leaseMs: 60_000, backoffBaseMs: 1000,
  });
  procLoop.iniciar();
  const tl = (await banco3.repos.tarefas.criar({ id: randomUUID(), tipo: "GERAR_RELATORIO", payload: {}, formato: FormatoSaida.JSON, maxTentativas: 3, proximaExecucaoEm: new Date(), chaveIdempotencia: null, solicitanteId: null, chaveApiId: null })).tarefa;
  for (let i = 0; i < 100 && (await banco3.repos.tarefas.buscarPorId(tl.id))?.status !== StatusTarefa.CONCLUIDA; i++) await dorme(20);
  await procLoop.parar();
  afirmar(executadas === 1 && (await banco3.repos.tarefas.buscarPorId(tl.id))?.status === StatusTarefa.CONCLUIDA, "worker em segundo plano pega a tarefa sozinho e conclui");
  const antes = executadas;
  await banco3.repos.tarefas.criar({ id: randomUUID(), tipo: "GERAR_RELATORIO", payload: {}, formato: FormatoSaida.JSON, maxTentativas: 3, proximaExecucaoEm: new Date(), chaveIdempotencia: null, solicitanteId: null, chaveApiId: null });
  await dorme(80);
  afirmar(executadas === antes, "apos parar(), o worker nao reivindica novas tarefas (encerramento gracioso)");

  console.log("\n=== 7. Limitador de taxa (janela deslizante) ===");
  let tms = 0;
  const lim = new LimitadorTaxa(60_000, () => tms);
  const r1 = lim.consumir("k", 3);
  afirmar(r1.permitido && r1.restante === 2 && r1.limite === 3, "1a requisicao: permitida, restam 2");
  lim.consumir("k", 3);
  lim.consumir("k", 3);
  const r4 = lim.consumir("k", 3);
  afirmar(!r4.permitido && r4.restante === 0 && r4.reiniciaEmSeg >= 1, "4a requisicao na janela: bloqueada (429) com tempo de espera");
  afirmar(lim.consumir("outra", 3).permitido, "chaves distintas tem contadores independentes");
  afirmar(lim.consultar("k", 3).permitido === false, "consultar() nao consome saldo");
  tms = 61_000;
  afirmar(!lim.consumir("k", 3).permitido, "logo apos a virada de janela AINDA bloqueia (sem rajada de 2x)");
  tms = 90_000;
  afirmar(lim.consumir("k", 3).permitido, "com a janela anterior pesando 50%, volta a liberar");
  tms = 400_000;
  afirmar(lim.consumir("k", 3).restante === 2, "apos muito tempo o saldo se recompoe totalmente");

  console.log("\n=== 8. Configuracao por ambiente ===");
  const base = { DATABASE_URL: "postgresql://u:p@localhost:5432/d", JWT_SECRET: "x".repeat(40) };
  const amb = carregarAmbiente(base);
  afirmar(amb.WORKER_HABILITADO === true && amb.ANALISE_CRON === "0 2 * * *" && amb.JOBS_MAX_TENTATIVAS === 3 && amb.API_LIMITE_PADRAO_POR_MINUTO === 60, "padroes da AV3: worker ligado, cron 02:00, 3 tentativas, 60 req/min");
  afirmar(carregarAmbiente({ ...base, ANALISE_CRON: "" }).ANALISE_CRON === "" && carregarAmbiente({ ...base, WORKER_HABILITADO: "false" }).WORKER_HABILITADO === false, "cron vazio desliga o agendador; WORKER_HABILITADO=false desliga o worker embutido");
  for (const [k, v] of [["ANALISE_CRON", "tudo errado"], ["WORKER_HABILITADO", "talvez"], ["JOBS_MAX_TENTATIVAS", "0"]] as const) {
    let rejeitou = false;
    try { carregarAmbiente({ ...base, [k]: v }); } catch { rejeitou = true; }
    afirmar(rejeitou, `ambiente invalido rejeitado na inicializacao: ${k}=${v}`);
  }

  console.log("\n" + "=".repeat(64));
  console.log(`RESULTADO: ${total - falhas}/${total} verificacoes passaram.`);
  console.log("=".repeat(64));
  if (falhas > 0) process.exit(1);
}

main().catch((erro) => {
  console.error("Falha inesperada:", erro);
  process.exit(1);
});
