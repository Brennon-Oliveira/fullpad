//! Layout de um diagrama DBML (`.dbmlx`): posições das tabelas e enquadramento da vista.
//!
//! O formato é o da extensão dbmlx do VS Code (`esquema.dbmlx.layout.json` ao lado do esquema):
//!
//! ```json
//! {
//!   "groups": {},
//!   "tables": { "usuarios": { "x": 40, "y": 120 } },
//!   "version": 1,
//!   "viewport": { "x": -10, "y": 30, "zoom": 0.8 }
//! }
//! ```
//!
//! Chaves em ordem alfabética, coordenadas inteiras, valores padrão omitidos (a vista em 0, 0, 100%
//! e `groups` vazio saem do arquivo). O texto que vem do disco é entrada **não confiável**: `parse`
//! valida versão, tipos e números (finitos, dentro de um teto) e arredonda as coordenadas. O que o
//! Fullpad não edita (grupos, chaves desconhecidas) volta intacto ao gravar. Sem UI e sem disco.

use serde_json::{Map, Number, Value};
use std::collections::BTreeMap;

pub const VERSION: u64 = 1;
/// Maior coordenada aceita (em módulo): evita números absurdos que quebrariam o desenho.
const MAX_COORD: f64 = 10_000_000.0;
const MIN_ZOOM: f64 = 0.01;
const MAX_ZOOM: f64 = 100.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Viewport {
    pub x: i64,
    pub y: i64,
    pub zoom: f64,
}

impl Default for Viewport {
    fn default() -> Self {
        Self { x: 0, y: 0, zoom: 1.0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pos {
    pub x: i64,
    pub y: i64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Layout {
    pub viewport: Viewport,
    pub tables: BTreeMap<String, Pos>,
    /// Grupos como vieram: o Fullpad ainda não os edita.
    pub groups: Map<String, Value>,
    /// Chaves de primeiro nível que esta versão não conhece.
    pub extra: Map<String, Value>,
}

/// O que o Fullpad muda no layout: a vista e as posições das tabelas (as que não estão aqui ficam).
#[derive(Debug, Clone, Default)]
pub struct Edit {
    pub viewport: Option<Viewport>,
    pub tables: BTreeMap<String, Pos>,
}

fn coord(v: &Value, what: &str) -> Result<i64, String> {
    let f = v.as_f64().ok_or_else(|| format!("{what}: esperava um número"))?;
    if !f.is_finite() || f.abs() > MAX_COORD {
        return Err(format!("{what}: número fora do limite"));
    }
    Ok(f.round() as i64)
}

fn obj<'a>(v: &'a Value, what: &str) -> Result<&'a Map<String, Value>, String> {
    v.as_object().ok_or_else(|| format!("{what}: esperava um objeto"))
}

/// Lê e valida o texto do layout. Texto vazio vale como layout vazio.
pub fn parse(text: &str) -> Result<Layout, String> {
    if text.trim().is_empty() {
        return Ok(Layout::default());
    }
    let root: Value = serde_json::from_str(text).map_err(|e| format!("JSON inválido: {e}"))?;
    let root = obj(&root, "layout")?;
    match root.get("version").and_then(Value::as_u64) {
        Some(VERSION) => {}
        Some(v) => return Err(format!("versão {v} do layout não é suportada (esta é a {VERSION})")),
        None => return Err("falta o campo \"version\"".into()),
    }
    let mut out = Layout::default();
    if let Some(v) = root.get("viewport") {
        let o = obj(v, "viewport")?;
        let zoom = match o.get("zoom") {
            None => 1.0,
            Some(z) => z.as_f64().filter(|z| z.is_finite() && (MIN_ZOOM..=MAX_ZOOM).contains(z)).ok_or("viewport.zoom: fora do limite")?,
        };
        out.viewport = Viewport {
            x: o.get("x").map_or(Ok(0), |v| coord(v, "viewport.x"))?,
            y: o.get("y").map_or(Ok(0), |v| coord(v, "viewport.y"))?,
            zoom,
        };
    }
    if let Some(t) = root.get("tables") {
        for (name, v) in obj(t, "tables")? {
            let o = obj(v, &format!("tables.{name}"))?;
            let get = |k: &str| o.get(k).ok_or_else(|| format!("tables.{name}: falta \"{k}\""));
            out.tables.insert(name.clone(), Pos { x: coord(get("x")?, &format!("tables.{name}.x"))?, y: coord(get("y")?, &format!("tables.{name}.y"))? });
        }
    }
    if let Some(g) = root.get("groups") {
        out.groups = obj(g, "groups")?.clone();
    }
    for (k, v) in root {
        if !matches!(k.as_str(), "version" | "viewport" | "tables" | "groups") {
            out.extra.insert(k.clone(), v.clone());
        }
    }
    Ok(out)
}

fn int(n: i64) -> Value {
    Value::Number(n.into())
}

/// O texto canônico do layout (2 espaços, chaves em ordem alfabética, quebra de linha no fim).
pub fn to_text(l: &Layout) -> String {
    let mut root = l.extra.clone();
    root.insert("version".into(), Value::Number(VERSION.into()));
    let tables: Map<String, Value> = l
        .tables
        .iter()
        .map(|(k, p)| {
            let mut o = Map::new();
            o.insert("x".into(), int(p.x));
            o.insert("y".into(), int(p.y));
            (k.clone(), Value::Object(o))
        })
        .collect();
    root.insert("tables".into(), Value::Object(tables));
    if !l.groups.is_empty() {
        root.insert("groups".into(), Value::Object(l.groups.clone()));
    }
    if l.viewport != Viewport::default() {
        let mut o = Map::new();
        if l.viewport.x != 0 {
            o.insert("x".into(), int(l.viewport.x));
        }
        if l.viewport.y != 0 {
            o.insert("y".into(), int(l.viewport.y));
        }
        let zoom = (l.viewport.zoom * 1000.0).round() / 1000.0;
        if zoom != 1.0 {
            if let Some(n) = Number::from_f64(zoom) {
                o.insert("zoom".into(), Value::Number(n));
            }
        }
        root.insert("viewport".into(), Value::Object(o));
    }
    let mut s = serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default();
    s.push('\n');
    s
}

/// Aplica `edit` ao texto do layout atual (pode ser vazio) e devolve o texto novo. Erra se o texto
/// atual é inválido: não se reescreve por cima de algo que a pessoa editou à mão e que não se entende.
pub fn apply(text: &str, edit: &Edit) -> Result<String, String> {
    let mut l = parse(text)?;
    if let Some(v) = edit.viewport {
        if !v.zoom.is_finite() || !(MIN_ZOOM..=MAX_ZOOM).contains(&v.zoom) || v.x.unsigned_abs() as f64 > MAX_COORD || v.y.unsigned_abs() as f64 > MAX_COORD {
            return Err("vista fora do limite".into());
        }
        l.viewport = v;
    }
    for (name, p) in &edit.tables {
        if p.x.unsigned_abs() as f64 > MAX_COORD || p.y.unsigned_abs() as f64 > MAX_COORD {
            return Err(format!("posição de {name} fora do limite"));
        }
        l.tables.insert(name.clone(), *p);
    }
    Ok(to_text(&l))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_is_an_empty_layout() {
        assert_eq!(parse("").unwrap(), Layout::default());
        assert_eq!(parse("  \n").unwrap(), Layout::default());
    }

    #[test]
    fn writes_the_canonical_format() {
        let mut e = Edit::default();
        e.tables.insert("usuarios".into(), Pos { x: 40, y: 120 });
        e.tables.insert("pedidos".into(), Pos { x: 0, y: 0 });
        let t = apply("", &e).unwrap();
        assert_eq!(
            t,
            "{\n  \"tables\": {\n    \"pedidos\": {\n      \"x\": 0,\n      \"y\": 0\n    },\n    \"usuarios\": {\n      \"x\": 40,\n      \"y\": 120\n    }\n  },\n  \"version\": 1\n}\n"
        );
    }

    #[test]
    fn default_viewport_is_omitted_and_partial_one_keeps_only_what_differs() {
        let mut e = Edit { viewport: Some(Viewport { x: -5, y: 0, zoom: 0.5 }), ..Edit::default() };
        let t = apply("", &e).unwrap();
        assert!(t.contains("\"viewport\": {\n    \"x\": -5,\n    \"zoom\": 0.5\n  }"), "{t}");
        e.viewport = Some(Viewport::default());
        assert!(!apply(&t, &e).unwrap().contains("viewport"));
    }

    #[test]
    fn apply_round_trips_and_keeps_what_it_does_not_edit() {
        let src = r#"{"version":1,"groups":{"g":{"x":1,"collapsed":true}},"tables":{"a":{"x":1,"y":2},"b":{"x":3,"y":4}},"extra":[1,2]}"#;
        let mut e = Edit::default();
        e.tables.insert("a".into(), Pos { x: 10, y: 20 });
        let t = apply(src, &e).unwrap();
        let l = parse(&t).unwrap();
        assert_eq!(l.tables["a"], Pos { x: 10, y: 20 });
        assert_eq!(l.tables["b"], Pos { x: 3, y: 4 });
        assert_eq!(l.groups["g"]["collapsed"], Value::Bool(true));
        assert_eq!(l.extra["extra"], serde_json::json!([1, 2]));
        assert_eq!(to_text(&l), t, "gravar de novo não muda nada");
    }

    #[test]
    fn rounds_coordinates_read_from_disk() {
        let l = parse(r#"{"version":1,"tables":{"a":{"x":1.6,"y":-2.4}}}"#).unwrap();
        assert_eq!(l.tables["a"], Pos { x: 2, y: -2 });
    }

    #[test]
    fn rejects_untrusted_input() {
        for bad in [
            "{",
            "[]",
            r#"{"tables":{}}"#,
            r#"{"version":2}"#,
            r#"{"version":"1"}"#,
            r#"{"version":1,"tables":[]}"#,
            r#"{"version":1,"tables":{"a":{"x":1}}}"#,
            r#"{"version":1,"tables":{"a":{"x":"1","y":2}}}"#,
            r#"{"version":1,"tables":{"a":{"x":1e12,"y":2}}}"#,
            r#"{"version":1,"viewport":{"zoom":0}}"#,
            r#"{"version":1,"viewport":{"zoom":-1}}"#,
            r#"{"version":1,"viewport":{"x":1e30}}"#,
            r#"{"version":1,"groups":5}"#,
        ] {
            assert!(parse(bad).is_err(), "devia recusar: {bad}");
        }
    }

    #[test]
    fn apply_refuses_to_rewrite_an_invalid_file() {
        assert!(apply("{ quebrado", &Edit::default()).is_err());
    }

    #[test]
    fn apply_checks_the_edit_bounds() {
        let mut e = Edit::default();
        e.tables.insert("a".into(), Pos { x: i64::MAX, y: 0 });
        assert!(apply("", &e).is_err());
        let e = Edit { viewport: Some(Viewport { x: 0, y: 0, zoom: f64::NAN }), ..Edit::default() };
        assert!(apply("", &e).is_err());
    }
}
