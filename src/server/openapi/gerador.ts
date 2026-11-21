import type { FastifyInstance, FastifySchema } from "fastify";

/**
 * Documentacao OpenAPI 3.0 da API publica, DERIVADA dos schemas das rotas Fastify (mesmo principio do
 * @fastify/swagger: o contrato documentado e o contrato validado). As rotas sao coletadas pelo hook onRoute;
 * o JSON gerado e servido em /api/v1/public/openapi.json e exibido pelo Swagger UI em /api/v1/public/docs.
 */
declare module "fastify" {
  interface FastifySchema {
    summary?: string;
    description?: string;
    tags?: string[];
    security?: Array<Record<string, string[]>>;
    hide?: boolean;
    /** Respostas que nao passam por serializacao (ex.: download de arquivo), apenas para documentacao. */
    respostasDoc?: Record<string, { description: string; content?: Record<string, unknown> }>;
  }
}

export interface RotaColetada {
  metodo: string;
  url: string;
  schema: FastifySchema;
}

export function coletarRotas(app: FastifyInstance): RotaColetada[] {
  const rotas: RotaColetada[] = [];
  app.addHook("onRoute", (rota) => {
    const metodos = Array.isArray(rota.method) ? rota.method : [rota.method];
    for (const metodo of metodos) {
      if (metodo === "HEAD" || metodo === "OPTIONS") continue;
      if (rota.schema?.hide) continue;
      rotas.push({ metodo: metodo.toLowerCase(), url: rota.url, schema: rota.schema ?? {} });
    }
  });
  return rotas;
}

/** JSON Schema (Ajv) -> Schema Object do OpenAPI 3.0: `examples[0]` vira `example`. */
function converter(schema: any): any {
  if (Array.isArray(schema)) return schema.map(converter);
  if (schema === null || typeof schema !== "object") return schema;
  const saida: Record<string, any> = {};
  for (const [chave, valor] of Object.entries(schema)) {
    if (chave === "examples") {
      if (Array.isArray(valor) && valor.length > 0) saida.example = valor[0];
      continue;
    }
    saida[chave] = chave === "properties" ? Object.fromEntries(Object.entries(valor as object).map(([k, v]) => [k, converter(v)])) : converter(valor);
  }
  return saida;
}

const REF_ERRO = { $ref: "#/components/schemas/Erro" };
const DESCRICAO_ERRO: Record<string, string> = {
  "400": "Requisicao invalida (parametros/corpo fora do contrato).",
  "401": "Chave de API ausente, invalida, revogada ou expirada.",
  "403": "A chave nao possui a permissao necessaria ou o recurso esta fora do seu escopo.",
  "404": "Recurso nao encontrado (ou fora do escopo da chave).",
  "409": "Conflito de estado (ex.: relatorio ainda nao concluido).",
  "422": "Regra de negocio violada.",
  "429": "Limite de requisicoes excedido. Veja o cabecalho Retry-After.",
};

function parametros(schema: any, local: "path" | "query"): any[] {
  if (!schema?.properties) return [];
  const obrigatorios: string[] = schema.required ?? [];
  return Object.entries<any>(schema.properties).map(([nome, s]) => ({
    name: nome,
    in: local,
    required: local === "path" ? true : obrigatorios.includes(nome),
    schema: converter(s),
    ...(s.description ? { description: s.description } : {}),
  }));
}

export interface InfoApi {
  titulo: string;
  versao: string;
  descricao: string;
  servidor: string;
}

export function gerarOpenApi(rotas: RotaColetada[], info: InfoApi): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const rota of rotas) {
    const s = rota.schema;
    const caminho = rota.url.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(info.servidor, "") || "/";
    const seguro = !!s.security;
    const respostas: Record<string, unknown> = {};

    for (const [codigo, resp] of Object.entries<any>((s.response as Record<string, any>) ?? {})) {
      respostas[codigo] = {
        description: resp.description ?? "Sucesso",
        content: { "application/json": { schema: converter(resp) } },
      };
    }
    for (const [codigo, doc] of Object.entries(s.respostasDoc ?? {})) respostas[codigo] = doc;

    const adicionais: string[] = [];
    if (s.body || s.querystring || s.params) adicionais.push("400");
    if (seguro) adicionais.push("401", "403", "429");
    if (s.params) adicionais.push("404");
    for (const c of adicionais) {
      respostas[c] ??= { description: DESCRICAO_ERRO[c], content: { "application/json": { schema: REF_ERRO } } };
    }

    paths[caminho] ??= {};
    paths[caminho][rota.metodo] = {
      summary: s.summary,
      description: s.description,
      tags: s.tags,
      operationId: `${rota.metodo}_${caminho.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      ...(seguro ? { security: s.security } : {}),
      parameters: [...parametros(s.params, "path"), ...parametros(s.querystring, "query")],
      ...(s.body ? { requestBody: { required: true, content: { "application/json": { schema: converter(s.body) } } } } : {}),
      responses: respostas,
    };
  }

  return {
    openapi: "3.0.3",
    info: { title: info.titulo, version: info.versao, description: info.descricao },
    servers: [{ url: info.servidor }],
    tags: [
      { name: "Conta", description: "Identidade e limites da chave de API." },
      { name: "Rastreabilidade", description: "Historico de movimentacao de equipamentos." },
      { name: "Lotes", description: "Consulta e submissao de lotes." },
      { name: "Analises", description: "Ultimos relatorios analiticos persistidos." },
      { name: "Relatorios assincronos", description: "Geracao sob demanda via fila (202 + polling + download)." },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key", description: "Chave do parceiro (formato gck_<prefixo>.<segredo>), emitida por um administrador do greencode." },
      },
      schemas: {
        Erro: {
          type: "object",
          properties: {
            statusCode: { type: "integer", example: 403 },
            erro: { type: "string", example: "ACESSO_NEGADO" },
            mensagem: { type: "string" },
            detalhes: {},
          },
        },
      },
    },
    paths,
  };
}

/** Pagina do Swagger UI (assets via CDN jsDelivr; o JSON /openapi.json funciona offline em qualquer ferramenta OpenAPI). */
export function paginaSwaggerUi(urlSpec: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>greencode - API publica v1</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"><p style="font-family:sans-serif;padding:1rem">Carregando documentacao... Se nao carregar (sem internet), use a especificacao em <a href="${urlSpec}">${urlSpec}</a>.</p></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>
  window.ui = SwaggerUIBundle({ url: ${JSON.stringify(urlSpec)}, dom_id: '#swagger-ui', persistAuthorization: true });
</script>
</body>
</html>`;
}
