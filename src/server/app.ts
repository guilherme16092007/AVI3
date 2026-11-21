import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { analiseController } from "./controllers/AnaliseController";
import { authController } from "./controllers/AuthController";
import { chaveApiAdminController } from "./controllers/ChaveApiAdminController";
import { docsController } from "./controllers/DocsController";
import { equipamentoController } from "./controllers/EquipamentoController";
import { loteController } from "./controllers/LoteController";
import { publicaController } from "./controllers/PublicaController";
import { organizacaoController } from "./controllers/OrganizacaoController";
import { parametroController } from "./controllers/ParametroController";
import { relatorioController } from "./controllers/RelatorioController";
import { saudeController } from "./controllers/SaudeController";
import { usuarioController } from "./controllers/UsuarioController";
import { traduzirErro } from "./erros";
import { coletarRotas } from "./openapi/gerador";
import { autenticar } from "./plugins/autenticacao";
import { registrarAutenticacaoChaveApi } from "./plugins/chaveApi";
import { LimitadorTaxa } from "./plugins/limiteTaxa";
import { Servicos } from "./servicos";
import "./tipos-jwt";

export interface OpcoesApp {
  servicos: Servicos;
  jwtSecret: string;
  jwtExpiresIn: string;
  logLevel?: string;
  logger?: boolean;
  verificarBanco?: () => Promise<void>;
  /** Limite por minuto, por IP, de tentativas com chave de API invalida (padrao 30). */
  limiteFalhasChavePorIp?: number;
  /** Permite injetar o limitador (testes com relogio controlado). */
  limitador?: LimitadorTaxa;
}

/** Versao da API publica/interna (parte da URL). Mudancas incompativeis exigem uma nova versao maior. */
export const VERSAO_API = "v1";
export const PREFIXO_PUBLICO = `/api/${VERSAO_API}/public`;
export const PREFIXO_INTERNO = `/api/${VERSAO_API}/internal`;
export const PREFIXO_ADMIN = `/api/${VERSAO_API}/admin`;

export async function construirApp(opcoes: OpcoesApp): Promise<FastifyInstance> {
  const configuracao: FastifyServerOptions = {
    logger: opcoes.logger === false ? false : { level: opcoes.logLevel ?? "info" },
    ajv: { customOptions: { removeAdditional: false, coerceTypes: "array", useDefaults: true, allErrors: false } },
  };
  const app = Fastify(configuracao);

  await app.register(fastifyJwt, {
    secret: opcoes.jwtSecret,
    sign: { expiresIn: opcoes.jwtExpiresIn },
  });

  app.setErrorHandler((erro, request, reply) => {
    const resposta = traduzirErro(erro);
    if (resposta.statusCode >= 500) {
      request.log.error({ err: erro }, "erro nao tratado");
    } else {
      request.log.info({ codigo: resposta.erro, status: resposta.statusCode }, resposta.mensagem);
    }
    return reply.status(resposta.statusCode).send(resposta);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      statusCode: 404,
      erro: "NAO_ENCONTRADO",
      mensagem: `Rota ${request.method} ${request.url} nao encontrada.`,
    })
  );

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      { metodo: request.method, url: request.url, status: reply.statusCode, usuario: request.user?.sub },
      "requisicao concluida"
    );
  });

  // Identifica a versao do contrato em toda resposta da API versionada (/api/vN/...).
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/")) reply.header("X-API-Version", "1");
  });

  await app.register(saudeController, { verificarBanco: opcoes.verificarBanco });
  await app.register(authController, { servicos: opcoes.servicos, validade: opcoes.jwtExpiresIn });

  await app.register(async (protegido: FastifyInstance) => {
    protegido.addHook("onRequest", autenticar);
    const dependencias = { servicos: opcoes.servicos };
    await protegido.register(usuarioController, dependencias);
    await protegido.register(parametroController, dependencias);
    await protegido.register(organizacaoController, dependencias);
    await protegido.register(loteController, dependencias);
    await protegido.register(equipamentoController, dependencias);
    await protegido.register(relatorioController, dependencias);
    // AV3 - API interna/administrativa (separada da publica por prefixo e por politica de seguranca)
    await protegido.register(chaveApiAdminController, { ...dependencias, prefix: PREFIXO_ADMIN });
    await protegido.register(analiseController, { ...dependencias, prefix: PREFIXO_INTERNO });
  });

  // AV3 - API publica para parceiros: chave de API + limite de taxa + documentacao OpenAPI
  const limitador = opcoes.limitador ?? new LimitadorTaxa();
  await app.register(async (publica: FastifyInstance) => {
    const rotas = coletarRotas(publica);
    registrarAutenticacaoChaveApi(publica, {
      servicos: opcoes.servicos,
      limitador,
      limiteFalhasPorIp: opcoes.limiteFalhasChavePorIp ?? 30,
    });
    await publica.register(publicaController, { servicos: opcoes.servicos, prefixo: PREFIXO_PUBLICO });
    await publica.register(docsController, { rotas, prefixo: PREFIXO_PUBLICO, versao: "1.0.0" });
  }, { prefix: PREFIXO_PUBLICO });

  return app;
}
