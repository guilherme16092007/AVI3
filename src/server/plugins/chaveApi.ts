import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ErroLimiteExcedido, ErroNaoAutenticado } from "../erros";
import { Servicos } from "../servicos";
import { ChaveApiAutenticada } from "../servicos/ChaveApiServico";
import { LimitadorTaxa, ResultadoLimite } from "./limiteTaxa";

declare module "fastify" {
  interface FastifyRequest {
    chaveApi?: ChaveApiAutenticada;
  }
  interface FastifyContextConfig {
    /** Rotas marcadas com semChave: true (documentacao) dispensam a chave de API e o limite por chave. */
    semChave?: boolean;
  }
}

export interface OpcoesAutenticacaoChaveApi {
  servicos: Servicos;
  limitador: LimitadorTaxa;
  /** Limite por minuto, por IP, de tentativas com chave ausente/invalida (protege contra adivinhacao de chaves). */
  limiteFalhasPorIp: number;
}

function cabecalhos(reply: FastifyReply, r: ResultadoLimite): void {
  reply.header("X-RateLimit-Limit", r.limite);
  reply.header("X-RateLimit-Remaining", r.restante);
  reply.header("X-RateLimit-Reset", r.reiniciaEmSeg);
}

/**
 * Registra no escopo (encapsulado) da API publica o hook que:
 *  1. bloqueia IPs que acumulam tentativas com chave invalida;
 *  2. autentica a chave (cabecalho X-API-Key);
 *  3. aplica o limite de requisicoes POR CHAVE (contrato comercial), devolvendo 429 + Retry-After.
 */
export function registrarAutenticacaoChaveApi(app: FastifyInstance, o: OpcoesAutenticacaoChaveApi): void {
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.routeOptions.config?.semChave) return;

    const chaveIp = `ip:${request.ip}`;
    const ip = o.limitador.consultar(chaveIp, o.limiteFalhasPorIp);
    if (!ip.permitido) {
      reply.header("Retry-After", ip.reiniciaEmSeg);
      throw new ErroLimiteExcedido("Muitas tentativas com chave de API invalida. Aguarde e tente novamente.", "LIMITE_TENTATIVAS_INVALIDAS");
    }

    const bruta = request.headers["x-api-key"];
    if (typeof bruta !== "string" || bruta.trim() === "") {
      o.limitador.consumir(chaveIp, o.limiteFalhasPorIp);
      throw new ErroNaoAutenticado("Cabecalho X-API-Key ausente. Informe a chave de API do parceiro.");
    }

    let chave: ChaveApiAutenticada;
    try {
      chave = await o.servicos.chavesApi.autenticar(bruta.trim());
    } catch (erro) {
      if (erro instanceof ErroNaoAutenticado) o.limitador.consumir(chaveIp, o.limiteFalhasPorIp);
      throw erro;
    }

    const limite = o.limitador.consumir(`chave:${chave.id}`, chave.limitePorMinuto);
    cabecalhos(reply, limite);
    if (!limite.permitido) {
      reply.header("Retry-After", limite.reiniciaEmSeg);
      throw new ErroLimiteExcedido(
        `Limite de ${chave.limitePorMinuto} requisicoes por minuto excedido para esta chave. Tente novamente em ${limite.reiniciaEmSeg}s.`
      );
    }
    request.chaveApi = chave;
  });
}

export function chaveDe(request: FastifyRequest): ChaveApiAutenticada {
  if (!request.chaveApi) throw new ErroNaoAutenticado("Chave de API nao autenticada.");
  return request.chaveApi;
}
