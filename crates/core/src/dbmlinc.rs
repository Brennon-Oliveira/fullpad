//! `!include` do dbmlx: um esquema dividido em vários arquivos.
//!
//! ```text
//! !include "auth/users.dbmlx"
//! ```
//!
//! O caminho é **relativo ao arquivo que inclui** e o conteúdo entra como se estivesse no lugar. Aqui só se
//! acham as diretivas e se **leem** os arquivos (recursivamente); quem junta e limpa o texto para o parser é a UI.
//! O que vem do disco é entrada não confiável: só caminho relativo, só `.dbml`/`.dbmlx`/`.txt`, tetos de
//! tamanho, de quantidade e de profundidade, e um arquivo já lido não é lido de novo (inclusão circular ou
//! repetida não trava nem duplica). Nada é gravado. Sem UI.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Maior arquivo incluído (bytes).
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// Soma de todos os arquivos incluídos (bytes).
pub const MAX_TOTAL_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_FILES: usize = 200;
pub const MAX_DEPTH: usize = 16;

/// Uma diretiva `!include "x"` achada no texto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Directive {
    /// Linha do texto, a partir de 1.
    pub line: usize,
    pub path: String,
}

/// Um arquivo incluído, já lido (texto como está no disco).
#[derive(Debug, Clone, Serialize)]
pub struct Part {
    /// Nome para mostrar (caminho relativo à pasta do arquivo principal, quando dá).
    pub file: String,
    /// Linha, no arquivo principal, do `!include` de mais alto nível que trouxe este arquivo.
    pub line: usize,
    pub text: String,
    /// Caminho completo do arquivo (para abri-lo).
    pub path: String,
    /// Contexto, não incluído por quem está aberto: é o arquivo raiz (ou o que ele inclui) de um módulo aberto
    /// sozinho. Existe para as relações fecharem; erros dele não são mostrados como do arquivo aberto.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub context: bool,
}

/// Um problema ao incluir (arquivo que não existe, caminho recusado, teto estourado).
#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    /// Linha, no arquivo principal, do `!include` de mais alto nível envolvido.
    pub line: usize,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Resolved {
    pub parts: Vec<Part>,
    pub issues: Vec<Issue>,
}

/// As diretivas `!include` de um texto, na ordem. Só vale no começo da linha (depois de espaços) e fora de
/// comentário (`//`, `/* */`) e de texto entre `'''`.
pub fn scan(text: &str) -> Vec<Directive> {
    let mut out = Vec::new();
    let mut in_block = false; // dentro de /* ... */
    let mut in_triple = false; // dentro de ''' ... '''
    for (i, line) in text.lines().enumerate() {
        let t = line.trim_start();
        let was_open = in_block || in_triple;
        if !in_triple {
            // abre/fecha comentário de bloco (simples: não trata `/*` dentro de texto, que o dbmlx também não trata)
            let mut rest = line;
            loop {
                if in_block {
                    match rest.find("*/") {
                        Some(p) => {
                            in_block = false;
                            rest = &rest[p + 2..];
                        }
                        None => break,
                    }
                } else {
                    match rest.find("/*") {
                        Some(p) => {
                            // um `//` antes do `/*` o torna comentário de linha
                            if rest[..p].contains("//") {
                                break;
                            }
                            in_block = true;
                            rest = &rest[p + 2..];
                        }
                        None => break,
                    }
                }
            }
        }
        if line.matches("'''").count() % 2 == 1 && !in_block {
            in_triple = !in_triple;
        }
        if was_open {
            continue;
        }
        if let Some(rest) = t.strip_prefix("!include") {
            if !rest.starts_with(char::is_whitespace) {
                continue;
            }
            if let Some(path) = quoted(rest.trim_start()) {
                out.push(Directive { line: i + 1, path });
            }
        }
    }
    out
}

/// O texto entre aspas (duplas ou simples) no começo de `s`.
fn quoted(s: &str) -> Option<String> {
    let q = s.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let body = &s[1..];
    let end = body.find(q)?;
    Some(body[..end].to_string())
}

fn allowed_ext(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| ["dbml", "dbmlx", "txt"].iter().any(|x| e.eq_ignore_ascii_case(x)))
}

/// Resolve o caminho escrito num `!include` contra a pasta do arquivo que o contém.
fn target(dir: &Path, written: &str) -> Result<PathBuf, String> {
    if written.trim().is_empty() {
        return Err("caminho vazio".into());
    }
    if written.contains('\0') || written.contains("://") {
        return Err(format!("caminho não aceito: {written}"));
    }
    let p = Path::new(written);
    if p.is_absolute() || written.starts_with('/') || written.starts_with('\\') || p.has_root() {
        return Err(format!("o caminho de !include deve ser relativo ao arquivo: {written}"));
    }
    if !allowed_ext(p) {
        return Err(format!("só arquivos .dbml, .dbmlx ou .txt podem ser incluídos: {written}"));
    }
    Ok(dir.join(p))
}

/// Lê os arquivos incluídos por `text` (e os que eles incluem). `base` é a pasta do arquivo de `text`;
/// sem ela (nota que nunca foi salva) não há como resolver caminhos relativos.
pub fn resolve(base: Option<&Path>, text: &str) -> Resolved {
    let mut res = Resolved::default();
    let top = scan(text);
    if top.is_empty() {
        return res;
    }
    let Some(base) = base else {
        for d in top {
            res.issues.push(Issue { line: d.line, message: "salve o arquivo para usar !include: os caminhos são relativos a ele".into() });
        }
        return res;
    };
    let root = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut total: u64 = 0;
    // pilha (pré-ordem): (diretiva, pasta de quem inclui, linha de topo, profundidade)
    let mut stack: Vec<(Directive, PathBuf, usize, usize)> = top.into_iter().rev().map(|d| { let l = d.line; (d, root.clone(), l, 1) }).collect();
    while let Some((d, dir, line, depth)) = stack.pop() {
        let issue = |m: String| Issue { line, message: m };
        if depth > MAX_DEPTH {
            res.issues.push(issue(format!("!include aninhado demais (mais de {MAX_DEPTH} níveis): {}", d.path)));
            continue;
        }
        let path = match target(&dir, &d.path) {
            Ok(p) => p,
            Err(m) => {
                res.issues.push(issue(m));
                continue;
            }
        };
        let canon = match path.canonicalize() {
            Ok(c) => c,
            Err(_) => {
                res.issues.push(issue(format!("arquivo incluído não encontrado: {}", d.path)));
                continue;
            }
        };
        if !seen.insert(canon.clone()) {
            continue; // já incluído (repetido ou circular): vale uma vez só
        }
        if res.parts.len() >= MAX_FILES {
            res.issues.push(issue(format!("arquivos incluídos demais (o limite é {MAX_FILES})")));
            break;
        }
        let meta = match std::fs::metadata(&canon) {
            Ok(m) if m.is_file() => m,
            _ => {
                res.issues.push(issue(format!("arquivo incluído não encontrado: {}", d.path)));
                continue;
            }
        };
        if meta.len() > MAX_FILE_BYTES || total + meta.len() > MAX_TOTAL_BYTES {
            res.issues.push(issue(format!("arquivo incluído grande demais: {}", d.path)));
            continue;
        }
        let bytes = match std::fs::read(&canon) {
            Ok(b) => b,
            Err(e) => {
                res.issues.push(issue(format!("não foi possível ler {}: {e}", d.path)));
                continue;
            }
        };
        total += bytes.len() as u64;
        let body = String::from_utf8_lossy(bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes)).into_owned();
        let file = canon.strip_prefix(&root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_else(|_| d.path.clone());
        let child_dir = canon.parent().map(Path::to_path_buf).unwrap_or_else(|| root.clone());
        let nested = scan(&body);
        res.parts.push(Part { file, line, text: body, path: canon.to_string_lossy().into_owned(), context: false });
        for n in nested.into_iter().rev() {
            stack.push((n, child_dir.clone(), line, depth + 1));
        }
    }
    res
}

/// O arquivo que um `!include "written"` aponta, existente (para abri-lo): a mesma resolução e as mesmas
/// recusas de [`resolve`], contra a pasta `base` do arquivo que inclui.
pub fn include_path(base: &Path, written: &str) -> Result<PathBuf, String> {
    let p = target(base, written)?;
    let canon = p.canonicalize().map_err(|_| format!("arquivo incluído não encontrado: {written}"))?;
    if !canon.is_file() {
        return Err(format!("arquivo incluído não encontrado: {written}"));
    }
    Ok(canon)
}

/// Contexto de um módulo aberto sozinho: o texto do arquivo **raiz** (o de `root_text`, se a aba dele está aberta
/// com alterações, senão o do disco) e tudo o que ele inclui, menos o próprio módulo (`exclude`), que é o texto
/// principal. Assim as relações que a raiz declara entre módulos e as tabelas dos outros arquivos existem para o
/// compilador. Tudo marcado como `context`.
pub fn resolve_root(root: &Path, root_text: Option<&str>, exclude: Option<&Path>) -> Resolved {
    let mut res = Resolved::default();
    let Some(dir) = root.parent() else { return res };
    let canon_root = match root.canonicalize() {
        Ok(c) if allowed_ext(&c) && c.is_file() => c,
        _ => return res,
    };
    let exclude = exclude.and_then(|e| e.canonicalize().ok());
    let text = match root_text {
        Some(t) => t.to_string(),
        None => match std::fs::metadata(&canon_root) {
            Ok(m) if m.len() <= MAX_FILE_BYTES => std::fs::read(&canon_root)
                .map(|b| String::from_utf8_lossy(b.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&b)).into_owned())
                .unwrap_or_default(),
            _ => return res,
        },
    };
    let root_name = canon_root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let inner = resolve(Some(dir), &text);
    res.parts.push(Part { file: root_name, line: 1, text, path: canon_root.to_string_lossy().into_owned(), context: true });
    for mut p in inner.parts {
        if exclude.as_ref().is_some_and(|e| Path::new(&p.path) == e.as_path()) || Path::new(&p.path) == canon_root {
            continue;
        }
        p.context = true;
        p.line = 1;
        res.parts.push(p);
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, rel: &str, text: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn acha_as_diretivas() {
        let t = "Project p {}\n!include \"a.dbmlx\"\n  !include 'sub/b.dbml'\n// !include \"c.dbmlx\"\n/* !include \"d.dbmlx\"\n*/\n!include \"e.dbmlx\"\nNote: '''\n!include \"f.dbmlx\"\n'''\n!includex \"g\"\n!include h\n";
        let d = scan(t);
        assert_eq!(d, vec![Directive { line: 2, path: "a.dbmlx".into() }, Directive { line: 3, path: "sub/b.dbml".into() }, Directive { line: 7, path: "e.dbmlx".into() }]);
    }

    #[test]
    fn le_aninhado_relativo_a_quem_inclui() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.dbmlx", "!include \"sub/b.dbmlx\"\nTable a { id int }\n");
        write(dir.path(), "sub/b.dbmlx", "!include \"c.dbmlx\"\nTable b { id int }\n");
        write(dir.path(), "sub/c.dbmlx", "Table c { id int }\n");
        let r = resolve(Some(dir.path()), "x\n!include \"a.dbmlx\"\n");
        assert!(r.issues.is_empty(), "{:?}", r.issues);
        let names: Vec<_> = r.parts.iter().map(|p| p.file.as_str()).collect();
        assert_eq!(names, ["a.dbmlx", "sub/b.dbmlx", "sub/c.dbmlx"]);
        assert!(r.parts.iter().all(|p| p.line == 2));
    }

    #[test]
    fn circular_e_repetido_valem_uma_vez() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.dbmlx", "!include \"b.dbmlx\"\n");
        write(dir.path(), "b.dbmlx", "!include \"a.dbmlx\"\nTable b { id int }\n");
        let r = resolve(Some(dir.path()), "!include \"a.dbmlx\"\n!include \"b.dbmlx\"\n!include \"a.dbmlx\"\n");
        assert!(r.issues.is_empty(), "{:?}", r.issues);
        assert_eq!(r.parts.len(), 2);
    }

    #[test]
    fn recusa_o_que_nao_e_seguro() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "segredo.json", "{}");
        let abs = if cfg!(windows) { "C:/x/y.dbmlx" } else { "/etc/y.dbmlx" };
        let t = format!("!include \"{abs}\"\n!include \"segredo.json\"\n!include \"http://x/y.dbmlx\"\n!include \"falta.dbmlx\"\n!include \"\"\n");
        let r = resolve(Some(dir.path()), &t);
        assert!(r.parts.is_empty());
        assert_eq!(r.issues.len(), 5, "{:?}", r.issues);
        assert!(r.issues[3].message.contains("não encontrado"));
        assert_eq!(r.issues[3].line, 4);
    }

    #[test]
    fn sem_pasta_nao_resolve() {
        let r = resolve(None, "!include \"a.dbmlx\"\n");
        assert!(r.parts.is_empty());
        assert_eq!(r.issues.len(), 1);
        assert!(resolve(None, "Table t { id int }").issues.is_empty());
    }

    #[test]
    fn arquivo_grande_demais_e_recusado() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "g.dbmlx", &"a".repeat(MAX_FILE_BYTES as usize + 1));
        let r = resolve(Some(dir.path()), "!include \"g.dbmlx\"\n");
        assert!(r.parts.is_empty());
        assert!(r.issues[0].message.contains("grande demais"));
    }

    #[test]
    fn caminho_do_include_e_contexto_da_raiz() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "raiz.dbmlx", "!include \"a.dbmlx\"\n!include \"b.dbmlx\"\nRef: a.id > b.a_id\n");
        write(dir.path(), "a.dbmlx", "Table a { id int }\n");
        write(dir.path(), "b.dbmlx", "Table b { a_id int }\n");
        let p = include_path(dir.path(), "a.dbmlx").unwrap();
        assert!(p.ends_with("a.dbmlx"));
        assert!(include_path(dir.path(), "falta.dbmlx").is_err());
        assert!(include_path(dir.path(), "/etc/passwd.dbmlx").is_err());
        // módulo `a` aberto sozinho: o contexto é a raiz e o `b`, sem o próprio `a`
        let r = resolve_root(&dir.path().join("raiz.dbmlx"), None, Some(&p));
        let names: Vec<_> = r.parts.iter().map(|x| x.file.as_str()).collect();
        assert_eq!(names, ["raiz.dbmlx", "b.dbmlx"]);
        assert!(r.parts.iter().all(|x| x.context));
        // o texto da aba da raiz (com alterações não salvas) vale mais que o do disco
        let r2 = resolve_root(&dir.path().join("raiz.dbmlx"), Some("Table nova { id int }"), Some(&p));
        assert_eq!(r2.parts.len(), 1);
        assert!(r2.parts[0].text.contains("nova"));
        // raiz que não existe ou de extensão não aceita: nada
        assert!(resolve_root(&dir.path().join("x.dbmlx"), None, None).parts.is_empty());
    }

    #[test]
    fn bom_e_removido() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.dbmlx"), b"\xEF\xBB\xBFTable a { id int }").unwrap();
        let r = resolve(Some(dir.path()), "!include \"a.dbmlx\"");
        assert_eq!(r.parts[0].text, "Table a { id int }");
    }
}
