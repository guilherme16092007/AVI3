import { FormatoSaida, PermissaoApi, SLUG_RELATORIO, TipoRelatorio } from "./tiposAv3";
import { TipoEquipamento } from "../types";

const uuid = { type: "string", format: "uuid" };
const texto = (max = 200) => ({ type: "string", minLength: 1, maxLength: max });
const SLUGS = Object.values(SLUG_RELATORIO);

const paginacao = {
  limite: { type: "integer", minimum: 1, maximum: 200, default: 50, description: "Itens por pagina (1-200)." },
  offset: { type: "integer", minimum: 0, default: 0, description: "Itens a pular." },
};

export const paramsSlugRelatorio = {
  type: "object",
  required: ["tipo"],
  properties: {
    tipo: { type: "string", enum: SLUGS, description: "eficiencia-operacional | rentabilidade | vida-util" },
  },
};

export const paramsIdUuid = { type: "object", required: ["id"], properties: { id: { ...uuid, description: "Identificador (UUID)." } } };

// ------------------------------------------------------------ administracao de chaves (JWT)

export const corpoCriarChave = {
  type: "object",
  required: ["nome", "permissoes"],
  additionalProperties: false,
  properties: {
    nome: texto(120),
    permissoes: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: Object.values(PermissaoApi) } },
    organizacaoId: uuid,
    escopoGlobal: { type: "boolean" },
    usuarioServicoId: uuid,
    limitePorMinuto: { type: "integer", minimum: 1, maximum: 100000 },
    expiraEm: { type: "string", format: "date-time" },
  },
};

export const corpoRevogarChave = {
  type: "object",
  additionalProperties: false,
  properties: { versao: { type: "integer", minimum: 1 } },
};

export const consultaPaginadaAv3 = { type: "object", additionalProperties: false, properties: { ...paginacao } };

// ------------------------------------------------------------ analises internas (JWT)

export const consultaAnaliseAoVivo = {
  type: "object",
  additionalProperties: false,
  properties: { organizacaoId: uuid },
};

export const corpoGerarAnalise = {
  type: "object",
  additionalProperties: false,
  properties: { organizacaoId: uuid },
};

export const consultaHistoricoAnalises = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...paginacao,
    tipo: { type: "string", enum: Object.values(TipoRelatorio) },
    organizacaoId: uuid,
    global: { type: "boolean", description: "true = somente relatorios globais (sem organizacao)." },
  },
};

export const consultaTarefas = {
  type: "object",
  additionalProperties: false,
  properties: { ...paginacao, status: { type: "string", enum: ["PENDENTE", "EM_EXECUCAO", "CONCLUIDA", "FALHA"] } },
};

export const corpoSolicitarRelatorio = {
  type: "object",
  required: ["tipo"],
  additionalProperties: false,
  properties: {
    tipo: { type: "string", enum: Object.values(TipoRelatorio), description: "Relatorio a gerar." },
    formato: { type: "string", enum: Object.values(FormatoSaida), default: "JSON", description: "Formato do arquivo para download." },
    organizacaoId: { ...uuid, description: "Obrigatoria apenas para chaves de escopo global que queiram restringir a uma organizacao; chaves restritas usam a propria." },
  },
  examples: [{ tipo: "VIDA_UTIL_REMANESCENTE", formato: "CSV" }],
};

// ------------------------------------------------------------ API publica (X-API-Key)

export const SEGURANCA_API = [{ ApiKeyAuth: [] as string[] }];

export const consultaLotesPublica = {
  type: "object",
  additionalProperties: false,
  properties: { ...paginacao, organizacaoId: { ...uuid, description: "Somente chaves globais; chaves restritas sempre veem a propria organizacao." } },
};

export const consultaAnalisePublica = {
  type: "object",
  additionalProperties: false,
  properties: { organizacaoId: { ...uuid, description: "Somente chaves globais." } },
};

const itemEquipamento = {
  type: "object",
  required: ["tipo", "numeroSerie", "codigoBarrasInterno"],
  additionalProperties: false,
  properties: {
    tipo: { type: "string", enum: Object.values(TipoEquipamento) },
    numeroSerie: texto(100),
    codigoBarrasInterno: texto(100),
    fabricante: texto(100),
    modelo: texto(100),
  },
};

export const corpoCriarLotePublico = {
  type: "object",
  required: ["notaFiscal", "transportadora"],
  additionalProperties: false,
  properties: {
    organizacaoId: { ...uuid, description: "Obrigatoria para chaves globais; chaves restritas usam a propria organizacao." },
    notaFiscal: texto(100),
    transportadora: texto(100),
    dataEntrada: { type: "string", format: "date" },
    equipamentos: { type: "array", maxItems: 500, items: itemEquipamento },
  },
  examples: [
    {
      notaFiscal: "NF-2026-0001",
      transportadora: "TransLog",
      dataEntrada: "2026-11-20",
      equipamentos: [{ tipo: "NOTEBOOK", numeroSerie: "SN-0001", codigoBarrasInterno: "GC-0001", fabricante: "Dell", modelo: "Latitude 5420" }],
    },
  ],
};

const livre = { type: "object", additionalProperties: true };

export const respostaTarefa = {
  type: "object",
  description: "Estado da tarefa de geracao de relatorio.",
  additionalProperties: true,
  properties: {
    id: uuid,
    status: { type: "string", enum: ["PENDENTE", "EM_EXECUCAO", "CONCLUIDA", "FALHA"] },
    tipoRelatorio: { type: "string", nullable: true },
    formato: { type: "string", enum: ["JSON", "CSV"] },
    tentativas: { type: "integer" },
    maxTentativas: { type: "integer" },
    proximaTentativaEm: { type: "string", nullable: true },
    criadoEm: { type: "string" },
    iniciadaEm: { type: "string", nullable: true },
    concluidaEm: { type: "string", nullable: true },
    erro: { type: "string", nullable: true },
    relatorioId: { type: "string", nullable: true },
    downloadDisponivel: { type: "boolean" },
    links: {
      type: "object",
      additionalProperties: true,
      properties: { status: { type: "string" }, download: { type: "string", nullable: true } },
    },
  },
};

export const respostaLivre = (descricao: string) => ({ ...livre, description: descricao });
