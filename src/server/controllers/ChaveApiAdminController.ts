import type { FastifyPluginAsync } from "fastify";
import { atorDe } from "../plugins/autenticacao";
import { consultaPaginadaAv3, corpoCriarChave, corpoRevogarChave, paramsIdUuid } from "../schemasAv3";
import { CriarChaveEntrada } from "../servicos/ChaveApiServico";
import { ConsultaPaginada, OpcoesController, paginacaoDe } from "./comum";

/** Administracao das chaves de API dos parceiros (somente ADMINISTRADOR, via JWT). Montado em /api/v1/admin. */
export const chaveApiAdminController: FastifyPluginAsync<OpcoesController> = async (app, { servicos }) => {
  app.post<{ Body: CriarChaveEntrada }>("/chaves-api", { schema: { body: corpoCriarChave } }, async (request, reply) => {
    const criada = await servicos.chavesApi.criar(atorDe(request), request.body);
    reply.code(201).header("Cache-Control", "no-store");
    return { ...criada, aviso: "Guarde a chaveSecreta agora: ela nao podera ser consultada novamente." };
  });

  app.get<{ Querystring: ConsultaPaginada }>("/chaves-api", { schema: { querystring: consultaPaginadaAv3 } }, async (request) =>
    servicos.chavesApi.listar(atorDe(request), paginacaoDe(request.query))
  );

  app.get<{ Params: { id: string } }>("/chaves-api/:id", { schema: { params: paramsIdUuid } }, async (request) =>
    servicos.chavesApi.detalhar(atorDe(request), request.params.id)
  );

  app.post<{ Params: { id: string }; Body: { versao?: number } }>(
    "/chaves-api/:id/revogar",
    { schema: { params: paramsIdUuid, body: corpoRevogarChave } },
    async (request) => servicos.chavesApi.revogar(atorDe(request), request.params.id, request.body?.versao)
  );
};
