import type { FastifyPluginAsync } from "fastify";
import { gerarOpenApi, InfoApi, paginaSwaggerUi, RotaColetada } from "../openapi/gerador";

export interface OpcoesDocs {
  rotas: RotaColetada[];
  prefixo: string;
  versao: string;
}

/** Especificacao OpenAPI + Swagger UI da API publica (livres de chave: a documentacao e aberta aos parceiros). */
export const docsController: FastifyPluginAsync<OpcoesDocs> = async (app, { rotas, prefixo, versao }) => {
  const info: InfoApi = {
    titulo: "greencode - API publica",
    versao,
    servidor: prefixo,
    descricao:
      "Integracao de parceiros com a plataforma de logistica reversa greencode: rastreabilidade, lotes e relatorios analiticos.\n\n" +
      "**Autenticacao:** envie a chave no cabecalho `X-API-Key`. **Limites:** cada chave tem um limite de requisicoes por minuto " +
      "(cabecalhos `X-RateLimit-*`; ao exceder, 429 com `Retry-After`). **Versionamento:** a versao maior faz parte da URL (`/api/v1`); " +
      "mudancas incompativeis geram `/api/v2`, e a v1 e mantida com aviso previo (cabecalhos `Deprecation`/`Sunset`) por pelo menos 6 meses.",
  };

  let especificacao: Record<string, unknown> | undefined;
  const spec = () => (especificacao ??= gerarOpenApi(rotas, info));

  app.get("/openapi.json", { schema: { hide: true }, config: { semChave: true } }, async () => spec());
  app.get("/docs", { schema: { hide: true }, config: { semChave: true } }, async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(paginaSwaggerUi(`${prefixo}/openapi.json`))
  );
};
