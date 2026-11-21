import { createHash } from "crypto";
import { HashService } from "../../src/crypto/HashService";
import { construirApp } from "../../src/server/app";
import { ProcessadorTarefas } from "../../src/server/fila/ProcessadorTarefas";
import { LimitadorTaxa } from "../../src/server/plugins/limiteTaxa";
import { criarServicos } from "../../src/server/servicos";
import { StatusTarefa } from "../../src/server/tiposAv3";
import { ErroNaoAutenticado } from "../../src/server/erros";
import { Papel } from "../../src/types";
import { BancoMemoria, dataRelativa, gerarCnpj } from "./memoria";

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

interface Resposta {
  status: number;
  corpo: any;
  texto: string;
  cab: Record<string, any>;
}

async function main(): Promise<void> {
  const banco = new BancoMemoria();
  const adminId = "00000000-0000-4000-8000-000000000001";
  await banco.repos.usuarios.criar({ id: adminId, username: "admin", papel: Papel.ADMINISTRADOR, senhaHash: HashService.gerarHash("AdminSenha123") });

  let relogioMs = Date.now();
  const relogio = () => new Date(relogioMs);
  const servicos = criarServicos(banco, { limiteTarefasAtivasPorChave: 2, maxTentativasTarefa: 3, relogio });
  const limitador = new LimitadorTaxa();
  const app = await construirApp({
    servicos, jwtSecret: "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres", jwtExpiresIn: "30m",
    logger: false, verificarBanco: async () => undefined, limiteFalhasChavePorIp: 5, limitador,
  });
  const worker = new ProcessadorTarefas({
    tarefas: banco.repos.tarefas, executar: (t) => servicos.relatoriosAssincronos.executar(t),
    concorrencia: 4, intervaloMs: 10, leaseMs: 60_000, backoffBaseMs: 1000, relogio,
  });

  const chamar = async (metodo: "GET" | "POST" | "PATCH", url: string, opc: { token?: string; chave?: string; corpo?: unknown } = {}): Promise<Resposta> => {
    const headers: Record<string, string> = {};
    if (opc.token) headers.authorization = `Bearer ${opc.token}`;
    if (opc.chave) headers["x-api-key"] = opc.chave;
    const r = await app.inject({ method: metodo, url, headers, payload: opc.corpo as object | undefined });
    let corpo: any = null;
    try { corpo = r.json(); } catch { corpo = null; }
    return { status: r.statusCode, corpo, texto: r.body, cab: r.headers };
  };
  const login = async (u: string, s: string) => (await chamar("POST", "/auth/login", { corpo: { username: u, senha: s } })).corpo.token as string;
  const PUB = "/api/v1/public";
  const INT = "/api/v1/internal";
  const ADM = "/api/v1/admin";

  console.log("\n=== 1. Preparacao: usuarios, organizacoes, lotes e triagens ===");
  const tokenAdmin = await login("admin", "AdminSenha123");
  const ids: Record<string, string> = {};
  for (const [u, papel] of [["operador", "OPERADOR_CADASTRO"], ["gestor", "GESTOR_ALMOXARIFADO"], ["auditor", "AUDITOR"]] as const) {
    const r = await chamar("POST", "/usuarios", { token: tokenAdmin, corpo: { username: u, senha: `${u}Senha1`, papel } });
    ids[u] = r.corpo.id;
  }
  const tokenOperador = await login("operador", "operadorSenha1");
  const tokenGestor = await login("gestor", "gestorSenha1");
  const tokenAuditor = await login("auditor", "auditorSenha1");
  const criarOrg = async (base: string, nome: string): Promise<string> =>
    (await chamar("POST", "/organizacoes", { token: tokenOperador, corpo: { cnpj: gerarCnpj(base), razaoSocial: nome, tipo: "HOSPITAL", contatoResponsavel: "Resp", emailContato: "r@org.com" } })).corpo.id;
  const orgA = await criarOrg("111111110001", "Hospital A");
  const orgB = await criarOrg("222222220001", "Hospital B");
  const lote = async (org: string, nf: string, eqs: object[]): Promise<any> =>
    (await chamar("POST", "/lotes", { token: tokenGestor, corpo: { organizacaoId: org, notaFiscal: nf, transportadora: "TL", dataEntrada: dataRelativa(-3), equipamentos: eqs } })).corpo;
  const loteA = await lote(orgA, "NF-A", [
    { tipo: "NOTEBOOK", numeroSerie: "A1", codigoBarrasInterno: "GC-A1", fabricante: "Dell", modelo: "Latitude" },
    { tipo: "SERVIDOR", numeroSerie: "A2", codigoBarrasInterno: "GC-A2", fabricante: "HP", modelo: "DL380" },
  ]);
  const loteB = await lote(orgB, "NF-B", [{ tipo: "MONITOR", numeroSerie: "B1", codigoBarrasInterno: "GC-B1" }]);
  const detA = (await chamar("GET", `/lotes/${loteA.id}`, { token: tokenGestor })).corpo;
  const detB = (await chamar("GET", `/lotes/${loteB.id}`, { token: tokenGestor })).corpo;
  const eqA1 = detA.equipamentos[0].id as string;
  const eqA2 = detA.equipamentos[1].id as string;
  const eqB1 = detB.equipamentos[0].id as string;
  let r = await chamar("POST", `/equipamentos/${eqA1}/triagem`, { token: tokenGestor, corpo: { estadoFisico: "BOM" } });
  afirmar(r.status === 200, "preparacao: triagem do equipamento A1 (BOM)");
  r = await chamar("POST", `/equipamentos/${eqA2}/triagem`, { token: tokenGestor, corpo: { estadoFisico: "NOVO" } });
  afirmar(r.status === 200, "preparacao: triagem do equipamento A2 (NOVO)");

  console.log("\n=== 2. Administracao de chaves de API (/api/v1/admin) ===");
  const criar = (corpo: object, token = tokenAdmin) => chamar("POST", `${ADM}/chaves-api`, { token, corpo });
  r = await criar({ nome: "X", permissoes: ["LOTES_LER"], organizacaoId: orgA }, tokenGestor);
  afirmar(r.status === 403, "GESTOR nao gerencia chaves -> 403");
  r = await chamar("POST", `${ADM}/chaves-api`, { corpo: { nome: "X", permissoes: ["LOTES_LER"], organizacaoId: orgA } });
  afirmar(r.status === 401, "sem JWT -> 401 (API administrativa e interna)");
  r = await criar({ nome: "Sem escopo", permissoes: ["LOTES_LER"] });
  afirmar(r.status === 422, "chave sem escopo (organizacaoId ou escopoGlobal) -> 422: nao ha escopo global 'por esquecimento'");
  r = await criar({ nome: "Ambos", permissoes: ["LOTES_LER"], organizacaoId: orgA, escopoGlobal: true });
  afirmar(r.status === 422, "organizacaoId + escopoGlobal -> 422");
  r = await criar({ nome: "Escrita sem usuario", permissoes: ["LOTES_ESCREVER"], organizacaoId: orgA });
  afirmar(r.status === 422, "LOTES_ESCREVER exige usuarioServicoId -> 422");
  r = await criar({ nome: "Escrita operador", permissoes: ["LOTES_ESCREVER"], organizacaoId: orgA, usuarioServicoId: ids.operador });
  afirmar(r.status === 422, "usuario de servico sem papel para criar lotes -> 422");
  r = await criar({ nome: "Permissao inexistente", permissoes: ["SUPER_PODER"], organizacaoId: orgA });
  afirmar(r.status === 400, "permissao fora do enum -> 400");
  r = await criar({ nome: "Org inexistente", permissoes: ["LOTES_LER"], organizacaoId: "99999999-9999-4999-8999-999999999999" });
  afirmar(r.status === 422, "organizacao inexistente -> 422");
  r = await criar({ nome: "Expira no passado", permissoes: ["LOTES_LER"], organizacaoId: orgA, expiraEm: "2020-01-01T00:00:00Z" });
  afirmar(r.status === 422, "expiraEm no passado -> 422");

  const todas = ["RASTREABILIDADE_LER", "LOTES_LER", "LOTES_ESCREVER", "ANALISES_LER", "RELATORIOS_GERAR"];
  r = await criar({ nome: "Parceiro A (completo)", permissoes: todas, organizacaoId: orgA, usuarioServicoId: ids.gestor, limitePorMinuto: 1000 });
  afirmar(r.status === 201 && /^gck_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/.test(r.corpo.chaveSecreta) && r.corpo.chave.escopo === "ORGANIZACAO", "ADMIN cria chave: 201, segredo no formato gck_<prefixo>.<segredo>, escopo ORGANIZACAO");
  afirmar(r.cab["cache-control"] === "no-store" && !("hashChave" in r.corpo.chave), "resposta com segredo nao e cacheavel e nao expoe hashChave");
  const keyA: string = r.corpo.chaveSecreta;
  const keyAId: string = r.corpo.chave.id;
  const keyAVersao: number = r.corpo.chave.versao;
  const armazenada = banco.estado.chavesApi.find((c) => c.id === keyAId)!;
  afirmar(armazenada.hashChave === createHash("sha256").update(keyA).digest("hex") && !JSON.stringify(armazenada).includes(keyA.split(".")[1]), "banco guarda apenas o hash SHA-256: o segredo em claro NAO esta armazenado");

  r = await criar({ nome: "Parceiro A (so rastreio)", permissoes: ["RASTREABILIDADE_LER"], organizacaoId: orgA, limitePorMinuto: 1000 });
  const keyRO: string = r.corpo.chaveSecreta;
  r = await criar({ nome: "Parceiro A (so lotes)", permissoes: ["LOTES_LER"], organizacaoId: orgA, limitePorMinuto: 1000 });
  const keyLim: string = r.corpo.chaveSecreta;
  r = await criar({ nome: "Auditoria global", permissoes: ["LOTES_LER", "LOTES_ESCREVER", "ANALISES_LER", "RELATORIOS_GERAR", "RASTREABILIDADE_LER"], escopoGlobal: true, usuarioServicoId: ids.gestor, limitePorMinuto: 1000 });
  const keyG: string = r.corpo.chaveSecreta;
  afirmar(r.status === 201 && r.corpo.chave.escopo === "GLOBAL", "chave global exige escopoGlobal explicito e fica marcada como GLOBAL");

  r = await chamar("GET", `${ADM}/chaves-api`, { token: tokenAdmin });
  afirmar(r.status === 200 && r.corpo.total === 4 && !r.texto.includes(keyA) && !r.texto.includes("hashChave"), "listagem: 4 chaves, sem segredo e sem hash");
  r = await chamar("GET", `${ADM}/chaves-api/${keyAId}`, { token: tokenAdmin });
  afirmar(r.status === 200 && r.corpo.prefixo === keyA.slice(4, 16) && r.corpo.ultimoUsoEm === null, "detalhe da chave por id (prefixo identifica a chave sem revelar o segredo)");

  console.log("\n=== 3. Autenticacao por chave na API publica ===");
  r = await chamar("GET", `${PUB}/me`);
  afirmar(r.status === 401 && r.corpo.erro === "NAO_AUTENTICADO", "sem X-API-Key -> 401");
  r = await chamar("GET", `${PUB}/me`, { token: tokenAdmin });
  afirmar(r.status === 401, "JWT de usuario NAO substitui a chave de API na rota publica -> 401");
  r = await chamar("GET", `${PUB}/me`, { chave: "gck_000000000000.abc" });
  const msgInvalida = r.corpo.mensagem;
  afirmar(r.status === 401, "chave malformada -> 401");
  r = await chamar("GET", `${PUB}/me`, { chave: keyA.slice(0, -1) + (keyA.endsWith("a") ? "b" : "a") });
  afirmar(r.status === 401 && r.corpo.mensagem === msgInvalida, "segredo errado -> 401 com a MESMA mensagem (nao revela se o prefixo existe)");
  r = await chamar("GET", `${PUB}/me`, { chave: keyA });
  afirmar(r.status === 200 && r.corpo.nome === "Parceiro A (completo)" && r.corpo.escopo === "ORGANIZACAO" && r.corpo.permissoes.length === 5 && !("hashChave" in r.corpo), "chave valida: GET /me devolve identidade, permissoes e escopo (sem segredo)");
  afirmar(r.cab["x-api-version"] === "1" && r.cab["x-ratelimit-limit"] === "1000" && Number(r.cab["x-ratelimit-remaining"]) === 999, "respostas trazem X-API-Version e X-RateLimit-Limit/Remaining");
  afirmar(banco.estado.chavesApi.find((c) => c.id === keyAId)!.ultimoUsoEm !== null, "ultimo uso da chave e registrado");

  console.log("\n=== 4. Permissoes e escopo por organizacao ===");
  r = await chamar("GET", `${PUB}/rastreabilidade/equipamentos/${eqA1}`, { chave: keyRO });
  afirmar(r.status === 200 && r.corpo.equipamento.id === eqA1 && r.corpo.historico.length >= 2, "rastreabilidade do proprio equipamento: 200 com historico (cadastro + triagem)");
  afirmar(r.corpo.historico.every((h: any) => !("usuario" in h) && !("observacao" in h)) && r.corpo.historico.some((h: any) => h.tipo === "TRIAGEM"), "historico publico NAO expoe operador nem observacoes internas");
  r = await chamar("GET", `${PUB}/rastreabilidade/equipamentos/${eqB1}`, { chave: keyRO });
  afirmar(r.status === 404, "equipamento de OUTRA organizacao -> 404 (nao revela existencia)");
  r = await chamar("GET", `${PUB}/lotes`, { chave: keyRO });
  afirmar(r.status === 403 && /LOTES_LER/.test(r.corpo.mensagem), "chave sem LOTES_LER -> 403 informando a permissao faltante");
  r = await chamar("GET", `${PUB}/rastreabilidade/equipamentos/${eqA1}`, { chave: keyLim });
  afirmar(r.status === 403, "chave sem RASTREABILIDADE_LER -> 403");
  r = await chamar("GET", `${PUB}/rastreabilidade/equipamentos/nao-uuid`, { chave: keyRO });
  afirmar(r.status === 400, "id invalido -> 400");

  r = await chamar("GET", `${PUB}/lotes`, { chave: keyA });
  afirmar(r.status === 200 && r.corpo.total === 1 && r.corpo.itens[0].id === loteA.id, "listagem: chave da org A ve SOMENTE lotes da org A");
  r = await chamar("GET", `${PUB}/lotes?organizacaoId=${orgB}`, { chave: keyA });
  afirmar(r.status === 403, "pedir lotes de outra organizacao -> 403");
  r = await chamar("GET", `${PUB}/lotes/${loteB.id}`, { chave: keyA });
  afirmar(r.status === 404, "detalhe de lote de outra organizacao -> 404");
  r = await chamar("GET", `${PUB}/lotes/${loteA.id}`, { chave: keyA });
  afirmar(r.status === 200 && r.corpo.equipamentos.length === 2, "detalhe do proprio lote com equipamentos");
  r = await chamar("GET", `${PUB}/lotes`, { chave: keyG });
  afirmar(r.status === 200 && r.corpo.total === 2, "chave GLOBAL ve lotes de todas as organizacoes");
  r = await chamar("GET", `${PUB}/lotes?organizacaoId=${orgB}`, { chave: keyG });
  afirmar(r.status === 200 && r.corpo.total === 1 && r.corpo.itens[0].id === loteB.id, "chave global pode filtrar por organizacaoId");

  const corpoLote = { notaFiscal: "NF-API-1", transportadora: "TL", dataEntrada: dataRelativa(0), equipamentos: [{ tipo: "DESKTOP", numeroSerie: "API1", codigoBarrasInterno: "GC-API1", fabricante: "Lenovo", modelo: "M70" }] };
  r = await chamar("POST", `${PUB}/lotes`, { chave: keyA, corpo: corpoLote });
  afirmar(r.status === 201 && r.corpo.organizacaoId === orgA, "POST /lotes com LOTES_ESCREVER: 201 e lote criado na organizacao da chave");
  const loteApiId = r.corpo.id as string;
  const movCadastro = banco.estado.movimentacoes.filter((m) => m.usuarioId === ids.gestor && m.tipo === "CADASTRO").length;
  afirmar(movCadastro >= 3, "registros da API sao atribuidos ao usuario de servico (auditoria preservada)");
  r = await chamar("POST", `${PUB}/lotes`, { chave: keyA, corpo: { ...corpoLote, organizacaoId: orgB, notaFiscal: "NF-API-2" } });
  afirmar(r.status === 403, "criar lote em OUTRA organizacao -> 403");
  r = await chamar("POST", `${PUB}/lotes`, { chave: keyRO, corpo: corpoLote });
  afirmar(r.status === 403, "chave somente leitura nao cria lotes -> 403");
  r = await chamar("POST", `${PUB}/lotes`, { chave: keyG, corpo: { ...corpoLote, notaFiscal: "NF-API-3" } });
  afirmar(r.status === 422, "chave global sem organizacaoId -> 422");
  r = await chamar("POST", `${PUB}/lotes`, { chave: keyG, corpo: { ...corpoLote, notaFiscal: "NF-API-4", organizacaoId: orgB, equipamentos: [{ tipo: "MONITOR", numeroSerie: "G1", codigoBarrasInterno: "GC-G1" }] } });
  afirmar(r.status === 201 && r.corpo.organizacaoId === orgB, "chave global com organizacaoId explicito cria lote na organizacao informada");
  r = await chamar("POST", `${PUB}/lotes`, { chave: keyA, corpo: { transportadora: "TL" } });
  afirmar(r.status === 400, "corpo fora do contrato -> 400");
  r = await chamar("POST", `${PUB}/lotes`, { chave: keyA, corpo: { ...corpoLote, equipamentos: corpoLote.equipamentos, notaFiscal: "NF-API-5", dataEntrada: "2000-01-01" } });
  afirmar(r.status === 422, "regras de negocio do sistema interno valem na API (data retroativa alem do limite) -> 422");
  r = await chamar("POST", `${PUB}/lotes`, { chave: keyA, corpo: { ...corpoLote, notaFiscal: "NF-API-6", equipamentos: [{ ...corpoLote.equipamentos[0] }] } });
  afirmar(r.status === 409 || r.status === 422, "codigo de barras duplicado rejeitado pela regra de negocio existente");

  console.log("\n=== 5. Limite de requisicoes por chave (429) ===");
  r = await criar({ nome: "Parceiro com limite 3/min", permissoes: ["LOTES_LER"], organizacaoId: orgA, limitePorMinuto: 3 });
  const keyTres: string = r.corpo.chaveSecreta;
  const respostas: Resposta[] = [];
  for (let i = 0; i < 4; i++) respostas.push(await chamar("GET", `${PUB}/lotes`, { chave: keyTres }));
  afirmar(respostas.slice(0, 3).every((x) => x.status === 200) && respostas[0].cab["x-ratelimit-limit"] === "3", "chave com limite 3/min: 3 primeiras requisicoes 200");
  afirmar(respostas.map((x) => x.cab["x-ratelimit-remaining"]).slice(0, 3).join() === "2,1,0", "X-RateLimit-Remaining decresce 2, 1, 0");
  afirmar(respostas[3].status === 429 && respostas[3].corpo.erro === "LIMITE_REQUISICOES" && Number(respostas[3].cab["retry-after"]) >= 1, "4a requisicao -> 429 com Retry-After");
  r = await chamar("GET", `${PUB}/lotes`, { chave: keyA });
  afirmar(r.status === 200, "o limite e POR CHAVE: outra chave segue normal");

  console.log("\n=== 6. Relatorios assincronos (fila): 202 + polling + download ===");
  r = await chamar("GET", `${PUB}/analises/vida-util/ultimo`, { chave: keyA });
  afirmar(r.status === 404 && /POST/.test(r.corpo.mensagem), "sem relatorio gerado: 404 orientando a solicitar a geracao");
  r = await chamar("POST", `${PUB}/relatorios`, { chave: keyRO, corpo: { tipo: "VIDA_UTIL_REMANESCENTE" } });
  afirmar(r.status === 403, "chave sem RELATORIOS_GERAR -> 403");
  r = await chamar("POST", `${PUB}/relatorios`, { chave: keyA, corpo: { tipo: "RELATORIO_INEXISTENTE" } });
  afirmar(r.status === 400, "tipo de relatorio invalido -> 400");
  r = await chamar("POST", `${PUB}/relatorios`, { chave: keyA, corpo: { tipo: "VIDA_UTIL_REMANESCENTE", organizacaoId: orgB } });
  afirmar(r.status === 403, "chave restrita pedindo relatorio de outra organizacao -> 403");

  r = await chamar("POST", `${PUB}/relatorios`, { chave: keyA, corpo: { tipo: "VIDA_UTIL_REMANESCENTE", formato: "CSV" } });
  afirmar(r.status === 202 && r.corpo.status === "PENDENTE" && r.cab.location === `${PUB}/relatorios/${r.corpo.id}`, "POST /relatorios responde 202 imediatamente: PENDENTE + cabecalho Location");
  const tarefaCsv = r.corpo.id as string;
  afirmar(r.corpo.links.status === `${PUB}/relatorios/${tarefaCsv}` && r.corpo.links.download === null && r.corpo.maxTentativas === 3, "resposta traz links (status; download ainda nulo) e a politica de tentativas");
  r = await chamar("GET", `${PUB}/relatorios/${tarefaCsv}`, { chave: keyA });
  afirmar(r.status === 200 && r.corpo.status === "PENDENTE" && r.corpo.downloadDisponivel === false, "polling: ainda PENDENTE");
  r = await chamar("GET", `${PUB}/relatorios/${tarefaCsv}/download`, { chave: keyA });
  afirmar(r.status === 409 && r.corpo.erro === "CONFLITO", "download antes de concluir -> 409");
  r = await chamar("POST", `${PUB}/relatorios`, { chave: keyA, corpo: { tipo: "EFICIENCIA_OPERACIONAL" } });
  const tarefaJson = r.corpo.id as string;
  r = await chamar("POST", `${PUB}/relatorios`, { chave: keyA, corpo: { tipo: "RENTABILIDADE_EQUIPAMENTO" } });
  afirmar(r.status === 429 && r.corpo.erro === "LIMITE_TAREFAS_ATIVAS", "mais de 2 relatorios simultaneos por chave -> 429 (protege a fila contra abuso)");
  r = await chamar("GET", `${PUB}/relatorios/${tarefaCsv}`, { chave: keyG });
  afirmar(r.status === 404, "tarefa de outra chave -> 404");
  r = await chamar("GET", `${PUB}/relatorios/${tarefaCsv}`, { chave: keyRO });
  afirmar(r.status === 403, "chave sem RELATORIOS_GERAR nao consulta tarefas -> 403");

  const processadas = await worker.processarCiclo();
  afirmar(processadas === 2, "worker processa as 2 tarefas pendentes");
  r = await chamar("GET", `${PUB}/relatorios/${tarefaCsv}`, { chave: keyA });
  afirmar(r.status === 200 && r.corpo.status === "CONCLUIDA" && r.corpo.downloadDisponivel === true && r.corpo.links.download === `${PUB}/relatorios/${tarefaCsv}/download` && r.corpo.relatorioId, "polling: CONCLUIDA com link de download");
  r = await chamar("GET", `${PUB}/relatorios/${tarefaCsv}/download`, { chave: keyA });
  afirmar(r.status === 200 && /text\/csv/.test(r.cab["content-type"]) && /attachment; filename="relatorio-vida-util-.*\.csv"/.test(r.cab["content-disposition"]), "download CSV: Content-Type text/csv e Content-Disposition attachment");
  afirmar(r.texto.startsWith("\uFEFF") && r.texto.includes("equipamentoId") && r.texto.includes(eqA1) && !r.texto.includes(eqB1), "CSV contem so equipamentos da organizacao da chave (A1 sim, B1 nao)");
  r = await chamar("GET", `${PUB}/relatorios/${tarefaJson}/download`, { chave: keyA });
  const arq = JSON.parse(r.texto);
  afirmar(r.status === 200 && /application\/json/.test(r.cab["content-type"]) && arq.tipo === "EFICIENCIA_OPERACIONAL" && arq.resultado.resumo.lotesAnalisados === 2, "download JSON de eficiencia operacional: 2 lotes da org A (loteA + lote criado via API)");
  afirmar(banco.estado.relatorios.filter((x) => x.organizacaoId === orgA && x.origem === "API" && x.chaveApiId === keyAId).length === 2, "relatorios persistidos no historico com origem API, chave e organizacao");
  r = await chamar("GET", `${PUB}/analises/vida-util/ultimo`, { chave: keyA });
  afirmar(r.status === 200 && r.corpo.tipo === "VIDA_UTIL_REMANESCENTE" && r.corpo.resultado.porTipo.length >= 1 && r.corpo.organizacaoId === orgA, "GET /analises/vida-util/ultimo devolve o relatorio persistido da organizacao");
  r = await chamar("GET", `${PUB}/analises/rentabilidade/ultimo`, { chave: keyA });
  afirmar(r.status === 404, "tipo ainda nao gerado para o escopo -> 404");
  r = await chamar("GET", `${PUB}/analises/nao-existe/ultimo`, { chave: keyA });
  afirmar(r.status === 400, "slug de relatorio invalido -> 400");
  r = await chamar("GET", `${PUB}/analises/vida-util/ultimo`, { chave: keyLim });
  afirmar(r.status === 403, "chave sem ANALISES_LER nao le analises (403)");

  console.log("\n=== 7. API interna (JWT): analises, historico, fila e acuracia ===");
  r = await chamar("GET", `${INT}/analises/eficiencia-operacional`);
  afirmar(r.status === 401, "analise interna sem JWT -> 401");
  r = await chamar("GET", `${INT}/analises/eficiencia-operacional`, { token: tokenOperador });
  afirmar(r.status === 403, "OPERADOR nao acessa analises -> 403");
  r = await chamar("GET", `${INT}/analises/eficiencia-operacional`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.resumo.lotesAnalisados === 4 && r.corpo.resumo.equipamentosTriados === 2, "AUDITOR consulta eficiencia ao vivo (todos os lotes)");
  afirmar(r.corpo.porOperador.length === 1 && r.corpo.porOperador[0].usuario === "gestor" && r.corpo.porOperador[0].triagens === 2, "eficiencia por operador: gestor com 2 triagens");
  r = await chamar("GET", `${INT}/analises/rentabilidade?organizacaoId=${orgA}`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.totais.quantidade === 3 && r.corpo.porTipo.some((t: any) => t.tipo === "SERVIDOR") && r.corpo.ranking.length >= 1, "rentabilidade filtrada por organizacao (3 equipamentos da org A)");
  r = await chamar("GET", `${INT}/analises/vida-util`, { token: tokenAdmin });
  afirmar(r.status === 200 && r.corpo.resumo.equipamentosAnalisados === 5 && r.corpo.metodo.includes("minimos quadrados"), "vida util ao vivo (5 equipamentos) informa o metodo");
  r = await chamar("GET", `${INT}/analises/nao-existe`, { token: tokenAdmin });
  afirmar(r.status === 400, "tipo de analise invalido -> 400");
  r = await chamar("POST", `${INT}/analises/rentabilidade/gerar`, { token: tokenAuditor, corpo: {} });
  afirmar(r.status === 201 && r.corpo.origem === "MANUAL" && r.corpo.organizacaoId === null, "AUDITOR gera e persiste relatorio global (origem MANUAL)");
  const relGlobalId = r.corpo.id as string;
  r = await chamar("POST", `${INT}/analises/rentabilidade/gerar`, { token: tokenOperador, corpo: {} });
  afirmar(r.status === 403, "OPERADOR nao gera relatorios -> 403");
  r = await chamar("POST", `${INT}/analises/vida-util/gerar`, { token: tokenAdmin, corpo: { organizacaoId: "99999999-9999-4999-8999-999999999999" } });
  afirmar(r.status === 404, "gerar para organizacao inexistente -> 404");
  r = await chamar("GET", `${INT}/analises/historico?tipo=RENTABILIDADE_EQUIPAMENTO`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.total === 1 && r.corpo.itens[0].id === relGlobalId && !("resultado" in r.corpo.itens[0]), "historico lista relatorios persistidos (resumo, sem o JSON pesado)");
  r = await chamar("GET", `${INT}/analises/historico?organizacaoId=${orgA}`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.total === 2, "historico filtrado por organizacao (2 relatorios gerados pela chave da org A)");
  r = await chamar("GET", `${INT}/analises/historico?global=true`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.total === 1, "historico global=true: apenas relatorios sem organizacao");
  r = await chamar("GET", `${INT}/analises/relatorios/${relGlobalId}`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.resultado.totais.quantidade === 5, "detalhe de relatorio persistido traz o resultado completo");
  r = await chamar("GET", `${INT}/analises/relatorios/99999999-9999-4999-8999-999999999999`, { token: tokenAuditor });
  afirmar(r.status === 404, "relatorio inexistente -> 404");

  r = await chamar("POST", `${INT}/analises/executar`, { token: tokenAdmin, corpo: { tipo: "EFICIENCIA_OPERACIONAL" } });
  afirmar(r.status === 202 && r.cab.location === `${INT}/tarefas/${r.corpo.id}`, "POST /analises/executar enfileira (202 + Location)");
  const tarefaInt = r.corpo.id as string;
  r = await chamar("GET", `${INT}/tarefas?status=PENDENTE`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.total === 1, "lista de tarefas filtrada por status");
  await worker.processarCiclo();
  r = await chamar("GET", `${INT}/tarefas/${tarefaInt}`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.status === "CONCLUIDA", "tarefa interna concluida pelo worker");
  r = await chamar("GET", `${INT}/tarefas/${tarefaInt}/download`, { token: tokenAuditor });
  afirmar(r.status === 200 && JSON.parse(r.texto).resultado.resumo.lotesAnalisados === 4, "download da tarefa interna (JSON)");
  r = await chamar("GET", `${INT}/tarefas`, { token: tokenOperador });
  afirmar(r.status === 403, "OPERADOR nao lista tarefas -> 403");

  // acuracia: gera previsao, depois o equipamento realmente chega a INSERVIVEL
  r = await chamar("GET", `${INT}/analises/previsoes/acuracia`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.previsoesAvaliadas === 0 && r.corpo.erroMedioDias === null, "acuracia sem previsoes realizadas: 0 avaliadas, medias null");
  relogioMs += 10 * 86_400_000;
  r = await chamar("POST", `${INT}/analises/vida-util/gerar`, { token: tokenAdmin, corpo: {} });
  afirmar(r.status === 201 && banco.estado.previsoesEquipamento.length > 0, "relatorio de vida util persiste as previsoes por equipamento");
  const previsto = banco.estado.previsoesEquipamento.find((p) => p.equipamentoId === eqA1 && p.relatorioId === r.corpo.id);
  afirmar(!!previsto && (previsto.diasRestantes ?? 0) > 0, "previsao do equipamento A1 registrada (dias restantes > 0)");
  await new Promise((res) => setTimeout(res, 15));
  r = await chamar("PATCH", `/equipamentos/${eqA1}/estado-fisico`, { token: tokenGestor, corpo: { novoEstado: "INSERVIVEL", justificativa: "Falha total de placa" } });
  afirmar(r.status === 200, "realizacao: A1 e rebaixado para INSERVIVEL");
  r = await chamar("GET", `${INT}/analises/previsoes/acuracia`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.previsoesAvaliadas >= 1 && typeof r.corpo.erroAbsolutoMedioDias === "number" && r.corpo.itens[0].diasPrevistos > 0, "acuracia compara previsao x realizacao (erro absoluto medio em dias)");

  console.log("\n=== 8. Revogacao, expiracao e protecao contra forca bruta ===");
  r = await chamar("POST", `${ADM}/chaves-api/${keyAId}/revogar`, { token: tokenAdmin, corpo: { versao: keyAVersao + 5 } });
  afirmar(r.status === 409, "revogar com versao desatualizada -> 409 (concorrencia otimista)");
  r = await chamar("POST", `${ADM}/chaves-api/${keyAId}/revogar`, { token: tokenAdmin, corpo: { versao: keyAVersao } });
  afirmar(r.status === 200 && r.corpo.revogadaEm !== null && r.corpo.versao === keyAVersao + 1, "ADMIN revoga a chave (200)");
  r = await chamar("GET", `${PUB}/me`, { chave: keyA });
  afirmar(r.status === 401 && r.corpo.mensagem === msgInvalida, "chave revogada deixa de funcionar imediatamente (401, mesma mensagem generica)");
  r = await chamar("POST", `${ADM}/chaves-api/${keyAId}/revogar`, { token: tokenAdmin, corpo: {} });
  afirmar(r.status === 409, "revogar de novo -> 409");

  const banco2 = new BancoMemoria();
  await banco2.repos.usuarios.criar({ id: adminId, username: "admin", papel: Papel.ADMINISTRADOR, senhaHash: HashService.gerarHash("AdminSenha123") });
  let t2 = Date.now();
  const s2 = criarServicos(banco2, { relogio: () => new Date(t2) });
  const ator = { id: adminId, username: "admin", papel: Papel.ADMINISTRADOR };
  const exp = await s2.chavesApi.criar(ator, { nome: "Temporaria", permissoes: ["LOTES_LER" as any], escopoGlobal: true, expiraEm: new Date(t2 + 3_600_000).toISOString() });
  afirmar((await s2.chavesApi.autenticar(exp.chaveSecreta)).nome === "Temporaria", "chave com expiracao funciona antes de expirar");
  t2 += 3_600_001;
  let expirou = false;
  try { await s2.chavesApi.autenticar(exp.chaveSecreta); } catch (e) { expirou = e instanceof ErroNaoAutenticado; }
  afirmar(expirou, "apos expiraEm a chave e rejeitada (401)");

  limitador.limpar();
  for (let i = 0; i < 5; i++) await chamar("GET", `${PUB}/me`, { chave: "gck_aaaaaaaaaaaa.invalida" });
  r = await chamar("GET", `${PUB}/me`, { chave: "gck_aaaaaaaaaaaa.invalida" });
  afirmar(r.status === 429 && r.corpo.erro === "LIMITE_TENTATIVAS_INVALIDAS", "forca bruta: apos 5 tentativas invalidas o IP e bloqueado (429)");
  r = await chamar("GET", `${PUB}/me`, { chave: keyG });
  afirmar(r.status === 429, "IP bloqueado nao consegue nem usar chave valida enquanto durar o bloqueio");
  limitador.limpar();
  r = await chamar("GET", `${PUB}/me`, { chave: keyG });
  afirmar(r.status === 200, "apos a janela, o acesso com chave valida volta ao normal");

  console.log("\n=== 9. Documentacao OpenAPI e versionamento ===");
  r = await chamar("GET", `${PUB}/openapi.json`);
  const spec = r.corpo;
  afirmar(r.status === 200 && spec.openapi === "3.0.3" && spec.info.version === "1.0.0", "GET /openapi.json (sem chave): OpenAPI 3.0.3, versao 1.0.0");
  const caminhos = Object.keys(spec.paths);
  afirmar(["/me", "/lotes", "/lotes/{id}", "/rastreabilidade/equipamentos/{id}", "/analises/{tipo}/ultimo", "/relatorios", "/relatorios/{id}", "/relatorios/{id}/download"].every((c) => caminhos.includes(c)), "todos os endpoints publicos documentados (com parametros de caminho {id})");
  afirmar(!caminhos.some((c) => c.includes("docs") || c.includes("openapi") || c.includes("admin") || c.includes("internal")), "endpoints internos/administrativos e as proprias rotas de docs NAO aparecem na spec publica");
  afirmar(spec.components.securitySchemes.ApiKeyAuth.name === "X-API-Key" && spec.paths["/lotes"].get.security[0].ApiKeyAuth !== undefined, "esquema de seguranca ApiKeyAuth (header X-API-Key) aplicado aos endpoints");
  const post = spec.paths["/relatorios"].post;
  afirmar(!!post.requestBody.content["application/json"].schema.properties.tipo.enum && post.responses["202"] && post.responses["401"] && post.responses["403"] && post.responses["429"] && post.responses["400"], "POST /relatorios documenta corpo, 202 e erros 400/401/403/429");
  afirmar(post.requestBody.content["application/json"].schema.example?.tipo === "VIDA_UTIL_REMANESCENTE", "exemplo de requisicao incluido na documentacao");
  afirmar(!!spec.paths["/relatorios/{id}/download"].get.responses["200"].content["text/csv"] && !!spec.paths["/lotes"].post.requestBody.content["application/json"].schema.example, "download documenta text/csv; POST /lotes traz exemplo de corpo");
  afirmar(spec.paths["/lotes"].get.parameters.some((p: any) => p.name === "limite") && spec.paths["/lotes/{id}"].get.parameters[0].in === "path", "parametros de query e de caminho descritos");
  r = await chamar("GET", `${PUB}/docs`);
  afirmar(r.status === 200 && /text\/html/.test(r.cab["content-type"]) && r.texto.includes("SwaggerUIBundle") && r.texto.includes(`${PUB}/openapi.json`), "GET /docs serve o Swagger UI apontando para a spec");
  r = await chamar("GET", `${PUB}/rota-inexistente`, { chave: keyG });
  afirmar(r.status === 404 || r.status === 401, "rota inexistente sob o prefixo publico nao vaza informacao");
  r = await chamar("GET", "/saude");
  afirmar(r.status === 200 && r.cab["x-api-version"] === undefined, "rotas legadas (/saude) nao recebem X-API-Version");

  console.log("\n=== 10. Regressao: rotas da AV2 continuam funcionando ===");
  r = await chamar("GET", "/lotes", { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.total === 4, "GET /lotes (JWT) segue funcionando");
  r = await chamar("GET", `/equipamentos/${eqA2}/rastreio`, { token: tokenAuditor });
  afirmar(r.status === 200 && r.corpo.historico.some((h: any) => h.usuario === "gestor"), "rastreio interno continua exibindo o operador (so a API publica o oculta)");
  r = await chamar("GET", "/relatorios/valor-residual", { token: tokenAuditor });
  afirmar(r.status === 200 && Array.isArray(r.corpo.linhas), "relatorio de valor residual (AV2) inalterado depois da extracao de reconstruirDominio");
  r = await chamar("GET", "/lotes", { chave: keyG });
  afirmar(r.status === 401, "chave de API nao autentica rotas internas (separacao de politicas)");

  await app.close();
  console.log("\n" + "=".repeat(64));
  console.log(`RESULTADO: ${total - falhas}/${total} verificacoes passaram.`);
  console.log("=".repeat(64));
  if (falhas > 0) process.exit(1);
}

main().catch((erro) => {
  console.error("Falha inesperada na execucao dos testes da API publica:", erro);
  process.exit(1);
});
