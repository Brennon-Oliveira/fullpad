//! Filtro do CSS dos livros (EPUB).
//!
//! O CSS de um livro é entrada não confiável. Em vez de procurar o que é perigoso (lista de
//! bloqueio, que sempre esquece algo), aqui só passa o que está numa **lista de permissão**:
//! regras de estilo e `@media`, propriedades de texto e caixa, valores sem funções nem referências
//! externas. Tudo o mais é descartado: `@import`, `@font-face`, qualquer `url()`, `position`,
//! `content`, `behavior`, `-moz-binding`, `expression()`, escapes com barra invertida…
//! A saída é reconstruída a partir das peças aceitas, então um erro ao separar as regras não
//! deixa passar nada que não esteja na lista.

const MAX_DEPTH: u8 = 3;

/// Propriedades aceitas (texto, cores e caixa). Nada de posicionamento, `content`, animações,
/// transformações nem imagens de fundo.
const ALLOWED: &[&str] = &[
    "color", "background", "background-color", "font", "font-family", "font-size", "font-style", "font-weight", "font-variant",
    "font-variant-caps", "font-variant-numeric", "font-kerning", "font-stretch", "letter-spacing", "word-spacing", "line-height",
    "text-align", "text-align-last", "text-indent", "text-transform", "text-decoration", "text-decoration-line", "text-decoration-style",
    "text-decoration-color", "white-space", "word-break", "overflow-wrap", "word-wrap", "hyphens", "direction", "unicode-bidi",
    "writing-mode", "text-orientation", "vertical-align", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding",
    "padding-top", "padding-right", "padding-bottom", "padding-left", "border", "border-top", "border-right", "border-bottom", "border-left",
    "border-color", "border-style", "border-width", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style", "border-top-width", "border-right-width",
    "border-bottom-width", "border-left-width", "border-radius", "border-collapse", "border-spacing", "width", "height", "min-width",
    "max-width", "min-height", "max-height", "display", "float", "clear", "list-style", "list-style-type", "list-style-position",
    "page-break-before", "page-break-after", "page-break-inside", "break-before", "break-after", "break-inside", "orphans", "widows",
    "caption-side", "table-layout", "empty-cells",
];

const DISPLAY_VALUES: &[&str] = &[
    "none", "block", "inline", "inline-block", "list-item", "table", "inline-table", "table-row", "table-cell", "table-row-group",
    "table-header-group", "table-footer-group", "table-column", "table-column-group", "table-caption", "flow-root",
];

/// Pedaços que invalidam um valor: funções que buscam algo de fora, escapes, delimitadores.
const FORBIDDEN_IN_VALUE: &[&str] = &["url(", "expression", "javascript", "image-set", "attr(", "var(", "env(", "src(", "element(", "@", "<", ">", "{", "}", "\\", "/*", "*/"];

/// Devolve só o que a lista de permissão aceita, sem o `!important` (dentro de uma `@layer`, um
/// `!important` do livro passaria por cima do tema do app).
pub fn sanitize(css: &str) -> String {
    let clean = strip_comments(css);
    let mut out = String::new();
    rules(&clean, 0, &mut out);
    out
}

/// Tira os comentários (sem mexer em strings). Feito antes de tudo: `ur/**/l(` vira `url(` e é recusado.
fn strip_comments(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    let mut quote: Option<u8> = None;
    while i < b.len() {
        match quote {
            Some(q) => {
                out.push(b[i]);
                if b[i] == b'\\' && i + 1 < b.len() {
                    out.push(b[i + 1]);
                    i += 1;
                } else if b[i] == q {
                    quote = None;
                }
            }
            None => {
                if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
                    i += 2;
                    while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                        i += 1;
                    }
                    i += 1; // pula o `/` final (ou sai, se o comentário não fechou)
                } else {
                    if b[i] == b'"' || b[i] == b'\'' {
                        quote = Some(b[i]);
                    }
                    out.push(b[i]);
                }
            }
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Posição do primeiro `target` fora de strings, parênteses e colchetes a partir de `from`.
fn find_top(s: &str, from: usize, targets: &[u8]) -> Option<usize> {
    let b = s.as_bytes();
    let (mut depth, mut quote) = (0i32, None);
    let mut i = from;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i += 1;
            } else if c == q {
                quote = None;
            }
        } else if c == b'"' || c == b'\'' {
            quote = Some(c);
        } else if c == b'(' || c == b'[' {
            depth += 1;
        } else if c == b')' || c == b']' {
            depth = (depth - 1).max(0);
        } else if depth == 0 && targets.contains(&c) {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Posição da `}` que fecha o bloco aberto antes de `from` (aceita blocos e strings dentro).
fn matching_brace(s: &str, from: usize) -> Option<usize> {
    let b = s.as_bytes();
    let (mut depth, mut quote) = (1i32, None);
    let mut i = from;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i += 1;
            } else if c == q {
                quote = None;
            }
        } else if c == b'"' || c == b'\'' {
            quote = Some(c);
        } else if c == b'{' {
            depth += 1;
        } else if c == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

fn rules(s: &str, depth: u8, out: &mut String) {
    let mut at = 0;
    while at < s.len() {
        let Some(stop) = find_top(s, at, b"{;") else { break };
        let prelude = s[at..stop].trim();
        if s.as_bytes()[stop] == b';' {
            at = stop + 1; // `@import …;`, `@charset …;` ou lixo: descartado
            continue;
        }
        let Some(end) = matching_brace(s, stop + 1) else { break };
        let body = &s[stop + 1..end];
        at = end + 1;
        if prelude.is_empty() {
            continue;
        }
        if let Some(rest) = prelude.strip_prefix('@') {
            let name: String = rest.chars().take_while(|c| c.is_ascii_alphabetic() || *c == '-').collect::<String>().to_ascii_lowercase();
            if name == "media" && depth < MAX_DEPTH && safe_media(rest[name.len()..].trim()) {
                let mut inner = String::new();
                rules(body, depth + 1, &mut inner);
                if !inner.is_empty() {
                    out.push_str(&format!("@media {}{{{inner}}}\n", rest[name.len()..].trim()));
                }
            }
            continue; // @font-face, @keyframes, @supports, @page, @namespace…
        }
        if !safe_selector(prelude) {
            continue;
        }
        let decls = declarations(body);
        if !decls.is_empty() {
            out.push_str(&format!("{}{{{decls}}}\n", collapse_ws(prelude)));
        }
    }
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Seletores: letras, números e a pontuação de seletor. Sem barra invertida, `url(` nem nada que
/// feche ou abra blocos.
fn safe_selector(sel: &str) -> bool {
    let lower = sel.to_ascii_lowercase();
    !lower.contains("url(")
        && !lower.contains("expression")
        && !sel.contains(['\\', '{', '}', ';', '@', '<', '\0'])
        && sel.chars().all(|c| !c.is_control())
}

fn safe_media(q: &str) -> bool {
    !q.is_empty() && q.len() < 200 && q.chars().all(|c| c.is_ascii_alphanumeric() || " (),:.-/<>=_".contains(c)) && !q.to_ascii_lowercase().contains("url")
}

fn declarations(body: &str) -> String {
    let mut out = String::new();
    let mut at = 0;
    while at < body.len() {
        let stop = find_top(body, at, b";").unwrap_or(body.len());
        let decl = &body[at..stop];
        at = stop + 1;
        let Some((name, value)) = decl.split_once(':') else { continue };
        let name = name.trim().to_ascii_lowercase();
        if !ALLOWED.contains(&name.as_str()) {
            continue;
        }
        let mut value = value.trim();
        if let Some(i) = value.rfind('!') {
            // `!important` (com ou sem espaço depois do `!`); outro `!` solto invalida o valor
            if value[i + 1..].trim().eq_ignore_ascii_case("important") {
                value = value[..i].trim();
            }
        }
        if value.is_empty() || value.contains('!') || value.chars().any(|c| c.is_control()) {
            continue;
        }
        let lower = value.to_ascii_lowercase();
        if FORBIDDEN_IN_VALUE.iter().any(|f| lower.contains(f)) {
            continue;
        }
        if name == "display" && !DISPLAY_VALUES.contains(&lower.as_str()) {
            continue;
        }
        out.push_str(&format!("{name}:{};", collapse_ws(value)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_normal_book_styles() {
        let css = "p { text-indent: 1.5em; margin: 0 0 .5em; color: #333 }\n.titulo { font-size: 1.4em; font-weight: bold; text-align: center }";
        assert_eq!(sanitize(css), "p{text-indent:1.5em;margin:0 0 .5em;color:#333;}\n.titulo{font-size:1.4em;font-weight:bold;text-align:center;}\n");
    }

    #[test]
    fn drops_imports_fonts_and_unknown_at_rules() {
        let css = "@charset \"utf-8\"; @import url(http://example.invalid/a.css); @import 'b.css';\n@font-face { font-family: x; src: url(f.woff) }\n@keyframes k { from { color: red } }\n@supports (display: grid) { p { color: red } }\np { color: blue }";
        assert_eq!(sanitize(css), "p{color:blue;}\n");
    }

    #[test]
    fn drops_every_url_and_external_reference() {
        let css = "body { background: url(http://example.invalid/b.png); color: red }\ndiv { background-color: expression(alert(1)); width: 10px }\nli { list-style: url(x.png) }\nq { background: image-set(\"a.png\" 1x) }";
        let out = sanitize(css);
        assert_eq!(out, "body{color:red;}\ndiv{width:10px;}\n");
        assert!(!out.contains("url") && !out.contains("expression") && !out.contains("image-set"));
    }

    #[test]
    fn drops_positioning_and_dangerous_properties() {
        let css = ".cobre { position: fixed; top: 0; left: 0; z-index: 99999; width: 100%; height: 100%; background: #f00 }\n* { behavior: url(x.htc); -moz-binding: url(x.xml#x); content: 'x'; transform: scale(9); animation: a 1s; opacity: 0 }";
        let out = sanitize(css);
        assert_eq!(out, ".cobre{width:100%;height:100%;background:#f00;}\n");
    }

    #[test]
    fn important_is_removed_so_the_app_theme_can_win() {
        assert_eq!(sanitize("p { color: red !important; margin: 0 ! IMPORTANT; padding: 1px ! x }"), "p{color:red;margin:0;}\n");
    }

    #[test]
    fn comment_and_escape_tricks_do_not_get_through() {
        let css = "a { background: ur/**/l(http://example.invalid/x) }\nb { background: \\75rl(http://example.invalid/x) }\nc { color: red; /* url(x) */ margin: 0 }\nd { width: exp/**/ression(1) }";
        let out = sanitize(css);
        assert_eq!(out, "c{color:red;margin:0;}\n");
    }

    #[test]
    fn display_only_takes_safe_values() {
        assert_eq!(sanitize("a { display: none } b { display: block } c { display: -webkit-box } d { display: contents }"), "a{display:none;}\nb{display:block;}\n");
    }

    #[test]
    fn media_queries_are_kept_but_filtered_inside() {
        let css = "@media screen and (max-width: 600px) { p { color: red; position: fixed } @font-face { src: url(x) } }\n@media url(x) { p { color: blue } }";
        assert_eq!(sanitize(css), "@media screen and (max-width: 600px){p{color:red;}\n}\n");
    }

    #[test]
    fn braces_and_semicolons_inside_strings_do_not_confuse_the_parser() {
        // o seletor com chaves na string é recusado (conservador), mas o que vem depois segue de pé
        let css = "a[title=\"}{;\"] { color: red }\np { font-family: \"A;B\", serif; color: blue }";
        assert_eq!(sanitize(css), "p{font-family:\"A;B\", serif;color:blue;}\n");
    }

    #[test]
    fn broken_input_never_loops_or_panics() {
        for css in ["", "{", "}", "p {", "p { color: red", "@media { p { color: red }", "p { color: \"unterminated", "/* unterminated", ";;;;", "@", "{{{{}}}}", "a{b{c{d{e{f{}}}}}}}"] {
            let _ = sanitize(css);
        }
        let big = "p{color:red}".repeat(50_000);
        assert_eq!(sanitize(&big).lines().count(), 50_000);
    }

    #[test]
    fn nested_media_is_depth_limited() {
        let mut css = String::from("p{color:red}");
        for _ in 0..10 {
            css = format!("@media screen {{ {css} }}");
        }
        let out = sanitize(&css);
        assert!(!out.contains("p{color"), "{out}");
    }
}
