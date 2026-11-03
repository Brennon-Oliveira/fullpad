//! TOML: análise com posições para a árvore ao lado do código. Usa `toml_edit`, que guarda a
//! posição de cada chave e valor no texto original. Sem formatação por enquanto: reescrever um
//! TOML poderia perder comentários, então o app só valida e mostra a árvore.

use crate::json::{Doc, JsonError, Kind};
use crate::structured::{Builder, Utf16, error_at};
use toml_edit::{Document, Item, Table, Value};

type R<T> = Result<T, JsonError>;

struct Ctx<'a> {
    text: &'a str,
    u: Utf16,
    b: Builder,
}

fn span_start(r: Option<std::ops::Range<usize>>) -> Option<usize> {
    r.map(|r| r.start)
}

impl Ctx<'_> {
    fn raw(&self, r: Option<std::ops::Range<usize>>) -> (usize, usize, String) {
        match r {
            Some(r) if r.end <= self.text.len() => (r.start, r.end, self.text[r.clone()].to_string()),
            _ => (0, 0, String::new()),
        }
    }

    fn value(&mut self, key: Option<String>, kfrom: Option<usize>, v: &Value) {
        let kfrom = kfrom.map(|b| self.u.byte(b));
        match v {
            Value::String(f) => {
                let (s, e, _) = self.raw(v.span());
                let (s, e) = (self.u.byte(s), self.u.byte(e));
                self.b.leaf(Kind::String, key, kfrom, s, e, f.value().clone());
            }
            Value::Integer(_) | Value::Float(_) => {
                let (s, e, t) = self.raw(v.span());
                let (s, e) = (self.u.byte(s), self.u.byte(e));
                self.b.leaf(Kind::Number, key, kfrom, s, e, t);
            }
            Value::Boolean(_) => {
                let (s, e, t) = self.raw(v.span());
                let (s, e) = (self.u.byte(s), self.u.byte(e));
                self.b.leaf(Kind::Bool, key, kfrom, s, e, t);
            }
            Value::Datetime(_) => {
                let (s, e, t) = self.raw(v.span());
                let (s, e) = (self.u.byte(s), self.u.byte(e));
                self.b.leaf(Kind::String, key, kfrom, s, e, t);
            }
            Value::Array(a) => {
                let (s, e, _) = self.raw(v.span());
                self.b.open(Kind::Array, key, kfrom, self.u.byte(s));
                for item in a.iter() {
                    self.value(None, None, item);
                }
                self.b.close(self.u.byte(e));
            }
            Value::InlineTable(t) => {
                let (s, e, _) = self.raw(v.span());
                self.b.open(Kind::Object, key, kfrom, self.u.byte(s));
                self.entries(t.iter().map(|(k, v)| (k.to_string(), t.get_key_value(k).and_then(|(k, _)| span_start(k.span())), Item::Value(v.clone()))).collect());
                self.b.close(self.u.byte(e));
            }
        }
    }

    /// Entradas de uma tabela, na ordem em que aparecem no texto.
    fn entries(&mut self, mut list: Vec<(String, Option<usize>, Item)>) {
        list.sort_by_key(|(_, k, item)| k.or(span_start(item.span())).unwrap_or(usize::MAX));
        for (key, kfrom, item) in list {
            self.item(key, kfrom, &item);
        }
    }

    fn table_entries(&mut self, t: &Table) {
        let list = t
            .iter()
            .map(|(k, item)| (k.to_string(), t.get_key_value(k).and_then(|(k, _)| span_start(k.span())), item.clone()))
            .collect();
        self.entries(list);
    }

    fn item(&mut self, key: String, kfrom: Option<usize>, item: &Item) {
        let ku = kfrom.map(|b| self.u.byte(b));
        match item {
            Item::None => {}
            Item::Value(v) => self.value(Some(key), kfrom, v),
            Item::Table(t) => {
                let (s, e, _) = self.raw(t.span());
                let from = if t.span().is_some() { self.u.byte(s) } else { ku.unwrap_or(0) };
                self.b.open(Kind::Object, Some(key), ku, from);
                self.table_entries(t);
                self.b.close(self.u.byte(e));
            }
            Item::ArrayOfTables(a) => {
                let (s, e, _) = self.raw(a.span());
                let from = if a.span().is_some() { self.u.byte(s) } else { ku.unwrap_or(0) };
                self.b.open(Kind::Array, Some(key), ku, from);
                for t in a.iter() {
                    let (ts, te, _) = self.raw(t.span());
                    self.b.open(Kind::Object, None, None, self.u.byte(ts));
                    self.table_entries(t);
                    self.b.close(self.u.byte(te));
                }
                self.b.close(self.u.byte(e));
            }
        }
    }
}

fn parse(text: &str) -> R<Document<&str>> {
    Document::parse(text).map_err(|e| {
        let u = Utf16::new(text);
        let r = e.span().unwrap_or(0..0);
        error_at(text, &u, r.start, r.end, e.message().to_string())
    })
}

/// Só valida.
pub fn validate(text: &str) -> R<()> {
    parse(text.strip_prefix('\u{feff}').unwrap_or(text)).map(|_| ())
}

/// Analisa o TOML: a raiz é um objeto com as tabelas e chaves.
pub fn analyze(text: &str) -> R<Doc> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let doc = parse(text)?;
    let mut c = Ctx { text, u: Utf16::new(text), b: Builder::default() };
    c.b.open(Kind::Object, None, None, 0);
    c.table_entries(doc.as_table());
    let end = c.u.byte(text.len());
    c.b.close(end);
    Ok(c.b.into_doc())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find<'a>(d: &'a Doc, key: &str) -> &'a crate::json::Node {
        d.nodes.iter().find(|n| n.key.as_deref() == Some(key)).unwrap_or_else(|| panic!("sem {key}"))
    }

    #[test]
    fn tables_arrays_and_scalars() {
        let t = "titulo = \"Olá\"\nn = 42\nok = true\npi = 3.14\n\n[servidor]\nhost = \"x\"\nportas = [80, 443]\n\n[[usuarios]]\nnome = \"a\"\n\n[[usuarios]]\nnome = \"b\"\n";
        let d = analyze(t).unwrap();
        assert_eq!(d.nodes[0].kind, Kind::Object);
        assert_eq!((find(&d, "titulo").kind, find(&d, "titulo").text.as_deref()), (Kind::String, Some("Olá")));
        assert_eq!((find(&d, "n").kind, find(&d, "n").text.as_deref()), (Kind::Number, Some("42")));
        assert_eq!(find(&d, "ok").kind, Kind::Bool);
        let s = find(&d, "servidor");
        assert_eq!((s.kind, s.len), (Kind::Object, 2));
        assert_eq!(find(&d, "portas").kind, Kind::Array);
        let u = find(&d, "usuarios");
        assert_eq!((u.kind, u.len), (Kind::Array, 2));
        for (i, n) in d.nodes.iter().enumerate().skip(1) {
            let p = n.parent as usize;
            assert!(p < i && (d.nodes[p].end as usize) > i, "nó {i}");
        }
    }

    #[test]
    fn positions_point_at_the_original_text() {
        let t = "# c\nnome = \"ana\"\nn = 0x10\n";
        let d = analyze(t).unwrap();
        let n = find(&d, "nome");
        assert_eq!(&t[n.from..n.to], "\"ana\"");
        assert_eq!(&t[n.kfrom.unwrap()..n.kfrom.unwrap() + 4], "nome");
        let x = find(&d, "n");
        assert_eq!(x.text.as_deref(), Some("0x10"), "o número é como foi escrito");
    }

    #[test]
    fn positions_are_utf16() {
        let t = "a = \"😀\"\nb = 1\n";
        let d = analyze(t).unwrap();
        // `a = "😀"\n` = 4 + 1 + 2 + 1 + 1 = 9
        assert_eq!(find(&d, "b").kfrom, Some(9));
    }

    #[test]
    fn dotted_keys_inline_tables_and_dates() {
        let d = analyze("a.b.c = 1\nponto = { x = 1, y = 2 }\ndata = 2024-01-02T03:04:05Z\n").unwrap();
        assert_eq!(find(&d, "a").kind, Kind::Object);
        assert_eq!(find(&d, "ponto").len, 2);
        assert_eq!(find(&d, "data").text.as_deref(), Some("2024-01-02T03:04:05Z"));
    }

    #[test]
    fn errors_have_line_column_and_range() {
        let e = analyze("a = 1\nb = \n").unwrap_err();
        assert_eq!(e.line, 2);
        assert!(e.to > e.from);
        assert!(validate("a = 1\na = 2\n").is_err(), "chave repetida");
        assert!(validate("").is_ok());
    }
}
