//! Busca de texto para a busca global (todas as abas). Sem UI, testável.
//!
//! As posições devolvidas são em **UTF-16** (as do CodeMirror): com acento e emoji, bytes ou
//! caracteres desalinhariam o trecho que a UI vai selecionar ou trocar.

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

/// Teto de linhas de prévia por aba: o resto só entra na contagem.
pub const MAX_MATCHES_PER_TEXT: usize = 2000;
/// Largura máxima, em caracteres, do trecho de prévia mostrado por resultado.
const PREVIEW_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct Options {
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub regex: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Match {
    /// Intervalo do resultado no texto, em UTF-16.
    pub start: usize,
    pub end: usize,
    /// Linha (a partir de 1) onde o resultado começa.
    pub line: usize,
    /// Coluna (a partir de 1, em UTF-16) onde começa.
    pub col: usize,
    /// A linha onde começa (recortada se for longa) e o trecho a destacar nela, em UTF-16.
    pub preview: String,
    pub preview_start: usize,
    pub preview_end: usize,
    /// Texto que entra no lugar, já com os grupos (`$1`) expandidos. Só quando se pediu para substituir.
    pub replacement: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Hits {
    pub matches: Vec<Match>,
    /// Total de resultados (pode passar de `matches.len()`).
    pub total: usize,
}

/// Compila a consulta. `Err` leva a mensagem para a UI mostrar ("expressão inválida").
pub fn compile(query: &str, opts: &Options) -> Result<Regex, String> {
    let mut pat = if opts.regex { query.to_string() } else { regex::escape(query) };
    if opts.whole_word {
        pat = format!(r"\b(?:{pat})\b");
    }
    RegexBuilder::new(&pat)
        .case_insensitive(!opts.case_sensitive)
        .multi_line(true)
        .size_limit(2 << 20)
        .build()
        .map_err(|e| e.to_string().lines().last().unwrap_or("expressão inválida").trim().to_string())
}

/// Acha os resultados de `query` em `text`. Consulta vazia não acha nada; `replace` calcula, para
/// cada resultado, o texto que entraria no lugar (com `$1` etc. quando é expressão regular).
pub fn find(text: &str, query: &str, opts: &Options, replace: Option<&str>) -> Result<Hits, String> {
    let mut hits = Hits::default();
    if query.is_empty() {
        return Ok(hits);
    }
    let re = compile(query, opts)?;
    // posições acumuladas: evita recontar o texto desde o começo a cada resultado
    let (mut at_byte, mut at_utf16, mut line_no, mut line_start) = (0usize, 0usize, 1usize, 0usize);
    for caps in re.captures_iter(text) {
        let m = caps.get(0).expect("grupo 0 sempre existe");
        if m.start() == m.end() {
            continue; // casamento vazio (ex.: `^`) não é resultado
        }
        hits.total += 1;
        if hits.matches.len() >= MAX_MATCHES_PER_TEXT {
            continue;
        }
        let gap = &text[at_byte..m.start()];
        at_utf16 += gap.encode_utf16().count();
        for (i, b) in gap.bytes().enumerate() {
            if b == b'\n' {
                line_no += 1;
                line_start = at_byte + i + 1;
            }
        }
        at_byte = m.start();
        let start = at_utf16;
        let end = start + m.as_str().encode_utf16().count();
        let line_end = text[line_start..].find('\n').map_or(text.len(), |i| line_start + i);
        let line_text = text[line_start..line_end].trim_end_matches('\r');
        let col_chars = text[line_start..m.start()].chars().count();
        let len_chars = text[m.start()..m.end().min(line_start + line_text.len())].chars().count();
        let (preview, ps, pe) = clip(line_text, col_chars, len_chars);
        let replacement = replace.map(|r| {
            if opts.regex {
                let mut out = String::new();
                caps.expand(r, &mut out);
                out
            } else {
                r.to_string()
            }
        });
        hits.matches.push(Match {
            start,
            end,
            line: line_no,
            col: text[line_start..m.start()].encode_utf16().count() + 1,
            preview,
            preview_start: ps,
            preview_end: pe,
            replacement,
        });
    }
    Ok(hits)
}

/// Recorta uma linha longa em volta do resultado e devolve onde ele fica no recorte (em UTF-16).
fn clip(line: &str, col: usize, len: usize) -> (String, usize, usize) {
    let chars: Vec<char> = line.chars().collect();
    let len = len.min(chars.len().saturating_sub(col));
    let mut from = 0;
    if chars.len() > PREVIEW_CHARS && col > 40 {
        from = col - 40;
    }
    let to = (from + PREVIEW_CHARS).min(chars.len());
    let shown: String = chars[from..to].iter().collect();
    let hl_from = col.saturating_sub(from).min(to - from);
    let hl_to = (col + len).saturating_sub(from).min(to - from);
    let ps: usize = chars[from..from + hl_from].iter().map(|c| c.len_utf16()).sum();
    let pe: usize = ps + chars[from + hl_from..from + hl_to].iter().map(|c| c.len_utf16()).sum::<usize>();
    (shown, ps, pe)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> Options {
        Options::default()
    }

    #[test]
    fn finds_with_line_and_column() {
        let h = find("um\ndois dois\ntrês", "dois", &opts(), None).unwrap();
        assert_eq!(h.total, 2);
        assert_eq!((h.matches[0].line, h.matches[0].col, h.matches[0].start, h.matches[0].end), (2, 1, 3, 7));
        assert_eq!((h.matches[1].line, h.matches[1].col), (2, 6));
        assert_eq!(h.matches[0].preview, "dois dois");
        assert_eq!((h.matches[0].preview_start, h.matches[0].preview_end), (0, 4));
    }

    #[test]
    fn positions_are_utf16_not_bytes_or_chars() {
        // "😀" ocupa 2 unidades UTF-16, 1 char e 4 bytes; "é" 1, 1 e 2
        let h = find("😀é alvo\nx alvo", "alvo", &opts(), None).unwrap();
        assert_eq!((h.matches[0].start, h.matches[0].end), (4, 8));
        assert_eq!(h.matches[0].col, 5);
        assert_eq!((h.matches[0].preview_start, h.matches[0].preview_end), (4, 8));
        assert_eq!((h.matches[1].start, h.matches[1].line), (11, 2));
    }

    #[test]
    fn case_and_whole_word_options() {
        let t = "Casa casa casaco";
        assert_eq!(find(t, "casa", &opts(), None).unwrap().total, 3);
        assert_eq!(find(t, "casa", &Options { case_sensitive: true, ..opts() }, None).unwrap().total, 2);
        assert_eq!(find(t, "casa", &Options { whole_word: true, ..opts() }, None).unwrap().total, 2);
    }

    #[test]
    fn plain_query_is_literal_and_regex_is_not() {
        assert_eq!(find("a.c abc", "a.c", &opts(), None).unwrap().total, 1);
        assert_eq!(find("a.c abc", "a.c", &Options { regex: true, ..opts() }, None).unwrap().total, 2);
    }

    #[test]
    fn invalid_regex_is_an_error_and_empty_query_finds_nothing() {
        assert!(find("x", "(", &Options { regex: true, ..opts() }, None).is_err());
        assert_eq!(find("x", "", &opts(), None).unwrap().total, 0);
        assert_eq!(find("abc", "^", &Options { regex: true, ..opts() }, None).unwrap().total, 0, "casamento vazio não conta");
    }

    #[test]
    fn replacement_expands_groups_only_in_regex_mode() {
        let re = Options { regex: true, ..opts() };
        let h = find("nome: ana", r"(\w+): (\w+)", &re, Some("$2=$1")).unwrap();
        assert_eq!(h.matches[0].replacement.as_deref(), Some("ana=nome"));
        let lit = find("a $1 b", "$1", &opts(), Some("$2")).unwrap();
        assert_eq!(lit.matches[0].replacement.as_deref(), Some("$2"), "no modo literal o $ é texto");
        assert_eq!(find("x", "x", &opts(), None).unwrap().matches[0].replacement, None);
    }

    #[test]
    fn long_lines_are_clipped_around_the_match_and_total_keeps_counting() {
        let line = format!("{}ALVO{}", "a".repeat(300), "b".repeat(300));
        let h = find(&line, "ALVO", &opts(), None).unwrap();
        let m = &h.matches[0];
        assert!(m.preview.chars().count() <= 200);
        assert_eq!(&m.preview[m.preview_start..m.preview_end], "ALVO");

        let many = "x ".repeat(MAX_MATCHES_PER_TEXT + 50);
        let h = find(&many, "x", &opts(), None).unwrap();
        assert_eq!(h.total, MAX_MATCHES_PER_TEXT + 50);
        assert_eq!(h.matches.len(), MAX_MATCHES_PER_TEXT);
    }

    #[test]
    fn crlf_does_not_leak_into_the_preview() {
        let h = find("um\r\ndois\r\n", "dois", &opts(), None).unwrap();
        assert_eq!(h.matches[0].preview, "dois");
        assert_eq!(h.matches[0].line, 2);
    }
}
