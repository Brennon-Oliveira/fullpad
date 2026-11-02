/**
 * Depois de formatar, leva o cursor para o mesmo ponto do texto novo: formatar só muda espaços fora
 * das strings, então conta-se quantos caracteres que não são espaço vêm antes do cursor.
 */
export function mapCursor(old: string, pos: number, next: string): number {
  let n = 0;
  for (let i = 0; i < pos && i < old.length; i++) if (!/\s/.test(old[i])) n++;
  if (n === 0) return 0;
  let seen = 0;
  for (let j = 0; j < next.length; j++) {
    if (!/\s/.test(next[j])) {
      seen++;
      if (seen === n) return j + 1;
    }
  }
  return next.length;
}
