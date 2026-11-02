//! JSON: análise com posições, formatação e dicas de valor (link, imagem, cor). Sem UI.
//!
//! Por que um parser próprio e não `serde_json::Value`: precisamos da posição de cada nó no texto
//! (para ligar a árvore ao código), do texto original dos números (`12345678901234567890`, `1.0` e
//! `1e400` não podem mudar ao formatar) e das chaves repetidas, que um mapa descartaria.
//!
//! Todas as posições devolvidas à UI são em unidades UTF-16, que é o que o CodeMirror usa;
//! índices de byte desalinhariam com acento e emoji.

use crate::error::IoContext;
use serde::Serialize;

/// Profundidade máxima de aninhamento aceita (o parser é iterativo; isso só protege a UI).
pub const MAX_DEPTH: usize = 10_000;
/// Acima disso o documento é validado e formatado, mas a árvore não é montada.
pub const MAX_NODES: usize = 300_000;
/// Texto de um valor devolvido à UI (strings maiores são cortadas; o texto original fica no editor).
const MAX_TEXT: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Object,
    Array,
    String,
    Number,
    Bool,
    Null,
}

/// Um nó do documento. Os nós vêm em pré-ordem; os filhos de `i` são `i+1`, `nodes[i+1].end`, ...
/// até `end` (exclusivo).
#[derive(Debug, Clone, Serialize)]
pub struct Node {
    /// Índice do pai, ou -1 na raiz.
    pub parent: i32,
    pub kind: Kind,
    /// Nome do membro (decodificado), quando o pai é um objeto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// Início da chave (aspas incluídas), quando há chave.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kfrom: Option<usize>,
    /// Início do valor.
    pub from: usize,
    /// Fim do valor (exclusivo).
    pub to: usize,
    /// Índice logo depois do último descendente (nó folha: `i + 1`).
    pub end: u32,
    /// Quantidade de filhos diretos.
    pub len: u32,
    /// Texto do valor: string decodificada (cortada se enorme), número como escrito, `true`/`false`/`null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// A string foi cortada em `text`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub cut: bool,
    /// `url`, `mail`, `image` (URL de imagem), `image-data`, `image-local` ou `color`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Doc {
    pub nodes: Vec<Node>,
    /// Passou de [`MAX_NODES`]: `nodes` fica vazio.
    pub too_big: bool,
    /// Total de nós do documento.
    pub total: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct JsonError {
    pub message: String,
    /// 1-based; `col` conta unidades UTF-16.
    pub line: usize,
    pub col: usize,
    /// Trecho do erro no texto, em UTF-16 (`to > from` sempre).
    pub from: usize,
    pub to: usize,
}

impl std::fmt::Display for JsonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} (linha {}, coluna {})", self.message, self.line, self.col)
    }
}

impl std::error::Error for JsonError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Indent {
    Spaces(u8),
    Tab,
    /// Sem quebras de linha nem espaços (minificar).
    None,
}

impl Indent {
    /// `0` ou menos de um espaço vira minificado; 255 vira tab (formato da UI: `tab`, `2`, `4`...).
    pub fn parse(s: &str) -> Indent {
        match s {
            "tab" => Indent::Tab,
            "min" | "0" => Indent::None,
            n => n.parse::<u8>().map(|n| Indent::Spaces(n.min(8))).unwrap_or(Indent::Spaces(2)),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Parser

/// Posições em byte de um nó (só para formatar).
#[derive(Clone, Copy, Default)]
struct Raw {
    from: usize,
    to: usize,
    kfrom: usize,
    kto: usize,
}

struct Parsed {
    nodes: Vec<Node>,
    raw: Vec<Raw>,
    /// Havia comentário (só aceitos no modo tolerante).
    comment_at: Option<(usize, usize)>,
}

struct Open {
    idx: usize,
    close: u8,
}

struct P<'a> {
    s: &'a str,
    b: &'a [u8],
    /// Posição em byte.
    i: usize,
    /// Posição em UTF-16.
    u: usize,
    lenient: bool,
    nodes: Vec<Node>,
    raw: Vec<Raw>,
    comment_at: Option<(usize, usize)>,
}

type R<T> = std::result::Result<T, JsonError>;

impl<'a> P<'a> {
    fn new(s: &'a str, lenient: bool) -> Self {
        P { s, b: s.as_bytes(), i: 0, u: 0, lenient, nodes: Vec::new(), raw: Vec::new(), comment_at: None }
    }

    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }

    /// Avança um caractere (qualquer um), mantendo a posição UTF-16.
    fn bump(&mut self) {
        let c = self.b[self.i];
        let (bytes, units) = match c {
            0..=0x7f => (1, 1),
            0xc0..=0xdf => (2, 1),
            0xe0..=0xef => (3, 1),
            _ => (4, 2),
        };
        self.i += bytes;
        self.u += units;
    }

    /// Avança `n` bytes que se sabe serem ASCII.
    fn bump_ascii(&mut self, n: usize) {
        self.i += n;
        self.u += n;
    }

    /// Erro apontando para o caractere atual (ou o fim do texto).
    fn fail<T>(&self, message: impl Into<String>) -> R<T> {
        Err(self.error_at(self.i, self.u, message.into()))
    }

    fn error_at(&self, byte: usize, u16pos: usize, message: String) -> JsonError {
        let before = &self.s[..byte.min(self.s.len())];
        let line = before.bytes().filter(|&c| c == b'\n').count() + 1;
        let line_start = before.rfind('\n').map(|p| p + 1).unwrap_or(0);
        let col = before[line_start..].encode_utf16().count() + 1;
        let width = self.s[byte.min(self.s.len())..].chars().next().map(|c| c.len_utf16()).unwrap_or(1);
        JsonError { message, line, col, from: u16pos, to: u16pos + width }
    }

    fn unexpected<T>(&self, expected: &str) -> R<T> {
        match self.s[self.i..].chars().next() {
            None => self.fail(format!("Fim inesperado do texto (esperava {expected})")),
            Some(c) => self.fail(format!("Esperava {expected}, mas encontrei '{}'", c.escape_default())),
        }
    }

    fn skip_ws(&mut self) -> R<()> {
        loop {
            match self.peek() {
                Some(b' ' | b'\t' | b'\n' | b'\r') => self.bump_ascii(1),
                // BOM no meio do caminho (o core já tira o do início do arquivo).
                Some(0xEF) if self.s[self.i..].starts_with('\u{feff}') => self.bump(),
                Some(b'/') => {
                    let (bi, ui) = (self.i, self.u);
                    match self.b.get(self.i + 1) {
                        Some(b'/') if self.lenient => {
                            while let Some(c) = self.peek() {
                                if c == b'\n' {
                                    break;
                                }
                                self.bump();
                            }
                        }
                        Some(b'*') if self.lenient => {
                            self.bump_ascii(2);
                            loop {
                                match self.peek() {
                                    None => return self.fail("Comentário /* sem o fechamento */"),
                                    Some(b'*') if self.b.get(self.i + 1) == Some(&b'/') => {
                                        self.bump_ascii(2);
                                        break;
                                    }
                                    Some(_) => self.bump(),
                                }
                            }
                        }
                        _ => return self.fail("Comentários não fazem parte do JSON"),
                    }
                    self.comment_at.get_or_insert((bi, ui));
                }
                _ => return Ok(()),
            }
        }
    }

    fn expect(&mut self, c: u8, what: &str) -> R<()> {
        if self.peek() == Some(c) {
            self.bump_ascii(1);
            Ok(())
        } else {
            self.unexpected(what)
        }
    }

    /// Lê uma string a partir da aspa de abertura. Devolve o texto decodificado (no máximo `cap`
    /// caracteres) e se foi cortado.
    fn string(&mut self, cap: usize) -> R<(String, bool)> {
        self.bump_ascii(1); // "
        let mut out = String::new();
        let mut cut = false;
        let mut run = self.i;
        macro_rules! flush {
            () => {
                if run < self.i {
                    if out.len() < cap.saturating_mul(4).saturating_add(8) {
                        out.push_str(&self.s[run..self.i]);
                    } else {
                        cut = true;
                    }
                }
            };
        }
        loop {
            match self.peek() {
                None => return self.fail("String sem aspas de fechamento"),
                Some(b'"') => {
                    flush!();
                    self.bump_ascii(1);
                    break;
                }
                Some(b'\\') => {
                    flush!();
                    let (bi, ui) = (self.i, self.u);
                    self.bump_ascii(1);
                    let c = match self.peek() {
                        None => return self.fail("String sem aspas de fechamento"),
                        Some(c) => c,
                    };
                    let ch = match c {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            self.bump_ascii(1);
                            let hi = self.hex4(bi, ui)?;
                            let mut code = hi as u32;
                            if (0xD800..0xDC00).contains(&hi) && self.b.get(self.i) == Some(&b'\\') && self.b.get(self.i + 1) == Some(&b'u') {
                                let save = (self.i, self.u);
                                self.bump_ascii(2);
                                let lo = self.hex4(bi, ui)?;
                                if (0xDC00..0xE000).contains(&lo) {
                                    code = 0x10000 + ((hi as u32 - 0xD800) << 10) + (lo as u32 - 0xDC00);
                                } else {
                                    (self.i, self.u) = save; // não era um par: relê o segundo escape sozinho
                                }
                            }
                            let ch = char::from_u32(code).unwrap_or('\u{FFFD}');
                            if out.len() < cap.saturating_mul(4).saturating_add(8) {
                                out.push(ch);
                            } else {
                                cut = true;
                            }
                            run = self.i;
                            continue;
                        }
                        _ => return Err(self.error_at(bi, ui, format!("Escape inválido '\\{}' na string", self.s[self.i..].chars().next().unwrap_or('?')))),
                    };
                    self.bump_ascii(1);
                    if out.len() < cap.saturating_mul(4).saturating_add(8) {
                        out.push(ch);
                    } else {
                        cut = true;
                    }
                    run = self.i;
                }
                Some(c) if c < 0x20 => return self.fail("Caractere de controle dentro da string (use \\n, \\t...)"),
                Some(_) => self.bump(),
            }
        }
        if out.chars().count() > cap {
            out = out.chars().take(cap).collect();
            cut = true;
        }
        Ok((out, cut))
    }

    fn hex4(&mut self, bi: usize, ui: usize) -> R<u16> {
        let digits = self.b.get(self.i..self.i + 4).filter(|d| d.iter().all(u8::is_ascii_hexdigit));
        match digits {
            Some(d) => {
                let v = u16::from_str_radix(std::str::from_utf8(d).unwrap(), 16).unwrap();
                self.bump_ascii(4);
                Ok(v)
            }
            None => Err(self.error_at(bi, ui, "Escape \\u precisa de 4 dígitos hexadecimais".into())),
        }
    }

    /// Lê um número; devolve onde terminou (o texto é o trecho original).
    fn number(&mut self) -> R<()> {
        let digits = |p: &mut Self| -> usize {
            let mut n = 0;
            while matches!(p.peek(), Some(b'0'..=b'9')) {
                p.bump_ascii(1);
                n += 1;
            }
            n
        };
        if self.peek() == Some(b'-') {
            self.bump_ascii(1);
        }
        match self.peek() {
            Some(b'0') => self.bump_ascii(1),
            Some(b'1'..=b'9') => {
                digits(self);
            }
            _ => return self.unexpected("um dígito"),
        }
        if self.peek() == Some(b'.') {
            self.bump_ascii(1);
            if digits(self) == 0 {
                return self.unexpected("dígitos depois do ponto");
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.bump_ascii(1);
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.bump_ascii(1);
            }
            if digits(self) == 0 {
                return self.unexpected("dígitos no expoente");
            }
        }
        if matches!(self.peek(), Some(c) if c.is_ascii_alphanumeric() || c == b'.' || c == b'_') {
            return self.fail("Número inválido");
        }
        Ok(())
    }

    fn literal(&mut self, word: &str) -> R<()> {
        if self.s[self.i..].starts_with(word) && !matches!(self.b.get(self.i + word.len()), Some(c) if c.is_ascii_alphanumeric() || *c == b'_') {
            self.bump_ascii(word.len());
            Ok(())
        } else {
            self.fail("Valor inválido (esperava um valor JSON)")
        }
    }

    fn push(&mut self, parent: i32, kind: Kind, key: Option<(String, usize, usize, usize)>, from: usize, bfrom: usize) -> usize {
        let idx = self.nodes.len();
        let (k, kfrom, bk) = match key {
            Some((k, ku, bkf, bkt)) => (Some(k), Some(ku), (bkf, bkt)),
            None => (None, None, (0, 0)),
        };
        self.nodes.push(Node { parent, kind, key: k, kfrom, from, to: from, end: idx as u32 + 1, len: 0, text: None, cut: false, hint: None });
        self.raw.push(Raw { from: bfrom, to: bfrom, kfrom: bk.0, kto: bk.1 });
        idx
    }

    /// Lê uma chave de objeto e o `:`.
    fn member_key(&mut self) -> R<(String, usize, usize, usize)> {
        if self.peek() != Some(b'"') {
            return self.unexpected("o nome do campo entre aspas");
        }
        let (bi, ui) = (self.i, self.u);
        let (k, _) = self.string(usize::MAX)?;
        let bt = self.i;
        self.skip_ws()?;
        self.expect(b':', "':' depois do nome do campo")?;
        Ok((k, ui, bi, bt))
    }

    fn run(mut self) -> R<Parsed> {
        let mut stack: Vec<Open> = Vec::new();
        let mut key: Option<(String, usize, usize, usize)> = None;
        self.skip_ws()?;
        loop {
            // --- um valor
            self.skip_ws()?;
            let parent = stack.last().map(|o| o.idx as i32).unwrap_or(-1);
            let (bi, ui) = (self.i, self.u);
            if let Some(top) = stack.last() {
                self.nodes[top.idx].len += 1;
            }
            match self.peek() {
                Some(c @ (b'{' | b'[')) => {
                    if stack.len() >= MAX_DEPTH {
                        return self.fail(format!("Aninhamento profundo demais (mais de {MAX_DEPTH} níveis)"));
                    }
                    let kind = if c == b'{' { Kind::Object } else { Kind::Array };
                    let idx = self.push(parent, kind, key.take(), ui, bi);
                    self.bump_ascii(1);
                    let close = if c == b'{' { b'}' } else { b']' };
                    stack.push(Open { idx, close });
                    self.skip_ws()?;
                    if self.peek() == Some(close) {
                        self.close(&mut stack);
                    } else {
                        if close == b'}' {
                            key = Some(self.member_key()?);
                        }
                        continue;
                    }
                }
                Some(b'"') => {
                    let idx = self.push(parent, Kind::String, key.take(), ui, bi);
                    let (text, cut) = self.string(MAX_TEXT)?;
                    // string cortada: só `data:image` (costuma passar do corte) ainda recebe dica
                    let hint = if !cut {
                        classify(&text)
                    } else if starts_with_ci(&text, "data:image/") && text.contains(";base64,") {
                        Some("image-data")
                    } else {
                        None
                    };
                    self.finish_scalar(idx, Some(text), cut, hint);
                }
                Some(b'-' | b'0'..=b'9') => {
                    let idx = self.push(parent, Kind::Number, key.take(), ui, bi);
                    self.number()?;
                    let t = self.s[bi..self.i].to_string();
                    self.finish_scalar(idx, Some(t), false, None);
                }
                Some(b't') => self.word(parent, &mut key, "true", Kind::Bool, bi, ui)?,
                Some(b'f') => self.word(parent, &mut key, "false", Kind::Bool, bi, ui)?,
                Some(b'n') => self.word(parent, &mut key, "null", Kind::Null, bi, ui)?,
                _ => return self.unexpected("um valor (objeto, lista, texto, número, true, false ou null)"),
            }
            // --- depois de um valor: separador ou fechamento, até achar o próximo valor
            loop {
                let Some(top) = stack.last() else {
                    self.skip_ws()?;
                    if self.peek().is_some() {
                        return self.fail("Há texto depois do fim do JSON");
                    }
                    return Ok(Parsed { nodes: self.nodes, raw: self.raw, comment_at: self.comment_at });
                };
                let close = top.close;
                self.skip_ws()?;
                match self.peek() {
                    Some(b',') => {
                        self.bump_ascii(1);
                        self.skip_ws()?;
                        if self.lenient && self.peek() == Some(close) {
                            self.close(&mut stack);
                            continue;
                        }
                        if close == b'}' {
                            key = Some(self.member_key()?);
                        }
                        break;
                    }
                    Some(c) if c == close => self.close(&mut stack),
                    _ => return self.unexpected(if close == b'}' { "',' ou '}'" } else { "',' ou ']'" }),
                }
            }
        }
    }

    fn word(&mut self, parent: i32, key: &mut Option<(String, usize, usize, usize)>, w: &str, kind: Kind, bi: usize, ui: usize) -> R<()> {
        let idx = self.push(parent, kind, key.take(), ui, bi);
        self.literal(w)?;
        self.finish_scalar(idx, Some(w.to_string()), false, None);
        Ok(())
    }

    fn finish_scalar(&mut self, idx: usize, text: Option<String>, cut: bool, hint: Option<&'static str>) {
        let n = &mut self.nodes[idx];
        n.to = self.u;
        n.text = text;
        n.cut = cut;
        n.hint = hint;
        self.raw[idx].to = self.i;
    }

    /// Consome o fechamento do contêiner do topo.
    fn close(&mut self, stack: &mut Vec<Open>) {
        let open = stack.pop().expect("pilha não vazia");
        self.bump_ascii(1);
        let end = self.nodes.len() as u32;
        let n = &mut self.nodes[open.idx];
        n.to = self.u;
        n.end = end;
        self.raw[open.idx].to = self.i;
    }
}

fn parse_inner(text: &str, lenient: bool) -> R<Parsed> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    P::new(text, lenient).run()
}

/// Analisa o documento. `lenient` aceita comentários (`//`, `/* */`) e vírgula sobrando (JSONC).
pub fn analyze(text: &str, lenient: bool) -> R<Doc> {
    // Um BOM no começo ocuparia uma posição no editor; o editor trabalha sem ele.
    let p = parse_inner(text, lenient)?;
    let total = p.nodes.len();
    if total > MAX_NODES {
        return Ok(Doc { nodes: Vec::new(), too_big: true, total });
    }
    Ok(Doc { nodes: p.nodes, too_big: false, total })
}

/// Só valida (sem montar nada para a UI).
pub fn validate(text: &str, lenient: bool) -> R<()> {
    parse_inner(text, lenient).map(|_| ())
}

// ---------------------------------------------------------------------------------------------
// Formatação

struct Frame {
    kids: Vec<usize>,
    next: usize,
    close: char,
}

fn children(nodes: &[Node], i: usize) -> Vec<usize> {
    let end = nodes[i].end as usize;
    let mut kids = Vec::with_capacity(nodes[i].len as usize);
    let mut c = i + 1;
    while c < end {
        kids.push(c);
        c = nodes[c].end as usize;
    }
    kids
}

fn newline(out: &mut String, indent: Indent, depth: usize) {
    match indent {
        Indent::None => {}
        Indent::Tab => {
            out.push('\n');
            out.extend(std::iter::repeat('\t').take(depth));
        }
        Indent::Spaces(n) => {
            out.push('\n');
            out.extend(std::iter::repeat(' ').take(depth * n as usize));
        }
    }
}

/// Formata o JSON com a indentação pedida, reemitindo o texto original dos escalares (números e
/// strings não mudam). Recusa quando há comentários, que seriam apagados.
pub fn format(text: &str, indent: Indent, sort_keys: bool) -> R<String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut p = P::new(text, true);
    let src = p.s;
    p.i = 0;
    let parsed = p.run()?;
    if let Some((bi, ui)) = parsed.comment_at {
        let probe = P::new(src, true);
        return Err(probe.error_at(bi, ui, "O texto tem comentários; formatar os apagaria".into()));
    }
    let Parsed { nodes, raw, .. } = parsed;
    let mut out = String::with_capacity(text.len() + text.len() / 4);

    let emit_value = |out: &mut String, i: usize, stack: &mut Vec<Frame>, depth_hint: usize| {
        let n = &nodes[i];
        match n.kind {
            Kind::Object | Kind::Array => {
                let (open, close) = if n.kind == Kind::Object { ('{', '}') } else { ('[', ']') };
                out.push(open);
                if n.len == 0 {
                    out.push(close);
                } else {
                    let mut kids = children(&nodes, i);
                    if sort_keys && n.kind == Kind::Object {
                        kids.sort_by(|&a, &b| nodes[a].key.cmp(&nodes[b].key));
                    }
                    stack.push(Frame { kids, next: 0, close });
                }
            }
            _ => out.push_str(&src[raw[i].from..raw[i].to]),
        }
        let _ = depth_hint;
    };

    let mut stack: Vec<Frame> = Vec::new();
    emit_value(&mut out, 0, &mut stack, 0);
    while !stack.is_empty() {
        let depth = stack.len();
        let top = stack.last_mut().unwrap();
        if top.next == top.kids.len() {
            let close = top.close;
            stack.pop();
            newline(&mut out, indent, depth - 1);
            out.push(close);
            continue;
        }
        let i = top.kids[top.next];
        if top.next > 0 {
            out.push(',');
        }
        top.next += 1;
        newline(&mut out, indent, depth);
        if nodes[i].key.is_some() {
            out.push_str(&src[raw[i].kfrom..raw[i].kto]);
            out.push(':');
            if indent != Indent::None {
                out.push(' ');
            }
        }
        emit_value(&mut out, i, &mut stack, depth);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// Dicas de valor

const IMAGE_EXT: [&str; 9] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"];

fn has_image_ext(s: &str) -> bool {
    let path = s.split(['?', '#']).next().unwrap_or(s);
    match path.rsplit_once('.') {
        Some((_, ext)) => IMAGE_EXT.iter().any(|e| ext.eq_ignore_ascii_case(e)),
        None => false,
    }
}

fn starts_with_ci(s: &str, prefix: &str) -> bool {
    s.len() >= prefix.len() && s.is_char_boundary(prefix.len()) && s[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// Decide o que uma string é: link, e-mail, imagem (URL, `data:` ou arquivo local) ou cor.
pub fn classify(s: &str) -> Option<&'static str> {
    if s.is_empty() || s.len() > 100_000 {
        return None;
    }
    let first = s.as_bytes()[0];
    if first == b'#' || matches!(first, b'r' | b'R' | b'h' | b'H') && s.contains('(') {
        if is_color(s) {
            return Some("color");
        }
    }
    if starts_with_ci(s, "data:image/") && s.contains(";base64,") {
        return Some("image-data");
    }
    let plain = !s.chars().any(|c| c.is_whitespace() || c.is_control());
    if !plain {
        return None;
    }
    if (starts_with_ci(s, "http://") && s.len() > 7) || (starts_with_ci(s, "https://") && s.len() > 8) {
        return Some(if has_image_ext(s) { "image" } else { "url" });
    }
    if starts_with_ci(s, "mailto:") && s[7..].contains('@') {
        return Some("mail");
    }
    if s.len() <= 1024 && has_image_ext(s) && !s.contains("://") || starts_with_ci(s, "file://") && has_image_ext(s) {
        return Some("image-local");
    }
    None
}

fn is_color(s: &str) -> bool {
    if let Some(hex) = s.strip_prefix('#') {
        return matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit());
    }
    let lower = s.to_ascii_lowercase();
    let Some((name, rest)) = lower.split_once('(') else { return false };
    if !matches!(name, "rgb" | "rgba" | "hsl" | "hsla") {
        return false;
    }
    let Some(args) = rest.strip_suffix(')') else { return false };
    let parts: Vec<&str> = args.split(|c: char| c == ',' || c == '/' || c.is_whitespace()).filter(|p| !p.is_empty()).collect();
    if !(3..=4).contains(&parts.len()) {
        return false;
    }
    parts.iter().all(|p| {
        let n = p.trim_end_matches("deg").trim_end_matches('%');
        !n.is_empty() && n.parse::<f64>().is_ok()
    })
}

// ---------------------------------------------------------------------------------------------
// Imagens locais (miniatura ao passar o mouse)

/// Maior imagem lida para a miniatura.
pub const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap());
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Tipo MIME de uma extensão de imagem aceita, ou `None`.
pub fn image_mime(path: &std::path::Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => return None,
    })
}

/// Caminho de uma imagem citada num JSON: `file://`, absoluto ou relativo à pasta do arquivo
/// (`base`). Só devolve caminhos de extensão de imagem.
pub fn resolve_image_path(value: &str, base: Option<&std::path::Path>) -> crate::Result<std::path::PathBuf> {
    use std::path::PathBuf;
    let raw = if starts_with_ci(value, "file://") {
        let rest = &value[7..];
        // file:///C:/x.png (Windows) e file:///home/x.png
        let rest = if rest.len() >= 3 && rest.as_bytes()[0] == b'/' && rest.as_bytes()[2] == b':' { &rest[1..] } else { rest };
        percent_decode(rest)
    } else {
        value.to_string()
    };
    let path = PathBuf::from(&raw);
    if image_mime(&path).is_none() {
        return Err(crate::Error::Invalid("não é um arquivo de imagem".into()));
    }
    if path.is_absolute() || raw.chars().nth(1) == Some(':') {
        return Ok(path);
    }
    match base {
        Some(dir) => Ok(dir.join(path)),
        None => Err(crate::Error::Invalid("caminho relativo sem a pasta do arquivo (salve a nota primeiro)".into())),
    }
}

/// Lê a imagem para a miniatura: só extensões de imagem e até [`MAX_IMAGE_BYTES`].
pub fn read_image(path: &std::path::Path) -> crate::Result<(Vec<u8>, &'static str)> {
    let mime = image_mime(path).ok_or_else(|| crate::Error::Invalid("não é um arquivo de imagem".into()))?;
    let meta = std::fs::metadata(path).at(path)?;
    if !meta.is_file() {
        return Err(crate::Error::Invalid("não é um arquivo".into()));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(crate::Error::Invalid("imagem grande demais para a miniatura".into()));
    }
    Ok((std::fs::read(path).at(path)?, mime))
}

// ---------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn fmt(s: &str) -> String {
        format(s, Indent::Spaces(2), false).unwrap()
    }

    #[test]
    fn analisa_estrutura_em_pre_ordem() {
        let d = analyze(r#"{"a":[1,2],"b":{}}"#, false).unwrap();
        let k: Vec<_> = d.nodes.iter().map(|n| (n.kind, n.key.clone(), n.len, n.end)).collect();
        assert_eq!(k[0], (Kind::Object, None, 2, 5));
        assert_eq!(k[1], (Kind::Array, Some("a".into()), 2, 4));
        assert_eq!(k[2].0, Kind::Number);
        assert_eq!(k[4], (Kind::Object, Some("b".into()), 0, 5));
        assert_eq!(d.nodes[2].parent, 1);
        assert_eq!(d.nodes[0].parent, -1);
    }

    #[test]
    fn posicoes_sao_utf16_com_acento_e_emoji() {
        let t = "{\"é\":\"😀\",\"b\":1}";
        let d = analyze(t, false).unwrap();
        let units: Vec<u16> = t.encode_utf16().collect();
        let slice = |n: &Node| String::from_utf16(&units[n.from..n.to]).unwrap();
        assert_eq!(slice(&d.nodes[1]), "\"😀\"");
        assert_eq!(slice(&d.nodes[2]), "1");
        let kf = d.nodes[2].kfrom.unwrap();
        assert_eq!(String::from_utf16(&units[kf..kf + 3]).unwrap(), "\"b\"");
        assert_eq!(slice(&d.nodes[0]), t);
    }

    #[test]
    fn numeros_ficam_exatamente_como_escritos() {
        let t = r#"{"a":12345678901234567890,"b":1.0,"c":1e400,"d":-0.50E+3}"#;
        let out = fmt(t);
        for n in ["12345678901234567890", "1.0", "1e400", "-0.50E+3"] {
            assert!(out.contains(n), "{n} em {out}");
        }
        let d = analyze(t, false).unwrap();
        assert_eq!(d.nodes[1].text.as_deref(), Some("12345678901234567890"));
    }

    #[test]
    fn chaves_repetidas_sao_mantidas() {
        let out = format(r#"{"a":1,"a":2}"#, Indent::None, false).unwrap();
        assert_eq!(out, r#"{"a":1,"a":2}"#);
    }

    #[test]
    fn formata_com_indentacao_e_estruturas_vazias() {
        assert_eq!(fmt(r#"{"a":[1,{}],"b":[]}"#), "{\n  \"a\": [\n    1,\n    {}\n  ],\n  \"b\": []\n}");
        assert_eq!(format(r#"{"a":[1]}"#, Indent::Tab, false).unwrap(), "{\n\t\"a\": [\n\t\t1\n\t]\n}");
        assert_eq!(format(" [ 1 , 2 ] ", Indent::Spaces(4), false).unwrap(), "[\n    1,\n    2\n]");
    }

    #[test]
    fn minificar_tira_todo_espaco_fora_de_strings() {
        let out = format("{ \"a b\" : [ 1 , \"x y\" ] }", Indent::None, false).unwrap();
        assert_eq!(out, r#"{"a b":[1,"x y"]}"#);
    }

    #[test]
    fn escapes_das_strings_nao_mudam_ao_formatar() {
        let t = r#"{"k\u00e9":"a\u00e9\n\/"}"#;
        assert_eq!(format(t, Indent::None, false).unwrap(), t);
        let d = analyze(t, false).unwrap();
        assert_eq!(d.nodes[1].key.as_deref(), Some("ké"));
        assert_eq!(d.nodes[1].text.as_deref(), Some("aé\n/"));
    }

    #[test]
    fn par_substituto_vira_um_caractere() {
        let d = analyze(r#""\ud83d\ude00""#, false).unwrap();
        assert_eq!(d.nodes[0].text.as_deref(), Some("😀"));
        assert_eq!(d.nodes[0].to, 14);
        let d = analyze(r#""\ud83dx""#, false).unwrap();
        assert_eq!(d.nodes[0].text.as_deref(), Some("\u{FFFD}x"));
    }

    #[test]
    fn ordena_chaves_so_do_proprio_objeto() {
        let out = format(r#"{"b":1,"a":{"z":1,"y":2},"c":[{"q":1,"p":2}]}"#, Indent::None, true).unwrap();
        assert_eq!(out, r#"{"a":{"y":2,"z":1},"b":1,"c":[{"p":2,"q":1}]}"#);
    }

    #[test]
    fn erro_traz_linha_coluna_e_trecho_em_utf16() {
        let e = analyze("{\n  \"é\": 😀\n}", false).unwrap_err();
        assert_eq!((e.line, e.col), (2, 8));
        let t: Vec<u16> = "{\n  \"é\": 😀\n}".encode_utf16().collect();
        assert_eq!(String::from_utf16(&t[e.from..e.to]).unwrap(), "😀");
        assert!(e.to > e.from);
    }

    #[test]
    fn erros_comuns_dizem_o_que_faltou() {
        let m = |t: &str| analyze(t, false).unwrap_err().message;
        assert!(m("").contains("Fim inesperado"));
        assert!(m("{\"a\":1").contains("Fim inesperado"));
        assert!(m("{\"a\" 1}").contains("':'"));
        assert!(m("[1 2]").contains("',' ou ']'"));
        assert!(m("[1,]").contains("valor"));
        assert!(m("{a:1}").contains("entre aspas"));
        assert!(m("01").contains("texto depois") || m("01").contains("Número"));
        assert!(m("1.").contains("dígitos"));
        assert!(m("[1] x").contains("depois do fim"));
        assert!(m("\"a\nb\"").contains("controle"));
        assert!(m("\"\\q\"").contains("Escape"));
        assert!(m("tru").contains("Valor inválido"));
        assert!(m("// oi\n1").contains("Comentários"));
    }

    #[test]
    fn jsonc_aceita_comentario_e_virgula_sobrando_so_no_modo_tolerante() {
        let t = "{\n // c\n \"a\": [1, 2,], /* x */\n}";
        assert!(analyze(t, false).is_err());
        let d = analyze(t, true).unwrap();
        assert_eq!(d.nodes[1].len, 2);
        let e = format(t, Indent::Spaces(2), false).unwrap_err();
        assert!(e.message.contains("comentários"));
        assert_eq!(e.line, 2);
        // sem comentário, vírgula sobrando some ao formatar
        assert_eq!(format("[1,2,]", Indent::None, false).unwrap(), "[1,2]");
    }

    #[test]
    fn aninhamento_muito_fundo_nao_estoura_a_pilha() {
        let n = 9_000;
        let t = format!("{}{}", "[".repeat(n), "]".repeat(n));
        assert!(analyze(&t, false).is_ok());
        assert_eq!(format(&t, Indent::None, false).unwrap(), t);
        let demais = format!("{}{}", "[".repeat(MAX_DEPTH + 1), "]".repeat(MAX_DEPTH + 1));
        assert!(analyze(&demais, false).unwrap_err().message.contains("profundo"));
    }

    #[test]
    fn bom_no_inicio_e_tolerado() {
        let d = analyze("\u{feff}[1]", false).unwrap();
        assert_eq!(d.nodes[0].from, 0);
    }

    #[test]
    fn strings_enormes_sao_cortadas_no_texto_mas_nao_na_formatacao() {
        let big = "x".repeat(50_000);
        let t = format!("[\"{big}\"]");
        let d = analyze(&t, false).unwrap();
        assert!(d.nodes[1].cut);
        assert_eq!(d.nodes[1].text.as_ref().unwrap().chars().count(), MAX_TEXT);
        assert_eq!(d.nodes[1].to, t.len() - 1);
        assert_eq!(format(&t, Indent::None, false).unwrap(), t);
    }

    #[test]
    fn data_uri_grande_ainda_vira_imagem() {
        let t = format!("[\"data:image/png;base64,{}\"]", "A".repeat(10_000));
        let d = analyze(&t, false).unwrap();
        assert!(d.nodes[1].cut);
        assert_eq!(d.nodes[1].hint, Some("image-data"));
        let t = format!("[\"{}\"]", "https://x.com/a.png".repeat(300));
        assert_eq!(analyze(&t, false).unwrap().nodes[1].hint, None);
    }

    #[test]
    fn documento_com_nos_demais_nao_monta_a_arvore() {
        let t = format!("[{}]", "0,".repeat(MAX_NODES) + "0");
        let d = analyze(&t, false).unwrap();
        assert!(d.too_big && d.nodes.is_empty());
        assert_eq!(d.total, MAX_NODES + 2);
    }

    #[test]
    fn dicas_de_valor() {
        assert_eq!(classify("https://example.com/a"), Some("url"));
        assert_eq!(classify("HTTP://example.com/a"), Some("url"));
        assert_eq!(classify("https://x.com/logo.PNG?v=2#a"), Some("image"));
        assert_eq!(classify("https://x.com/a b"), None);
        assert_eq!(classify("https://"), None);
        assert_eq!(classify("mailto:a@b.com"), Some("mail"));
        assert_eq!(classify("C:/Users/x/foto.png"), Some("image-local"));
        assert_eq!(classify("..\\img\\a.jpg"), Some("image-local"));
        assert_eq!(classify("file:///tmp/a.gif"), Some("image-local"));
        assert_eq!(classify("foto.txt"), None);
        assert_eq!(classify("data:image/png;base64,iVBOR"), Some("image-data"));
        assert_eq!(classify("data:text/plain;base64,aa"), None);
        assert_eq!(classify("texto qualquer"), None);
        assert_eq!(classify(""), None);
    }

    #[test]
    fn dicas_de_cor_sem_nome_css() {
        for c in ["#fff", "#ffff", "#ff8800", "#ff8800cc", "rgb(10,120,200)", "RGBA(1, 2, 3, 0.5)", "hsl(120, 50%, 50%)", "rgb(1 2 3 / 50%)", "hsl(120deg 50% 50%)"] {
            assert_eq!(classify(c), Some("color"), "{c}");
        }
        for c in ["red", "orange juice", "#ff", "#ggg", "rgb(1,2)", "rgb(a,b,c)", "hwb(1 2 3)", "#12345"] {
            assert_eq!(classify(c), None, "{c}");
        }
    }

    #[test]
    fn indent_parse() {
        assert_eq!(Indent::parse("tab"), Indent::Tab);
        assert_eq!(Indent::parse("4"), Indent::Spaces(4));
        assert_eq!(Indent::parse("99"), Indent::Spaces(8));
        assert_eq!(Indent::parse("min"), Indent::None);
        assert_eq!(Indent::parse("x"), Indent::Spaces(2));
    }

    #[test]
    fn desempenho_de_documento_grande() {
        let item = r#"{"id":12345,"nome":"Fulano de Tal","url":"https://example.com/a","tags":["a","b","c"],"ok":true,"x":null},"#;
        let t = format!("[{}{}]", item.repeat(80_000), "1");
        assert!(t.len() > 8_000_000);
        let t0 = std::time::Instant::now();
        let p = parse_inner(&t, false).unwrap();
        let parse = t0.elapsed();
        let t1 = std::time::Instant::now();
        let out = format(&t, Indent::Spaces(2), false).unwrap();
        let fmt_t = t1.elapsed();
        assert!(p.nodes.len() > 700_000 && out.len() > t.len());
        // folga grande: em máquina lenta ou em build de depuração ainda tem que ser razoável
        assert!(parse.as_millis() < 5_000 && fmt_t.as_millis() < 8_000, "parse {parse:?}, formatar {fmt_t:?}");
    }

    #[test]
    fn caminho_de_imagem_local() {
        use std::path::Path;
        let base = Path::new("/tmp/notas");
        assert_eq!(resolve_image_path("img/a.png", Some(base)).unwrap(), Path::new("/tmp/notas/img/a.png"));
        assert_eq!(resolve_image_path("file:///tmp/a%20b.JPG", None).unwrap(), Path::new("/tmp/a b.JPG"));
        assert_eq!(resolve_image_path("file:///C:/x/a.png", None).unwrap(), Path::new("C:/x/a.png"));
        assert_eq!(resolve_image_path("C:/x/a.gif", None).unwrap(), Path::new("C:/x/a.gif"));
        assert!(resolve_image_path("img/a.png", None).is_err(), "relativo precisa da pasta");
        assert!(resolve_image_path("/etc/passwd", None).is_err(), "só extensão de imagem");
        assert!(resolve_image_path("../segredo.txt", Some(base)).is_err());
    }

    #[test]
    fn le_imagem_com_limite_e_tipo() {
        let d = tempfile::tempdir().unwrap();
        let ok = d.path().join("a.PNG");
        std::fs::write(&ok, [1u8, 2, 3]).unwrap();
        assert_eq!(read_image(&ok).unwrap(), (vec![1, 2, 3], "image/png"));
        let txt = d.path().join("a.txt");
        std::fs::write(&txt, "x").unwrap();
        assert!(read_image(&txt).is_err());
        assert!(read_image(&d.path().join("nao-existe.png")).is_err());
        assert!(read_image(d.path()).is_err());
        let big = d.path().join("big.png");
        let f = std::fs::File::create(&big).unwrap();
        f.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(read_image(&big).is_err());
    }
}
