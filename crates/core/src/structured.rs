//! Base comum das visões em árvore de YAML e TOML: monta os mesmos [`Node`] do JSON (pré-ordem,
//! `end`, posições em UTF-16, dicas de valor), para a UI reaproveitar a árvore inteira.

use crate::json::{self, Doc, JsonError, Kind, Node};

/// Texto de um valor devolvido à UI (strings maiores são cortadas; o texto original fica no editor).
const MAX_TEXT: usize = 2_000;

/// Converte posições de byte ou de caractere do texto para unidades UTF-16 (as do CodeMirror).
pub struct Utf16 {
    ascii: bool,
    by_byte: Vec<u32>,
    by_char: Vec<u32>,
}

impl Utf16 {
    pub fn new(text: &str) -> Self {
        let ascii = text.is_ascii();
        if ascii {
            return Self { ascii, by_byte: Vec::new(), by_char: Vec::new() };
        }
        let mut by_byte = vec![0u32; text.len() + 1];
        let mut by_char = Vec::with_capacity(text.len() + 1);
        let mut u = 0u32;
        for (b, c) in text.char_indices() {
            for k in 0..c.len_utf8() {
                by_byte[b + k] = u;
            }
            by_char.push(u);
            u += c.len_utf16() as u32;
        }
        by_byte[text.len()] = u;
        by_char.push(u);
        Self { ascii, by_byte, by_char }
    }

    /// UTF-16 de um índice de byte (fora do texto: o fim).
    pub fn byte(&self, b: usize) -> usize {
        if self.ascii { b } else { self.by_byte[b.min(self.by_byte.len() - 1)] as usize }
    }

    /// UTF-16 de um índice de caractere.
    pub fn chr(&self, c: usize) -> usize {
        if self.ascii { c } else { self.by_char[c.min(self.by_char.len() - 1)] as usize }
    }
}

/// Erro com linha e coluna (1-based, UTF-16) a partir de um intervalo de bytes.
pub fn error_at(text: &str, u: &Utf16, from: usize, to: usize, message: String) -> JsonError {
    let from = from.min(text.len());
    let head = &text[..floor_boundary(text, from)];
    let line = head.matches('\n').count() + 1;
    let line_start = head.rfind('\n').map_or(0, |i| i + 1);
    let col = head[line_start..].encode_utf16().count() + 1;
    let (f, t) = (u.byte(from), u.byte(to.max(from)));
    JsonError { message, line, col, from: f, to: if t > f { t } else { f + 1 } }
}

fn floor_boundary(s: &str, mut i: usize) -> usize {
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

struct Frame {
    idx: usize,
    max_to: usize,
}

/// Monta a lista de nós. `open`/`close` para contêineres, `leaf` para valores simples.
#[derive(Default)]
pub struct Builder {
    pub nodes: Vec<Node>,
    stack: Vec<Frame>,
}

impl Builder {
    fn attach(&mut self) -> i32 {
        match self.stack.last() {
            Some(f) => {
                let idx = f.idx;
                self.nodes[idx].len += 1;
                idx as i32
            }
            None => -1,
        }
    }

    fn touch(&mut self, to: usize) {
        if let Some(f) = self.stack.last_mut() {
            f.max_to = f.max_to.max(to);
        }
    }

    pub fn open(&mut self, kind: Kind, key: Option<String>, kfrom: Option<usize>, from: usize) -> usize {
        let parent = self.attach();
        let idx = self.nodes.len();
        self.nodes.push(Node { parent, kind, key, kfrom, from, to: from, end: 0, len: 0, text: None, cut: false, hint: None });
        self.stack.push(Frame { idx, max_to: from });
        idx
    }

    /// Fecha o contêiner aberto por último; o fim é o maior entre `to` e o dos filhos.
    pub fn close(&mut self, to: usize) {
        let f = self.stack.pop().expect("close sem open");
        let to = to.max(f.max_to);
        let end = self.nodes.len() as u32;
        let n = &mut self.nodes[f.idx];
        n.to = to;
        n.end = end;
        self.touch(to);
    }

    pub fn leaf(&mut self, kind: Kind, key: Option<String>, kfrom: Option<usize>, from: usize, to: usize, text: String) {
        let parent = self.attach();
        let hint = if kind == Kind::String { json::classify(&text) } else { None };
        let cut = text.chars().count() > MAX_TEXT;
        let text = if cut { text.chars().take(MAX_TEXT).collect() } else { text };
        let to = to.max(from);
        self.nodes.push(Node { parent, kind, key, kfrom, from, to, end: self.nodes.len() as u32 + 1, len: 0, text: Some(text), cut, hint });
        self.touch(to);
        if let Some(k) = kfrom {
            self.touch(k);
        }
    }

    pub fn into_doc(self) -> Doc {
        let total = self.nodes.len();
        if total > json::MAX_NODES {
            return Doc { nodes: Vec::new(), too_big: true, total };
        }
        Doc { nodes: self.nodes, too_big: false, total }
    }
}
