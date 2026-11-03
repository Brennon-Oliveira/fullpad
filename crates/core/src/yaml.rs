//! YAML: análise com posições para a árvore ao lado do código. Usa o analisador de eventos do
//! `saphyr-parser` (que dá a posição de cada nó) e resolve o tipo dos escalares pelo esquema
//! "core" do YAML 1.2. Sem formatação por enquanto: reescrever um YAML perderia comentários,
//! âncoras e estilos, então o app só valida e mostra a árvore.
//!
//! Os apelidos (`*a`) não são expandidos (aparecem como `*apelido`): nada de "billion laughs".

use crate::json::{Doc, JsonError, Kind};
use crate::structured::{Builder, Utf16, error_at};
use saphyr_parser::{Event, Parser, ScalarStyle};
use std::sync::OnceLock;

type R<T> = Result<T, JsonError>;

/// Que tipo um escalar sem aspas tem (YAML 1.2, esquema core).
pub fn plain_kind(s: &str) -> Kind {
    static NUM: OnceLock<regex::Regex> = OnceLock::new();
    let num = NUM.get_or_init(|| {
        regex::Regex::new(r"^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$").unwrap()
    });
    match s {
        "" | "~" | "null" | "Null" | "NULL" => Kind::Null,
        "true" | "True" | "TRUE" | "false" | "False" | "FALSE" => Kind::Bool,
        _ if num.is_match(s) => Kind::Number,
        _ => Kind::String,
    }
}

struct Frame {
    seq: bool,
    /// Mapa: já veio a chave e falta o valor.
    awaiting_value: bool,
    key: Option<(String, usize)>,
    /// Este contêiner é uma chave complexa (`? [a, b]`).
    key_container: bool,
}

fn parse_error(text: &str, u: &Utf16, chars: &[char], e: &saphyr_parser::ScanError) -> JsonError {
    let idx = e.marker().index().min(chars.len());
    let byte: usize = chars[..idx].iter().map(|c| c.len_utf8()).sum();
    let info = e.info().to_string();
    let end = (byte + chars.get(idx).map_or(1, |c| c.len_utf8())).min(text.len());
    error_at(text, u, byte, end, info)
}

fn build(text: &str) -> R<Doc> {
    let u = Utf16::new(text);
    let chars: Vec<char> = text.chars().collect();
    let mut b = Builder::default();
    // Embrulho para vários documentos (`---`); se houver só um, é removido no fim.
    b.open(Kind::Array, None, None, 0);
    let mut docs = 0usize;
    let mut stack: Vec<Frame> = Vec::new();
    let mut p = Parser::new_from_str(text);
    while let Some(ev) = p.next_event() {
        let (ev, span) = ev.map_err(|e| parse_error(text, &u, &chars, &e))?;
        let (s, e) = (u.chr(span.start.index()), u.chr(span.end.index()));
        // chave/posição do próximo valor
        let take_key = |stack: &mut Vec<Frame>, is_container: bool| -> Option<(Option<String>, Option<usize>)> {
            let top = stack.last_mut()?;
            if top.seq {
                return Some((None, None));
            }
            if top.awaiting_value {
                top.awaiting_value = false;
                let (k, kf) = top.key.take().unwrap_or(("?".into(), s));
                return Some((Some(k), Some(kf)));
            }
            if is_container {
                top.awaiting_value = false;
                return Some((Some("?".into()), Some(s)));
            }
            None // é uma chave simples: o chamador a guarda
        };
        match ev {
            Event::DocumentStart(_) => docs += 1,
            Event::Scalar(val, style, _, tag) => {
                let forced_str = tag.as_ref().is_some_and(|t| t.suffix == "str");
                let kind = if style == ScalarStyle::Plain && !forced_str { plain_kind(&val) } else { Kind::String };
                let top_is_key = stack.last().is_some_and(|f| !f.seq && !f.awaiting_value);
                if top_is_key {
                    let f = stack.last_mut().unwrap();
                    f.key = Some((val.to_string(), s));
                    f.awaiting_value = true;
                    continue;
                }
                let (key, kfrom) = take_key(&mut stack, false).unwrap_or((None, None));
                let text = if kind == Kind::Null && val.is_empty() { "null".to_string() } else { val.to_string() };
                b.leaf(kind, key, kfrom, s, e, text);
            }
            Event::Alias(_) => {
                let top_is_key = stack.last().is_some_and(|f| !f.seq && !f.awaiting_value);
                let label: String = chars[span.start.index().min(chars.len())..span.end.index().min(chars.len())].iter().collect();
                if top_is_key {
                    let f = stack.last_mut().unwrap();
                    f.key = Some((label, s));
                    f.awaiting_value = true;
                    continue;
                }
                let (key, kfrom) = take_key(&mut stack, false).unwrap_or((None, None));
                b.leaf(Kind::String, key, kfrom, s, e, label);
            }
            Event::SequenceStart(..) | Event::MappingStart(..) => {
                let seq = matches!(ev, Event::SequenceStart(..));
                let was_key = stack.last().is_some_and(|f| !f.seq && !f.awaiting_value);
                let (key, kfrom) = take_key(&mut stack, true).unwrap_or((None, None));
                b.open(if seq { Kind::Array } else { Kind::Object }, key, kfrom, s);
                stack.push(Frame { seq, awaiting_value: false, key: None, key_container: was_key });
            }
            Event::SequenceEnd | Event::MappingEnd => {
                if let Some(f) = stack.pop() {
                    // coleção em fluxo (`{}`/`[]`): o fim vem do evento; em bloco, dos filhos
                    let flow = chars.get(span.start.index()).is_some_and(|c| matches!(c, '{' | '[' | '}' | ']'));
                    b.close(if flow { e } else { 0 });
                    if let Some(parent) = stack.last_mut() {
                        if !parent.seq {
                            parent.awaiting_value = f.key_container;
                        }
                    }
                }
            }
            Event::DocumentEnd | Event::StreamStart | Event::StreamEnd | Event::Nothing => {}
        }
    }
    b.close(u.chr(chars.len()));
    let mut nodes = b.nodes;
    match docs {
        0 => {
            // texto vazio ou só comentários: um documento nulo
            nodes.truncate(0);
            b = Builder::default();
            b.leaf(Kind::Null, None, None, 0, 0, "null".into());
            return Ok(b.into_doc());
        }
        1 => {
            // tira o embrulho: o único documento vira a raiz
            nodes.remove(0);
            for n in &mut nodes {
                n.parent = if n.parent <= 0 { -1 } else { n.parent - 1 };
                n.end -= 1;
            }
        }
        _ => {}
    }
    b = Builder::default();
    b.nodes = nodes;
    Ok(b.into_doc())
}

/// Só valida.
pub fn validate(text: &str) -> R<()> {
    build(text.strip_prefix('\u{feff}').unwrap_or(text)).map(|_| ())
}

/// Analisa o YAML. Com vários documentos (`---`), a raiz é uma lista com um item por documento.
pub fn analyze(text: &str) -> R<Doc> {
    build(text.strip_prefix('\u{feff}').unwrap_or(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(d: &Doc) -> Vec<(Option<&str>, Kind, Option<&str>)> {
        d.nodes.iter().map(|n| (n.key.as_deref(), n.kind, n.text.as_deref())).collect()
    }

    #[test]
    fn mapping_with_scalars_of_every_type() {
        let d = analyze("nome: ana\nidade: 30\nativo: true\nvazio:\nnota: ~\npi: 3.14\ntexto: \"123\"\n").unwrap();
        let k = kinds(&d);
        assert_eq!(k[0], (None, Kind::Object, None));
        assert_eq!(k[1], (Some("nome"), Kind::String, Some("ana")));
        assert_eq!(k[2], (Some("idade"), Kind::Number, Some("30")));
        assert_eq!(k[3], (Some("ativo"), Kind::Bool, Some("true")));
        assert_eq!(k[4], (Some("vazio"), Kind::Null, Some("null")));
        assert_eq!(k[5].1, Kind::Null);
        assert_eq!(k[6].1, Kind::Number);
        assert_eq!(k[7], (Some("texto"), Kind::String, Some("123")), "com aspas é texto");
        assert_eq!(d.nodes[0].len, 7);
        assert_eq!(d.nodes[0].end as usize, d.nodes.len());
    }

    #[test]
    fn nested_collections_keep_preorder_ranges_and_positions() {
        let t = "a:\n  - x\n  - y: 1\nb: [1, 2]\n";
        let d = analyze(t).unwrap();
        let a = &d.nodes[1];
        assert_eq!((a.key.as_deref(), a.kind, a.len), (Some("a"), Kind::Array, 2));
        assert_eq!(a.kfrom, Some(0));
        let b = d.nodes.iter().find(|n| n.key.as_deref() == Some("b")).unwrap();
        assert_eq!(b.kind, Kind::Array);
        assert_eq!(&t[b.from..b.to], "[1, 2]");
        let y = d.nodes.iter().find(|n| n.key.as_deref() == Some("y")).unwrap();
        assert_eq!(&t[y.from..y.to], "1");
        // cada filho aponta para o pai certo
        for (i, n) in d.nodes.iter().enumerate().skip(1) {
            let p = n.parent as usize;
            assert!(p < i && (d.nodes[p].end as usize) > i, "nó {i}");
        }
    }

    #[test]
    fn positions_are_utf16() {
        let t = "k: \"😀é\"\nz: 1\n";
        let d = analyze(t).unwrap();
        let z = d.nodes.iter().find(|n| n.key.as_deref() == Some("z")).unwrap();
        // "k: \"😀é\"\n" = 3 + 1 + 2 + 1 + 1 + 1 = 9 unidades UTF-16
        assert_eq!(z.kfrom, Some(9));
    }

    #[test]
    fn several_documents_become_a_list_and_one_is_the_root() {
        let d = analyze("a: 1\n---\nb: 2\n").unwrap();
        assert_eq!((d.nodes[0].kind, d.nodes[0].len), (Kind::Array, 2));
        let one = analyze("---\na: 1\n").unwrap();
        assert_eq!(one.nodes[0].kind, Kind::Object);
        assert_eq!(one.nodes[0].parent, -1);
        assert_eq!(analyze("# só um comentário\n").unwrap().nodes[0].kind, Kind::Null);
    }

    #[test]
    fn aliases_are_not_expanded_and_merge_keys_are_plain_keys() {
        let d = analyze("base: &b\n  x: 1\ncopia:\n  <<: *b\n  y: 2\n").unwrap();
        assert!(d.nodes.iter().any(|n| n.key.as_deref() == Some("<<") && n.text.as_deref() == Some("*b")), "{:?}", kinds(&d));
        assert_eq!(d.total, d.nodes.len());
    }

    #[test]
    fn syntax_errors_have_line_column_and_a_range() {
        let e = analyze("a: [1, 2\nb: 3\n").unwrap_err();
        assert!(e.line >= 1 && e.col >= 1 && e.to > e.from, "{e:?}");
        assert!(validate("a: 1\n").is_ok());
        assert!(validate("a: b: c\n").is_err());
    }

    #[test]
    fn block_scalars_and_urls_get_hints() {
        let d = analyze("txt: |\n  linha 1\n  linha 2\nsite: https://exemplo.com/a.png\n").unwrap();
        assert_eq!(d.nodes[1].kind, Kind::String);
        assert_eq!(d.nodes[1].text.as_deref(), Some("linha 1\nlinha 2\n"));
        assert_eq!(d.nodes[2].hint, Some("image"));
    }

    #[test]
    fn plain_kind_follows_the_core_schema() {
        for (s, k) in [("1e3", Kind::Number), ("0x1F", Kind::Number), (".inf", Kind::Number), ("yes", Kind::String), ("1.2.3", Kind::String), ("True", Kind::Bool)] {
            assert_eq!(plain_kind(s), k, "{s}");
        }
    }

    #[test]
    fn deep_nesting_does_not_overflow_the_stack() {
        let t = "[".repeat(5000) + &"]".repeat(5000);
        let _ = analyze(&t); // pode recusar, mas não pode estourar a pilha
    }

    #[test]
    fn the_example_file_parses() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/example.yaml");
        let Ok(text) = std::fs::read_to_string(path) else { return };
        let d = analyze(&text).unwrap();
        assert!(d.nodes.len() > 5);
        for (i, n) in d.nodes.iter().enumerate().skip(1) {
            let p = n.parent as usize;
            assert!(p < i && (d.nodes[p].end as usize) > i, "nó {i}");
        }
    }
}
