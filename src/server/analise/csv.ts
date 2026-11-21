/**
 * Serializador CSV (RFC 4180) para os relatorios assincronos.
 * - Campos com virgula, aspas ou quebra de linha sao colocados entre aspas.
 * - Protecao contra "CSV injection": celulas de TEXTO iniciadas por = + - @ (ou TAB/CR) recebem
 *   um apostrofo na frente, para que planilhas nao as interpretem como formula. Numeros nao sao alterados.
 * - Prefixa o BOM UTF-8 para que o Excel (Windows) abra os acentos corretamente.
 */

type Celula = string | number | boolean | null | undefined;

function formatarCelula(valor: Celula): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : "";
  let texto = String(valor);
  if (typeof valor === "string" && /^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  if (/[",\r\n]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

export function paraCsv(linhas: ReadonlyArray<Record<string, Celula>>, colunas?: string[]): string {
  const cabecalho = colunas ?? Array.from(new Set(linhas.flatMap((l) => Object.keys(l))));
  const corpo = linhas.map((l) => cabecalho.map((c) => formatarCelula(l[c])).join(","));
  return "\uFEFF" + [cabecalho.map(formatarCelula).join(","), ...corpo].join("\r\n") + "\r\n";
}
