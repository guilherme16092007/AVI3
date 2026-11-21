/**
 * Interpretador de expressoes cron de 5 campos (minuto hora dia-do-mes mes dia-da-semana), no fuso do servidor.
 * Suporta: "*", listas (1,15), intervalos (1-5), passos (*\/10, 1-30/5). Dia da semana 0-7 (0 e 7 = domingo).
 * Semantica padrao do cron: se dia-do-mes E dia-da-semana estao restritos, vale qualquer um dos dois (OR).
 * Equivalente funcional ao node-cron para o uso do projeto, sem dependencia nova.
 */
export interface CronParseado {
  minuto: Set<number>;
  hora: Set<number>;
  diaMes: Set<number>;
  mes: Set<number>;
  diaSemana: Set<number>;
  diaMesRestrito: boolean;
  diaSemanaRestrito: boolean;
}

const LIMITES: Array<[string, number, number]> = [
  ["minuto", 0, 59],
  ["hora", 0, 23],
  ["dia do mes", 1, 31],
  ["mes", 1, 12],
  ["dia da semana", 0, 7],
];

function campo(texto: string, nome: string, min: number, max: number): Set<number> {
  const valores = new Set<number>();
  for (const parte of texto.split(",")) {
    const [faixa, passoTxt, excesso] = parte.split("/");
    if (excesso !== undefined || faixa === "") throw new Error(`Cron invalido no campo ${nome}: '${texto}'.`);
    const passo = passoTxt === undefined ? 1 : Number(passoTxt);
    if (!Number.isInteger(passo) || passo < 1) throw new Error(`Cron invalido no campo ${nome}: passo '${passoTxt}'.`);
    let inicio = min;
    let fim = max;
    if (faixa !== "*") {
      const [a, b, extra] = faixa.split("-");
      if (extra !== undefined) throw new Error(`Cron invalido no campo ${nome}: '${parte}'.`);
      inicio = Number(a);
      fim = b === undefined ? (passoTxt === undefined ? inicio : max) : Number(b);
    }
    if (!Number.isInteger(inicio) || !Number.isInteger(fim) || inicio < min || fim > max || inicio > fim) {
      throw new Error(`Cron invalido no campo ${nome}: '${parte}' (permitido ${min}-${max}).`);
    }
    for (let v = inicio; v <= fim; v += passo) valores.add(v);
  }
  return valores;
}

export function parseCron(expressao: string): CronParseado {
  const partes = expressao.trim().split(/\s+/);
  if (partes.length !== 5) throw new Error(`Cron invalido: '${expressao}' (esperado 5 campos: min hora dia-mes mes dia-semana).`);
  const [minuto, hora, diaMes, mes, diaSemana] = partes.map((p, i) => campo(p, LIMITES[i][0], LIMITES[i][1], LIMITES[i][2]));
  if (diaSemana.has(7)) diaSemana.add(0);
  return {
    minuto, hora, diaMes, mes, diaSemana,
    diaMesRestrito: partes[2] !== "*",
    diaSemanaRestrito: partes[4] !== "*",
  };
}

export function validarCron(expressao: string): void {
  parseCron(expressao);
}

export function correspondeCron(cron: CronParseado, data: Date): boolean {
  if (!cron.minuto.has(data.getMinutes()) || !cron.hora.has(data.getHours()) || !cron.mes.has(data.getMonth() + 1)) return false;
  const okMes = cron.diaMes.has(data.getDate());
  const okSemana = cron.diaSemana.has(data.getDay());
  if (cron.diaMesRestrito && cron.diaSemanaRestrito) return okMes || okSemana;
  if (cron.diaMesRestrito) return okMes;
  if (cron.diaSemanaRestrito) return okSemana;
  return true;
}

/** Proximo instante (minuto cheio) estritamente posterior a `desde` que satisfaz a expressao; null se nao houver em 5 anos. */
export function proximaExecucao(expressao: string | CronParseado, desde: Date): Date | null {
  const cron = typeof expressao === "string" ? parseCron(expressao) : expressao;
  const t = new Date(desde.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  const limite = desde.getTime() + 5 * 366 * 86_400_000;
  while (t.getTime() <= limite) {
    if (correspondeCron(cron, t)) return t;
    t.setMinutes(t.getMinutes() + 1);
  }
  return null;
}
