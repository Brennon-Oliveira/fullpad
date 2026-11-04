//! Histórico de versões: o `CHANGELOG.md` embutido no app, separado por versão.
//!
//! Formato: um cabeçalho `## 2.0.0 · 2026-11-04` por versão (a mais nova primeiro) e, abaixo, as
//! notas daquela versão, com as seções em `###`. Um `##` que não começa por uma versão `x.y.z`
//! (e o que vier antes da primeira versão) é texto comum. Sem UI, só funções puras.

/// Uma versão do histórico.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub version: String,
    /// `aaaa-mm-dd`, ou vazio se o cabeçalho não traz data.
    pub date: String,
    /// As notas, sem o cabeçalho, sem linhas em branco nas pontas.
    pub body: String,
}

/// `1.2.3` (aceita um `v` na frente) como números; qualquer outra coisa é `None`.
pub fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    let s = s.trim().trim_start_matches(['v', 'V']);
    let mut it = s.split('.');
    let a = it.next()?.parse().ok()?;
    let b = it.next()?.parse().ok()?;
    let c = it.next()?.parse().ok()?;
    if it.next().is_some() {
        return None;
    }
    Some((a, b, c))
}

/// O cabeçalho de uma versão: `## 2.0.0 · 2026-11-04` (a data é opcional).
fn header(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix("## ")?.trim();
    let (ver, date) = match rest.split_once('·') {
        Some((v, d)) => (v.trim(), d.trim()),
        None => (rest, ""),
    };
    parse_version(ver)?;
    Some((ver.trim_start_matches(['v', 'V']).to_string(), date.to_string()))
}

/// Separa o texto em versões, na ordem em que aparecem.
pub fn parse(text: &str) -> Vec<Entry> {
    let mut out: Vec<Entry> = Vec::new();
    let mut body: Vec<&str> = Vec::new();
    let mut fence = false;
    let flush = |out: &mut Vec<Entry>, body: &mut Vec<&str>| {
        if let Some(last) = out.last_mut() {
            last.body = body.join("\n").trim().to_string();
        }
        body.clear();
    };
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            fence = !fence;
        }
        match (!fence).then(|| header(line)).flatten() {
            Some((version, date)) => {
                flush(&mut out, &mut body);
                out.push(Entry { version, date, body: String::new() });
            }
            None if !out.is_empty() => body.push(line),
            None => {}
        }
    }
    flush(&mut out, &mut body);
    out
}

/// As versões de `from` até `to`, inclusive (qualquer uma das pontas pode faltar), da mais nova
/// para a mais antiga. As pontas podem estar em qualquer ordem.
pub fn range<'a>(entries: &'a [Entry], from: Option<&str>, to: Option<&str>) -> Vec<&'a Entry> {
    let (mut lo, mut hi) = (from.and_then(parse_version), to.and_then(parse_version));
    if let (Some(a), Some(b)) = (lo, hi) {
        if a > b {
            std::mem::swap(&mut lo, &mut hi);
        }
    }
    let mut v: Vec<&Entry> = entries
        .iter()
        .filter(|e| {
            let Some(n) = parse_version(&e.version) else { return false };
            lo.map_or(true, |l| n >= l) && hi.map_or(true, |h| n <= h)
        })
        .collect();
    v.sort_by_key(|e| std::cmp::Reverse(parse_version(&e.version)));
    v
}

/// O que entrou depois de `previous` até `current` (inclusive), da mais nova para a mais antiga.
pub fn since<'a>(entries: &'a [Entry], previous: &str, current: &str) -> Vec<&'a Entry> {
    let Some(prev) = parse_version(previous) else { return Vec::new() };
    range(entries, None, Some(current)).into_iter().filter(|e| parse_version(&e.version).is_some_and(|n| n > prev)).collect()
}

/// As versões como markdown (`## versão · data` e as notas), prontas para uma nota.
pub fn render(entries: &[&Entry]) -> String {
    let parts: Vec<String> = entries
        .iter()
        .map(|e| {
            let head = if e.date.is_empty() { format!("## {}", e.version) } else { format!("## {} · {}", e.version, e.date) };
            if e.body.is_empty() { head } else { format!("{head}\n\n{}", e.body) }
        })
        .collect();
    parts.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "# Histórico\n\nTexto solto.\n\n## 2.0.0 · 2026-11-04\n\n### Novidades\n\n- a\n\n## 1.1.0 · 2026-11-03\n\n- b\n\n## Outra coisa\n\n- c\n\n## 0.2.1\n\n```\n## 9.9.9\n```\n";

    fn names(r: Vec<&Entry>) -> Vec<String> {
        r.iter().map(|e| e.version.clone()).collect()
    }

    #[test]
    fn splits_versions_and_ignores_the_rest() {
        let e = parse(TEXT);
        assert_eq!(names(e.iter().collect()), ["2.0.0", "1.1.0", "0.2.1"]);
        assert_eq!(e[0].date, "2026-11-04");
        assert_eq!(e[0].body, "### Novidades\n\n- a");
        assert_eq!(e[1].body, "- b\n\n## Outra coisa\n\n- c", "um ## que não é versão fica no corpo");
        assert_eq!(e[2].date, "");
        assert!(e[2].body.contains("## 9.9.9"), "cabeçalho dentro de bloco de código não vale");
    }

    #[test]
    fn versions_compare_as_numbers() {
        assert_eq!(parse_version("v2.10.0"), Some((2, 10, 0)));
        assert_eq!(parse_version("2.0"), None);
        assert_eq!(parse_version("2.0.0.1"), None);
        let e = parse("## 2.9.0\n\n- x\n\n## 2.10.0\n\n- y\n\n## 2.2.0\n\n- z\n");
        assert_eq!(names(range(&e, None, None)), ["2.10.0", "2.9.0", "2.2.0"]);
    }

    #[test]
    fn range_is_inclusive_and_tolerates_swapped_ends() {
        let e = parse(TEXT);
        assert_eq!(names(range(&e, Some("1.1.0"), Some("2.0.0"))), ["2.0.0", "1.1.0"]);
        assert_eq!(names(range(&e, Some("2.0.0"), Some("1.1.0"))), ["2.0.0", "1.1.0"]);
        assert_eq!(names(range(&e, Some("1.0.0"), None)), ["2.0.0", "1.1.0"]);
        assert_eq!(names(range(&e, None, Some("1.0.0"))), ["0.2.1"]);
    }

    #[test]
    fn since_skips_what_the_user_already_had() {
        let e = parse(TEXT);
        assert_eq!(names(since(&e, "0.2.1", "2.0.0")), ["2.0.0", "1.1.0"]);
        assert_eq!(names(since(&e, "1.1.0", "2.0.0")), ["2.0.0"]);
        assert!(since(&e, "2.0.0", "2.0.0").is_empty());
        assert!(since(&e, "lixo", "2.0.0").is_empty());
    }

    #[test]
    fn render_roundtrips() {
        let e = parse(TEXT);
        let again = parse(&render(&e.iter().collect::<Vec<_>>()));
        assert_eq!(e, again);
    }

    #[test]
    fn shipped_changelog_is_well_formed() {
        let e = parse(include_str!("../../app/CHANGELOG.md"));
        assert!(!e.is_empty());
        assert!(e.iter().all(|e| !e.body.is_empty()));
        let versions: Vec<_> = e.iter().map(|e| parse_version(&e.version).unwrap()).collect();
        assert!(versions.windows(2).all(|w| w[0] > w[1]), "da mais nova para a mais antiga, sem repetir");
    }
}
