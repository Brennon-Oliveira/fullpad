//! Leitor de EPUB (só leitura): ZIP → `container.xml` → `content.opf` → sumário, e os capítulos
//! limpos para a UI. Tudo aqui é entrada não confiável, então:
//!
//! - o ZIP **nunca é extraído**: só se procura uma entrada pelo nome, depois de normalizar o
//!   caminho (nada de `..` que saia da raiz, nada de esquema, nada de caminho absoluto de disco);
//! - cada leitura tem teto de tamanho (conta os bytes realmente lidos, não o cabeçalho do ZIP) e há
//!   teto de entradas, contra bombas de compressão;
//! - o XML é lido pelo `quick-xml`, que **não resolve entidades nem DTD**: "billion laughs" e
//!   entidades externas (`SYSTEM "file:///…"`) não fazem nada, ficam como texto literal;
//! - o XHTML do capítulo passa pelo `ammonia` (lista de permissão, sem scripts, eventos, `iframe`,
//!   `form`…); imagens viram `data:` lidas do próprio ZIP; links só `http`/`https`/`mailto` ou para
//!   outro capítulo do livro; o CSS passa por `css::sanitize`.
//!
//! Fora do escopo por enquanto: DRM, fixed-layout, fontes e imagens de fundo do livro, SVG inline.

use crate::css;
use crate::error::{Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::Serialize;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use zip::ZipArchive;

/// Entradas no ZIP (acima disso o livro é recusado: um EPUB de verdade tem algumas centenas).
pub const MAX_ENTRIES: usize = 20_000;
/// `container.xml`, `.opf`, sumário.
const MAX_XML: u64 = 4 * 1024 * 1024;
/// XHTML de um capítulo.
const MAX_CHAPTER: u64 = 8 * 1024 * 1024;
/// Uma imagem, e todas as imagens de um capítulo juntas.
const MAX_IMAGE: u64 = 8 * 1024 * 1024;
const MAX_CHAPTER_IMAGES: u64 = 24 * 1024 * 1024;
/// Uma folha de estilo, e o CSS de um capítulo inteiro.
const MAX_CSS: u64 = 1024 * 1024;
const MAX_CSS_TOTAL: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TocEntry {
    pub label: String,
    /// Capítulo (posição na ordem de leitura) para onde aponta; `None` se não é um capítulo do livro.
    pub spine: Option<usize>,
    pub fragment: Option<String>,
    pub depth: u8,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct EpubInfo {
    pub title: String,
    pub author: Option<String>,
    /// Título de cada capítulo, na ordem de leitura.
    pub chapters: Vec<String>,
    pub toc: Vec<TocEntry>,
}

/// Um capítulo pronto para a UI: HTML já limpo e CSS já filtrado.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Chapter {
    pub html: String,
    pub css: String,
}

#[derive(Debug, Clone)]
struct SpineItem {
    path: String,
    media_type: String,
}

/// Livro aberto: só o que veio dos metadados (ordem de leitura, sumário). Os capítulos são lidos
/// do ZIP um a um, quando pedidos.
#[derive(Debug, Clone)]
pub struct Epub {
    path: PathBuf,
    info: EpubInfo,
    spine: Vec<SpineItem>,
    index_by_path: Arc<HashMap<String, usize>>,
}

fn invalid(msg: impl Into<String>) -> Error {
    Error::Invalid(msg.into())
}

fn bad_zip<E>(_: E) -> Error {
    invalid("O arquivo não é um EPUB válido (ZIP corrompido ou incompleto).")
}

impl Epub {
    pub fn open(path: &Path) -> Result<Epub> {
        let mut zip = open_zip(path)?;
        check_encryption(&mut zip)?;

        let container = read_text(&mut zip, "META-INF/container.xml", MAX_XML).map_err(|_| invalid("O EPUB não tem META-INF/container.xml."))?;
        let opf_path = parse_container(&container).ok_or_else(|| invalid("O EPUB não indica onde está o livro (container.xml sem rootfile)."))?;
        let opf_path = normalize(&opf_path).ok_or_else(|| invalid("Caminho inválido para o pacote do EPUB."))?;
        let opf = read_text(&mut zip, &opf_path, MAX_XML).map_err(|_| invalid("O EPUB não tem o arquivo do pacote (.opf)."))?;
        let pkg = parse_opf(&opf);
        let opf_dir = dir_of(&opf_path).to_string();

        let mut spine = Vec::new();
        for idref in &pkg.spine {
            let Some(item) = pkg.manifest.get(idref) else { continue };
            let Some((path, _)) = resolve(&opf_dir, &item.href) else { continue };
            spine.push(SpineItem { path, media_type: item.media_type.clone() });
        }
        if spine.is_empty() {
            return Err(invalid("O EPUB não tem conteúdo para ler (ordem de leitura vazia)."));
        }
        let index_by_path: HashMap<String, usize> = spine.iter().enumerate().map(|(i, s)| (s.path.clone(), i)).collect();

        // sumário: o `nav` do EPUB 3, ou o NCX do EPUB 2; sem nenhum dos dois, só os capítulos
        let nav = pkg.manifest.values().find(|i| i.properties.split_whitespace().any(|p| p == "nav"));
        let ncx = pkg.manifest.get(pkg.ncx_id.as_deref().unwrap_or("")).or_else(|| pkg.manifest.values().find(|i| i.media_type == "application/x-dtbncx+xml"));
        let raw_toc = if let Some(nav) = nav {
            read_toc(&mut zip, &opf_dir, &nav.href, parse_nav)
        } else if let Some(ncx) = ncx {
            read_toc(&mut zip, &opf_dir, &ncx.href, parse_ncx)
        } else {
            Vec::new()
        };
        let toc: Vec<TocEntry> = raw_toc
            .into_iter()
            .map(|(label, target, depth)| {
                let spine = target.as_ref().and_then(|(p, _)| index_by_path.get(p)).copied();
                TocEntry { label, spine, fragment: target.and_then(|(_, f)| f), depth }
            })
            .collect();

        let chapters: Vec<String> = (0..spine.len())
            .map(|i| toc.iter().find(|t| t.spine == Some(i) && !t.label.is_empty()).map_or_else(|| format!("Seção {}", i + 1), |t| t.label.clone()))
            .collect();
        let title = if pkg.title.trim().is_empty() { path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default() } else { collapse(&pkg.title) };
        let author = Some(collapse(&pkg.author)).filter(|a| !a.is_empty());

        Ok(Epub { path: path.to_path_buf(), info: EpubInfo { title, author, chapters, toc }, spine, index_by_path: Arc::new(index_by_path) })
    }

    pub fn info(&self) -> &EpubInfo {
        &self.info
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Lê e limpa o capítulo `index` (posição na ordem de leitura).
    pub fn chapter(&self, index: usize) -> Result<Chapter> {
        let item = self.spine.get(index).ok_or_else(|| invalid("Capítulo inexistente."))?;
        let mut zip = open_zip(&self.path)?;
        let dir = dir_of(&item.path).to_string();

        if item.media_type.starts_with("image/") {
            // capítulo que é só uma imagem (capa, página escaneada)
            let mut budget = MAX_CHAPTER_IMAGES;
            let html = match read_image(&mut zip, &item.path, &mut budget) {
                Some(uri) => format!("<p><img src=\"{uri}\" alt=\"\"></p>"),
                None => "<p>Imagem não disponível.</p>".to_string(),
            };
            return Ok(Chapter { html, css: String::new() });
        }
        if !(item.media_type.contains("html") || item.media_type.contains("xml")) {
            return Ok(Chapter { html: "<p>Este tipo de conteúdo não é suportado.</p>".into(), css: String::new() });
        }

        let raw = read_entry(&mut zip, &item.path, MAX_CHAPTER)?;
        let text = crate::fileio::decode(&raw).text;

        // estilos: <link rel="stylesheet"> e <style>, ambos pelo filtro de CSS
        let mut css_all = String::new();
        let mut add_css = |css: &str| {
            if css_all.len() < MAX_CSS_TOTAL {
                css_all.push_str(&css::sanitize(css));
            }
        };
        for href in stylesheet_hrefs(&text) {
            if let Some((p, _)) = resolve(&dir, &href) {
                if let Ok(bytes) = read_entry(&mut zip, &p, MAX_CSS) {
                    add_css(&crate::fileio::decode(&bytes).text);
                }
            }
        }
        for block in style_blocks(&text) {
            add_css(block);
        }
        css_all.truncate(MAX_CSS_TOTAL);

        let body = extract_body(&text);

        // imagens: primeiro descobre quais o capítulo cita, lê do ZIP e depois reescreve
        let srcs = collect_img_srcs(body);
        let mut images: HashMap<String, String> = HashMap::new();
        let mut budget = MAX_CHAPTER_IMAGES;
        for src in srcs {
            if images.contains_key(&src) {
                continue;
            }
            if let Some((p, _)) = resolve(&dir, &src) {
                if let Some(uri) = read_image(&mut zip, &p, &mut budget) {
                    images.insert(src, uri);
                }
            }
        }
        let html = sanitize_html(body, Arc::new(images), self.index_by_path.clone(), dir);
        Ok(Chapter { html, css: css_all })
    }
}

// ---- ZIP ------------------------------------------------------------------------------------

fn open_zip(path: &Path) -> Result<ZipArchive<File>> {
    let file = File::open(path).map_err(|source| Error::Io { path: path.to_path_buf(), source })?;
    let zip = ZipArchive::new(file).map_err(bad_zip)?;
    if zip.len() > MAX_ENTRIES {
        return Err(invalid(format!("O EPUB tem arquivos demais ({}; o limite é {MAX_ENTRIES}).", zip.len())));
    }
    Ok(zip)
}

/// O nome da entrada: exato, ou sem diferenciar maiúsculas (livros mal feitos).
fn entry_name(zip: &ZipArchive<File>, name: &str) -> Option<String> {
    if zip.index_for_name(name).is_some() {
        return Some(name.to_string());
    }
    zip.file_names().filter_map(|n| n.ok()).find(|n| n.eq_ignore_ascii_case(name)).map(Cow::into_owned)
}

/// Lê uma entrada com teto. O teto vale para o que de fato foi descomprimido: um cabeçalho que
/// mente sobre o tamanho não ajuda.
fn read_entry(zip: &mut ZipArchive<File>, name: &str, cap: u64) -> Result<Vec<u8>> {
    let real = entry_name(zip, name).ok_or_else(|| invalid(format!("Arquivo ausente no EPUB: {name}")))?;
    let f = zip.by_name(&real).map_err(bad_zip)?;
    if f.size() > cap {
        return Err(invalid(format!("Um arquivo do EPUB é grande demais ({} MB; o limite é {} MB).", f.size() >> 20, cap >> 20)));
    }
    let mut buf = Vec::new();
    f.take(cap + 1).read_to_end(&mut buf).map_err(bad_zip)?;
    if buf.len() as u64 > cap {
        return Err(invalid("Um arquivo do EPUB expande além do limite (possível bomba de compressão)."));
    }
    Ok(buf)
}

fn read_text(zip: &mut ZipArchive<File>, name: &str, cap: u64) -> Result<String> {
    Ok(crate::fileio::decode(&read_entry(zip, name, cap)?).text)
}

/// EPUB com DRM não é lido. A ofuscação de fontes (IDPF e Adobe) não conta: ela só mexe nas fontes.
fn check_encryption(zip: &mut ZipArchive<File>) -> Result<()> {
    let Some(name) = entry_name(zip, "META-INF/encryption.xml") else { return Ok(()) };
    let xml = read_text(zip, &name, MAX_XML)?;
    let mut r = Reader::from_str(&xml);
    while let Ok(ev) = r.read_event() {
        match ev {
            Event::Start(e) | Event::Empty(e) if local(&e) == "EncryptionMethod" => {
                let alg = attr(&e, "Algorithm").unwrap_or_default();
                if alg != "http://www.idpf.org/2008/embedding" && alg != "http://ns.adobe.com/pdf/enc#RC" {
                    return Err(invalid("Este EPUB tem proteção (DRM) e não pode ser aberto."));
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(())
}

// ---- caminhos -------------------------------------------------------------------------------

fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

fn has_scheme(s: &str) -> bool {
    match s.find(':') {
        Some(i) if i >= 2 => s[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) && s.as_bytes()[0].is_ascii_alphabetic(),
        _ => false,
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Caminho limpo dentro do ZIP: sem `.`/`..`, sem barra no começo, e `None` se tenta sair da raiz.
fn normalize(path: &str) -> Option<String> {
    let mut segs: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                segs.pop()?;
            }
            s if s.chars().any(|c| c.is_control()) => return None,
            s => segs.push(s),
        }
    }
    (!segs.is_empty()).then(|| segs.join("/"))
}

/// Resolve `href` (relativo à pasta `base_dir`, dentro do ZIP) e separa o fragmento. `None` para
/// esquemas (`http:`, `file:`…), caminho vazio ou que saia da raiz do livro.
fn resolve(base_dir: &str, href: &str) -> Option<(String, Option<String>)> {
    let href = href.trim();
    let (path, frag) = match href.split_once('#') {
        Some((p, f)) => (p, Some(f.to_string()).filter(|f| !f.is_empty())),
        None => (href, None),
    };
    let path = path.split('?').next().unwrap_or("");
    if path.is_empty() || has_scheme(path) {
        return None;
    }
    let decoded = percent_decode(path).replace('\\', "/");
    let joined = if decoded.starts_with('/') || base_dir.is_empty() { decoded } else { format!("{base_dir}/{decoded}") };
    Some((normalize(&joined)?, frag))
}

// ---- XML ------------------------------------------------------------------------------------

fn local(e: &BytesStart) -> String {
    String::from_utf8_lossy(e.local_name().as_ref()).into_owned()
}

/// Valor de um atributo (pelo nome local ou completo). Entidade desconhecida fica como veio.
fn attr(e: &BytesStart, name: &str) -> Option<String> {
    e.attributes().flatten().find_map(|a| {
        let local = String::from_utf8_lossy(a.key.local_name().as_ref()).into_owned();
        let full = String::from_utf8_lossy(a.key.as_ref()).into_owned();
        (local == name || full == name).then(|| a.unescape_value().map(Cow::into_owned).unwrap_or_else(|_| String::from_utf8_lossy(&a.value).into_owned()))
    })
}

fn text_of(t: &quick_xml::events::BytesText) -> String {
    t.unescape().map(Cow::into_owned).unwrap_or_else(|_| String::from_utf8_lossy(t).into_owned())
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn reader(xml: &str) -> Reader<&[u8]> {
    let mut r = Reader::from_str(xml);
    r.config_mut().check_end_names = false; // tolerante a XML meio quebrado
    r
}

fn parse_container(xml: &str) -> Option<String> {
    let mut r = reader(xml);
    loop {
        match r.read_event() {
            Ok(Event::Start(e) | Event::Empty(e)) if local(&e) == "rootfile" => {
                if let Some(p) = attr(&e, "full-path") {
                    return Some(p);
                }
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
    }
}

#[derive(Default)]
struct ManifestItem {
    href: String,
    media_type: String,
    properties: String,
}

#[derive(Default)]
struct Package {
    title: String,
    author: String,
    manifest: HashMap<String, ManifestItem>,
    spine: Vec<String>,
    ncx_id: Option<String>,
}

fn parse_opf(xml: &str) -> Package {
    let mut pkg = Package::default();
    let mut r = reader(xml);
    let mut capture: Option<&'static str> = None;
    let mut seen_title = false;
    let mut seen_author = false;
    loop {
        match r.read_event() {
            Ok(Event::Start(e)) => match local(&e).as_str() {
                "title" if !seen_title => capture = Some("title"),
                "creator" if !seen_author => capture = Some("creator"),
                "item" => add_item(&mut pkg, &e),
                "itemref" => add_itemref(&mut pkg, &e),
                "spine" => pkg.ncx_id = attr(&e, "toc"),
                _ => {}
            },
            Ok(Event::Empty(e)) => match local(&e).as_str() {
                "item" => add_item(&mut pkg, &e),
                "itemref" => add_itemref(&mut pkg, &e),
                "spine" => pkg.ncx_id = attr(&e, "toc"),
                _ => {}
            },
            Ok(Event::Text(t)) => match capture {
                Some("title") => pkg.title.push_str(&text_of(&t)),
                Some("creator") => pkg.author.push_str(&text_of(&t)),
                _ => {}
            },
            Ok(Event::End(_)) => {
                match capture.take() {
                    Some("title") => seen_title = true,
                    Some("creator") => seen_author = true,
                    _ => {}
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    pkg
}

fn add_item(pkg: &mut Package, e: &BytesStart) {
    if let (Some(id), Some(href)) = (attr(e, "id"), attr(e, "href")) {
        pkg.manifest.insert(id, ManifestItem { href, media_type: attr(e, "media-type").unwrap_or_default(), properties: attr(e, "properties").unwrap_or_default() });
    }
}

fn add_itemref(pkg: &mut Package, e: &BytesStart) {
    if let Some(id) = attr(e, "idref") {
        pkg.spine.push(id);
    }
}

/// `(rótulo, destino resolvido, profundidade)` de cada entrada do sumário.
type RawToc = Vec<(String, Option<(String, Option<String>)>, u8)>;

fn read_toc(zip: &mut ZipArchive<File>, opf_dir: &str, href: &str, parse: fn(&str) -> Vec<(String, String, u8)>) -> RawToc {
    let Some((path, _)) = resolve(opf_dir, href) else { return Vec::new() };
    let Ok(xml) = read_text(zip, &path, MAX_XML) else { return Vec::new() };
    let dir = dir_of(&path).to_string();
    parse(&xml).into_iter().map(|(label, href, depth)| (label, resolve(&dir, &href), depth)).collect()
}

/// Sumário do EPUB 3: `<nav epub:type="toc"><ol><li><a href>…`.
fn parse_nav(xml: &str) -> Vec<(String, String, u8)> {
    struct Block {
        is_toc: bool,
        entries: Vec<(String, String, u8)>,
    }
    let mut blocks: Vec<Block> = Vec::new();
    let mut r = reader(xml);
    let (mut nav_level, mut ol, mut in_nav) = (0usize, 0i32, false);
    let (mut href, mut label): (Option<String>, String) = (None, String::new());
    loop {
        match r.read_event() {
            Ok(Event::Start(e)) => match local(&e).as_str() {
                "nav" => {
                    nav_level += 1;
                    if nav_level == 1 {
                        in_nav = true;
                        ol = 0;
                        blocks.push(Block { is_toc: attr(&e, "type").is_some_and(|t| t.split_whitespace().any(|w| w == "toc")), entries: Vec::new() });
                    }
                }
                "ol" if in_nav => ol += 1,
                "a" if in_nav => {
                    href = attr(&e, "href");
                    label.clear();
                }
                _ => {}
            },
            Ok(Event::Text(t)) if in_nav && href.is_some() => label.push_str(&text_of(&t)),
            Ok(Event::End(e)) => match String::from_utf8_lossy(e.local_name().as_ref()).as_ref() {
                "nav" => {
                    nav_level = nav_level.saturating_sub(1);
                    if nav_level == 0 {
                        in_nav = false;
                    }
                }
                "ol" if in_nav => ol -= 1,
                "a" if in_nav => {
                    if let (Some(h), Some(b)) = (href.take(), blocks.last_mut()) {
                        b.entries.push((collapse(&label), h, (ol - 1).clamp(0, 8) as u8));
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    let pick = blocks.iter().position(|b| b.is_toc).or(if blocks.is_empty() { None } else { Some(0) });
    pick.map(|i| blocks.swap_remove(i).entries).unwrap_or_default()
}

/// Sumário do EPUB 2 (NCX): `navMap > navPoint > navLabel/text + content@src`.
fn parse_ncx(xml: &str) -> Vec<(String, String, u8)> {
    let mut out = Vec::new();
    let mut r = reader(xml);
    let (mut depth, mut in_label, mut in_text) = (0i32, false, false);
    let mut label = String::new();
    loop {
        match r.read_event() {
            Ok(Event::Start(e)) => match local(&e).as_str() {
                "navPoint" => {
                    depth += 1;
                    label.clear();
                }
                "navLabel" => in_label = true,
                "text" if in_label => in_text = true,
                "content" => {
                    if let Some(src) = attr(&e, "src") {
                        out.push((collapse(&label), src, (depth - 1).clamp(0, 8) as u8));
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(e)) if local(&e) == "content" => {
                if let Some(src) = attr(&e, "src") {
                    out.push((collapse(&label), src, (depth - 1).clamp(0, 8) as u8));
                }
            }
            Ok(Event::Text(t)) if in_text => label.push_str(&text_of(&t)),
            Ok(Event::End(e)) => match String::from_utf8_lossy(e.local_name().as_ref()).as_ref() {
                "navPoint" => depth -= 1,
                "navLabel" => in_label = false,
                "text" => in_text = false,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

// ---- HTML do capítulo -----------------------------------------------------------------------

/// Atributos de uma tag (o texto entre `<nome` e `>`), com ou sem aspas.
fn tag_attrs(tag: &str) -> Vec<(String, String)> {
    let b = tag.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            i += 1;
        }
        let start = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' && b[i] != b'/' {
            i += 1;
        }
        let name = tag[start..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let mut value = String::new();
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i];
                i += 1;
                let s = i;
                while i < b.len() && b[i] != q {
                    i += 1;
                }
                value = tag[s..i].to_string();
                i += 1;
            } else {
                let s = i;
                while i < b.len() && !b[i].is_ascii_whitespace() {
                    i += 1;
                }
                value = tag[s..i].to_string();
            }
        }
        if !name.is_empty() {
            out.push((name, value));
        }
    }
    out
}

/// Fim (posição do `>`) da tag que começa em `from`, respeitando aspas.
fn tag_end(html: &str, from: usize) -> Option<usize> {
    let b = html.as_bytes();
    let mut quote = None;
    for (i, &c) in b.iter().enumerate().skip(from) {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == b'"' || c == b'\'' => quote = Some(c),
            None if c == b'>' => return Some(i),
            None => {}
        }
    }
    None
}

/// `href` de cada `<link rel="stylesheet">`.
fn stylesheet_hrefs(html: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = lower[at..].find("<link").map(|k| k + at) {
        let Some(end) = tag_end(html, i) else { break };
        let attrs = tag_attrs(&html[i + 5..end]);
        let get = |n: &str| attrs.iter().find(|(k, _)| k == n).map(|(_, v)| v.as_str());
        if get("rel").is_some_and(|r| r.to_ascii_lowercase().split_whitespace().any(|w| w == "stylesheet")) {
            if let Some(h) = get("href") {
                out.push(h.to_string());
            }
        }
        at = end + 1;
    }
    out
}

/// Texto de cada `<style>…</style>`.
fn style_blocks(html: &str) -> Vec<&str> {
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = lower[at..].find("<style").map(|k| k + at) {
        let Some(open_end) = tag_end(html, i) else { break };
        let close = lower[open_end..].find("</style").map_or(html.len(), |k| k + open_end);
        out.push(&html[open_end + 1..close]);
        at = close.max(open_end) + 1;
        if at >= html.len() {
            break;
        }
    }
    out
}

/// O miolo do `<body>` (ou, sem ele, o que vem depois do `</head>`): o `<head>` não vira texto.
fn extract_body(html: &str) -> &str {
    let lower = html.to_ascii_lowercase();
    if let Some(i) = lower.find("<body") {
        let start = tag_end(html, i).map_or(i, |e| e + 1);
        let end = lower.rfind("</body").filter(|&e| e >= start).unwrap_or(html.len());
        return &html[start..end];
    }
    match lower.find("</head>") {
        Some(i) => &html[i + 7..],
        None => html,
    }
}

fn builder() -> ammonia::Builder<'static> {
    let mut b = ammonia::Builder::default();
    b.link_rel(None)
        .url_schemes(HashSet::from(["http", "https", "mailto"]))
        .url_relative(ammonia::UrlRelative::PassThrough)
        .add_generic_attributes(["class", "id", "lang", "dir", "title"])
        .add_tag_attributes("img", ["width", "height"])
        .add_tag_attributes("ol", ["start", "type", "reversed"])
        .add_tag_attributes("li", ["value"]);
    b
}

/// Primeira passada: só descobre os `src` das imagens (para lê-las do ZIP antes de reescrever).
fn collect_img_srcs(body: &str) -> Vec<String> {
    let found = Arc::new(Mutex::new(Vec::new()));
    let sink = found.clone();
    builder()
        .attribute_filter(move |el, at, v| {
            if el == "img" && at == "src" {
                sink.lock().unwrap().push(v.to_string());
            }
            Some(Cow::Borrowed(v))
        })
        .clean(body);
    let v = found.lock().unwrap().clone();
    v
}

/// O que um link do capítulo vira: `#ancora` e `http`/`https`/`mailto` ficam; um link para outro
/// capítulo do livro vira `epub:<capítulo>[#fragmento]` (a UI o trata); o resto é removido.
fn rewrite_link<'a>(v: &'a str, dir: &str, index: &HashMap<String, usize>) -> Option<Cow<'a, str>> {
    let t = v.trim();
    if t.starts_with('#') {
        return Some(Cow::Borrowed(v));
    }
    if has_scheme(t) {
        let scheme = t.split(':').next().unwrap_or("").to_ascii_lowercase();
        return matches!(scheme.as_str(), "http" | "https" | "mailto").then_some(Cow::Borrowed(v));
    }
    let (path, frag) = resolve(dir, t)?;
    let idx = index.get(&path)?;
    Some(Cow::Owned(match frag {
        Some(f) => format!("epub:{idx}#{f}"),
        None => format!("epub:{idx}"),
    }))
}

/// Segunda passada: o HTML final. Imagens só como `data:` do próprio livro; links como acima.
fn sanitize_html(body: &str, images: Arc<HashMap<String, String>>, index: Arc<HashMap<String, usize>>, dir: String) -> String {
    builder()
        .attribute_filter(move |el, at, v| match (el, at) {
            ("img", "src") => images.get(v).map(|d| Cow::Owned(d.clone())),
            ("a", "href") => rewrite_link(v, &dir, &index),
            _ => Some(Cow::Borrowed(v)),
        })
        .clean(body)
        .to_string()
}

fn image_mime(path: &str) -> Option<&'static str> {
    match path.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// Imagem do ZIP como `data:` URI (só tipos de imagem, com teto por imagem e por capítulo).
fn read_image(zip: &mut ZipArchive<File>, path: &str, budget: &mut u64) -> Option<String> {
    let mime = image_mime(path)?;
    let cap = MAX_IMAGE.min(*budget);
    if cap == 0 {
        return None;
    }
    let bytes = read_entry(zip, path, cap).ok()?;
    *budget -= bytes.len() as u64;
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::CompressionMethod::{Deflated, Stored};

    const CONTAINER: &str = r#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#;

    fn xhtml(head: &str, body: &str) -> String {
        format!(r#"<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Título do capítulo</title>{head}</head><body>{body}</body></html>"#)
    }

    fn opf(items: &str, spine: &str, extra: &str) -> String {
        format!(r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>Livro &amp; Teste</dc:title><dc:creator>Autora Exemplo</dc:creator><dc:language>pt-BR</dc:language></metadata><manifest>{items}</manifest><spine {extra}>{spine}</spine></package>"#)
    }

    /// Monta um EPUB em disco. `files`: (nome no zip, conteúdo).
    fn book(files: &[(&str, Vec<u8>)]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("livro.epub");
        let mut z = zip::ZipWriter::new(File::create(&path).unwrap());
        z.start_file("mimetype", SimpleFileOptions::default().compression_method(Stored)).unwrap();
        z.write_all(b"application/epub+zip").unwrap();
        for (name, data) in files {
            z.start_file(*name, SimpleFileOptions::default().compression_method(Deflated)).unwrap();
            z.write_all(data).unwrap();
        }
        z.finish().unwrap();
        (dir, path)
    }

    fn png() -> Vec<u8> {
        // PNG 1x1 válido
        vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, b'I', b'H', b'D', b'R', 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    }

    fn nav(entries: &str) -> String {
        xhtml("", &format!(r#"<nav epub:type="toc"><ol>{entries}</ol></nav>"#))
    }

    /// Livro de 2 capítulos com sumário (EPUB 3), imagem, CSS e links.
    fn good_book() -> (tempfile::TempDir, PathBuf) {
        let items = r#"<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="cap1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="texto/cap 2.xhtml" media-type="application/xhtml+xml"/><item id="css" href="estilo.css" media-type="text/css"/><item id="img" href="img/azul.png" media-type="image/png"/>"#;
        let ch1 = xhtml(
            r#"<link rel="stylesheet" href="estilo.css"/><style>.x { color: red; position: fixed }</style>"#,
            r##"<h1 id="topo">Capítulo um</h1><p class="x">Texto com acentuação: ação, coração.</p><p><img src="img/azul.png" alt="azul"/></p><p><a href="texto/cap%202.xhtml#fim">próximo</a> <a href="#topo">topo</a> <a href="https://example.com/x">externo</a></p>"##,
        );
        let ch2 = xhtml("", r#"<h1>Capítulo dois</h1><p id="fim">Fim.</p><p><a href="../cap1.xhtml">volta</a></p>"#);
        book(&[
            ("META-INF/container.xml", CONTAINER.as_bytes().to_vec()),
            ("OEBPS/content.opf", opf(items, r#"<itemref idref="c1"/><itemref idref="c2"/>"#, "").into_bytes()),
            ("OEBPS/nav.xhtml", nav(r##"<li><a href="cap1.xhtml">Um</a><ol><li><a href="cap1.xhtml#topo">Seção do um</a></li></ol></li><li><a href="texto/cap%202.xhtml">Dois</a></li>"##).into_bytes()),
            ("OEBPS/cap1.xhtml", ch1.into_bytes()),
            ("OEBPS/texto/cap 2.xhtml", ch2.into_bytes()),
            ("OEBPS/estilo.css", b"h1 { color: #036; text-align: center } @import url(http://example.invalid/x.css); body { background: url(http://example.invalid/b.png) }".to_vec()),
            ("OEBPS/img/azul.png", png()),
        ])
    }

    #[test]
    fn opens_a_good_book() {
        let (_d, p) = good_book();
        let epub = Epub::open(&p).unwrap();
        let info = epub.info();
        assert_eq!(info.title, "Livro & Teste");
        assert_eq!(info.author.as_deref(), Some("Autora Exemplo"));
        assert_eq!(info.chapters, vec!["Um", "Dois"]);
        assert_eq!(
            info.toc,
            vec![
                TocEntry { label: "Um".into(), spine: Some(0), fragment: None, depth: 0 },
                TocEntry { label: "Seção do um".into(), spine: Some(0), fragment: Some("topo".into()), depth: 1 },
                TocEntry { label: "Dois".into(), spine: Some(1), fragment: None, depth: 0 },
            ]
        );
    }

    #[test]
    fn chapter_has_text_image_links_and_filtered_css() {
        let (_d, p) = good_book();
        let epub = Epub::open(&p).unwrap();
        let c = epub.chapter(0).unwrap();
        assert!(c.html.contains("Texto com acentuação: ação, coração."), "{}", c.html);
        assert!(c.html.contains("src=\"data:image/png;base64,"), "imagem do ZIP vira data:");
        assert!(c.html.contains("href=\"epub:1#fim\""), "link para outro capítulo (com %20 no nome): {}", c.html);
        assert!(c.html.contains("href=\"#topo\""));
        assert!(c.html.contains("href=\"https://example.com/x\""));
        assert!(!c.html.contains("<title") && !c.html.contains("Título do capítulo"), "o <head> não vira texto");
        assert_eq!(c.css, "h1{color:#036;text-align:center;}\n.x{color:red;}\n", "folha do livro primeiro, depois o <style>; sem o @import, o url() nem o position");
        let back = epub.chapter(1).unwrap();
        assert!(back.html.contains("href=\"epub:0\""), "{}", back.html);
        assert!(epub.chapter(2).is_err());
    }

    #[test]
    fn book_without_toc_names_chapters_by_position() {
        let items = r#"<item id="c1" href="a.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="b.xhtml" media-type="application/xhtml+xml"/>"#;
        let (_d, p) = book(&[
            ("META-INF/container.xml", CONTAINER.as_bytes().to_vec()),
            ("OEBPS/content.opf", opf(items, r#"<itemref idref="c1"/><itemref idref="c2"/>"#, "").into_bytes()),
            ("OEBPS/a.xhtml", xhtml("", "<p>A</p>").into_bytes()),
            ("OEBPS/b.xhtml", xhtml("", "<p>B</p>").into_bytes()),
        ]);
        let epub = Epub::open(&p).unwrap();
        assert_eq!(epub.info().chapters, vec!["Seção 1", "Seção 2"]);
        assert!(epub.info().toc.is_empty());
        assert!(epub.chapter(1).unwrap().html.contains("<p>B</p>"));
    }

    #[test]
    fn epub2_ncx_toc() {
        let items = r#"<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="a.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="b.xhtml" media-type="application/xhtml+xml"/>"#;
        let ncx = r#"<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="1"><navLabel><text>Primeiro</text></navLabel><content src="a.xhtml"/><navPoint id="2"><navLabel><text>Sub  um</text></navLabel><content src="a.xhtml#s"/></navPoint></navPoint><navPoint id="3"><navLabel><text>Segundo</text></navLabel><content src="b.xhtml"/></navPoint></navMap></ncx>"#;
        let (_d, p) = book(&[
            ("META-INF/container.xml", CONTAINER.as_bytes().to_vec()),
            ("OEBPS/content.opf", opf(items, r#"<itemref idref="c1"/><itemref idref="c2"/>"#, r#"toc="ncx""#).into_bytes()),
            ("OEBPS/toc.ncx", ncx.as_bytes().to_vec()),
            ("OEBPS/a.xhtml", xhtml("", "<p>A</p>").into_bytes()),
            ("OEBPS/b.xhtml", xhtml("", "<p>B</p>").into_bytes()),
        ]);
        let info = Epub::open(&p).unwrap().info().clone();
        assert_eq!(info.chapters, vec!["Primeiro", "Segundo"]);
        assert_eq!(info.toc.iter().map(|t| (t.label.as_str(), t.depth, t.spine)).collect::<Vec<_>>(), vec![("Primeiro", 0, Some(0)), ("Sub um", 1, Some(0)), ("Segundo", 0, Some(1))]);
        assert_eq!(info.toc[1].fragment.as_deref(), Some("s"));
    }

    // ---- entrada maliciosa ----------------------------------------------------------------

    const EVIL_BODY: &str = r##"
<h1>Capítulo com ataques</h1><p>Texto que sobrevive.</p>
<script>alert('XSS 1')</script>
<img src="x" onerror="alert('XSS 2')"/>
<p onclick="alert('XSS 3')" onmouseover="alert(4)" style="position:fixed">Parágrafo</p>
<a href="javascript:alert('XSS 4')">link js</a> <a href="file:///etc/passwd">link file</a> <a href="data:text/html,x">link data</a>
<iframe src="javascript:alert(5)"></iframe><iframe src="http://example.invalid/f"></iframe>
<object data="http://example.invalid/x.swf"></object><embed src="http://example.invalid/x"/>
<form action="http://example.invalid/post"><input name="a"/><button>enviar</button></form>
<img src="http://example.invalid/pixel.png" alt="rastreio"/><img src="../../../../etc/passwd" alt="traversal"/><img src="file:///etc/passwd"/>
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(6)"><script>alert(7)</script></svg>
<div style="background:url(http://example.invalid/bg.png)">fundo</div><div style="width:expression(alert(8))">expr</div>
<meta http-equiv="refresh" content="0;url=http://example.invalid/r"/><base href="http://example.invalid/"/><link rel="stylesheet" href="http://example.invalid/r.css"/>
<p>Fim do capítulo.</p>"##;

    fn evil_book() -> (tempfile::TempDir, PathBuf) {
        let items = r#"<item id="c1" href="cap1.xhtml" media-type="application/xhtml+xml"/><item id="css" href="e.css" media-type="text/css"/>"#;
        let head = r#"<base href="http://example.invalid/"/><meta http-equiv="refresh" content="0;url=http://example.invalid/redir"/><link rel="stylesheet" href="http://example.invalid/remoto.css"/><link rel="stylesheet" href="e.css"/><style>@import url(http://example.invalid/i.css); p { color: green }</style><script>alert('no head')</script>"#;
        book(&[
            ("META-INF/container.xml", CONTAINER.as_bytes().to_vec()),
            ("OEBPS/content.opf", opf(items, r#"<itemref idref="c1"/>"#, "").into_bytes()),
            ("OEBPS/cap1.xhtml", xhtml(head, EVIL_BODY).into_bytes()),
            ("OEBPS/e.css", b"@import url(http://example.invalid/a.css); body { background: url(http://example.invalid/b.png); color: #111 } .cobre { position: fixed; inset: 0; background: #f00; z-index: 2147483647 } * { behavior: url(x.htc); -moz-binding: url(http://example.invalid/x.xml#x) } @font-face { font-family: x; src: url(http://example.invalid/f.woff) }".to_vec()),
        ])
    }

    #[test]
    fn a_malicious_chapter_comes_out_clean() {
        let (_d, p) = evil_book();
        let c = Epub::open(&p).unwrap().chapter(0).unwrap();
        let html = c.html.to_ascii_lowercase();
        for bad in ["<script", "alert(", "onerror", "onclick", "onmouseover", "onload", "javascript:", "file:", "data:text", "<iframe", "<object", "<embed", "<form", "<input", "<button", "<svg", "<base", "<meta", "<link", "<style", "example.invalid", "etc/passwd", "position", "url(", "expression", "style="] {
            assert!(!html.contains(bad), "a saída ainda tem {bad:?}:\n{}", c.html);
        }
        assert!(c.html.contains("Texto que sobrevive.") && c.html.contains("Fim do capítulo."), "o texto do livro sobrevive");
        // o CSS: só o que é seguro
        let css = c.css.to_ascii_lowercase();
        for bad in ["@import", "url(", "position", "behavior", "-moz-binding", "@font-face", "expression", "z-index", "example.invalid"] {
            assert!(!css.contains(bad), "o CSS ainda tem {bad:?}: {}", c.css);
        }
        assert!(c.css.contains("color:#111") && c.css.contains("color:green"), "{}", c.css);
        // as imagens remotas ou fora do livro não viraram nada
        assert!(!c.html.contains("src="), "nenhuma imagem do chapter sobrou (nenhuma existe no ZIP): {}", c.html);
    }

    #[test]
    fn zip_bomb_entry_is_refused_without_loading_it() {
        // um capítulo de 40 MiB de espaços (cabe em poucos KB comprimido)
        let mut huge = b"<html><body><p>".to_vec();
        huge.extend(std::iter::repeat(b' ').take(40 << 20));
        huge.extend(b"</p></body></html>");
        let items = r#"<item id="c1" href="a.xhtml" media-type="application/xhtml+xml"/>"#;
        let (_d, p) = book(&[
            ("META-INF/container.xml", CONTAINER.as_bytes().to_vec()),
            ("OEBPS/content.opf", opf(items, r#"<itemref idref="c1"/>"#, "").into_bytes()),
            ("OEBPS/a.xhtml", huge),
        ]);
        assert!(std::fs::metadata(&p).unwrap().len() < 300_000, "o arquivo é pequeno");
        let epub = Epub::open(&p).unwrap(); // abrir não lê o capítulo
        let err = epub.chapter(0).unwrap_err().to_string();
        assert!(err.contains("grande demais"), "{err}");
    }

    #[test]
    fn too_many_entries_is_refused_on_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("muitos.epub");
        let mut z = zip::ZipWriter::new(File::create(&path).unwrap());
        for i in 0..=MAX_ENTRIES {
            z.start_file(format!("lixo/{i}.txt"), SimpleFileOptions::default().compression_method(Stored)).unwrap();
        }
        z.finish().unwrap();
        let err = Epub::open(&path).unwrap_err().to_string();
        assert!(err.contains("arquivos demais"), "{err}");
    }

    #[test]
    fn paths_that_escape_the_book_resolve_to_nothing() {
        assert_eq!(resolve("OEBPS", "../../fora.png"), None);
        assert_eq!(resolve("OEBPS", "../x/../../../y"), None);
        assert_eq!(resolve("", "../a"), None);
        assert_eq!(resolve("OEBPS", "http://example.invalid/a.png"), None);
        assert_eq!(resolve("OEBPS", "file:///etc/passwd"), None);
        assert_eq!(resolve("OEBPS", "javascript:alert(1)"), None);
        assert_eq!(resolve("OEBPS", ""), None);
        assert_eq!(resolve("OEBPS", "#so-fragmento"), None);
        assert_eq!(resolve("OEBPS/texto", "../img/a b.png#x"), Some(("OEBPS/img/a b.png".into(), Some("x".into()))));
        assert_eq!(resolve("OEBPS", "/abs/a.png"), Some(("abs/a.png".into(), None)), "barra no começo é a raiz do livro, nunca do disco");
        assert_eq!(resolve("OEBPS", "..\\x.png"), Some(("x.png".into(), None)));
        assert_eq!(resolve("OEBPS", "a%2e%2e/b%00c"), None, "caractere de controle");
    }

    #[test]
    fn dangerous_entry_names_are_never_extracted_or_followed() {
        let items = r#"<item id="c1" href="cap1.xhtml" media-type="application/xhtml+xml"/>"#;
        let ch = xhtml("", r#"<p><img src="../../fora.png"/><img src="/abs.png"/><img src="OEBPS/../../fora.png"/></p><p>texto</p>"#);
        let (d, p) = book(&[
            ("META-INF/container.xml", CONTAINER.as_bytes().to_vec()),
            ("OEBPS/content.opf", opf(items, r#"<itemref idref="c1"/>"#, "").into_bytes()),
            ("OEBPS/cap1.xhtml", ch.into_bytes()),
            ("../../fora.png", png()),
            ("/abs.png", png()),
        ]);
        let c = Epub::open(&p).unwrap().chapter(0).unwrap();
        assert!(!c.html.contains("src="), "{}", c.html);
        assert!(!d.path().join("fora.png").exists() && !d.path().parent().unwrap().join("fora.png").exists());
    }

    #[test]
    fn xml_entities_are_not_expanded() {
        // billion laughs no container, e entidade externa no .opf
        let mut ents = String::from("<!ENTITY a \"lollollollollollollollollollol\">\n");
        let mut prev = 'a';
        for n in "bcdefgh".chars() {
            ents.push_str(&format!("<!ENTITY {n} \"{}\">\n", format!("&{prev};").repeat(10)));
            prev = n;
        }
        let laughs = format!(r#"<?xml version="1.0"?><!DOCTYPE container [{ents}]><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" x="&h;" media-type="application/oebps-package+xml"/></rootfiles></container>"#);
        let items = r#"<item id="c1" href="a.xhtml" media-type="application/xhtml+xml"/>"#;
        let xxe_opf = opf(items, r#"<itemref idref="c1"/>"#, "").replace("<dc:language>", "<dc:description>&xxe;</dc:description><dc:language>").replace("<package", "<!DOCTYPE package [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><package");
        let (_d, p) = book(&[
            ("META-INF/container.xml", laughs.into_bytes()),
            ("OEBPS/content.opf", xxe_opf.into_bytes()),
            ("OEBPS/a.xhtml", xhtml("", "<p>ok</p>").into_bytes()),
        ]);
        let started = std::time::Instant::now();
        let epub = Epub::open(&p).unwrap();
        assert!(started.elapsed().as_secs() < 2, "sem expansão, é instantâneo");
        assert_eq!(epub.info().title, "Livro & Teste");
        assert!(!epub.info().title.contains("root:"), "a entidade externa não lê arquivo");
    }

    #[test]
    fn broken_files_give_clear_errors() {
        let d = tempfile::tempdir().unwrap();
        let (_g, good) = good_book();
        let bytes = std::fs::read(&good).unwrap();

        let trunc = d.path().join("truncado.epub");
        std::fs::write(&trunc, &bytes[..bytes.len() / 2]).unwrap();
        assert!(Epub::open(&trunc).unwrap_err().to_string().contains("não é um EPUB válido"));

        let junk = d.path().join("lixo.epub");
        std::fs::write(&junk, "isto nao e um zip").unwrap();
        assert!(Epub::open(&junk).unwrap_err().to_string().contains("não é um EPUB válido"));

        assert!(Epub::open(&d.path().join("nao-existe.epub")).is_err());

        let (_a, no_container) = book(&[("OEBPS/content.opf", b"x".to_vec())]);
        assert!(Epub::open(&no_container).unwrap_err().to_string().contains("container.xml"));

        let (_b, no_opf) = book(&[("META-INF/container.xml", CONTAINER.as_bytes().to_vec())]);
        assert!(Epub::open(&no_opf).unwrap_err().to_string().contains(".opf"));

        let (_c, empty_spine) = book(&[("META-INF/container.xml", CONTAINER.as_bytes().to_vec()), ("OEBPS/content.opf", opf("", "", "").into_bytes())]);
        assert!(Epub::open(&empty_spine).unwrap_err().to_string().contains("vazia"));
    }

    #[test]
    fn drm_is_refused_but_font_obfuscation_is_not() {
        let items = r#"<item id="c1" href="a.xhtml" media-type="application/xhtml+xml"/>"#;
        let base = |enc: &str| {
            book(&[
                ("META-INF/container.xml", CONTAINER.as_bytes().to_vec()),
                ("META-INF/encryption.xml", enc.as_bytes().to_vec()),
                ("OEBPS/content.opf", opf(items, r#"<itemref idref="c1"/>"#, "").into_bytes()),
                ("OEBPS/a.xhtml", xhtml("", "<p>x</p>").into_bytes()),
            ])
        };
        let fonts = r#"<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>"#;
        let (_a, p) = base(fonts);
        assert!(Epub::open(&p).is_ok());
        let drm = fonts.replace("http://www.idpf.org/2008/embedding", "http://www.w3.org/2001/04/xmlenc#aes128-cbc");
        let (_b, p) = base(&drm);
        assert!(Epub::open(&p).unwrap_err().to_string().contains("DRM"));
    }

    #[test]
    fn image_spine_item_and_unsupported_item() {
        let items = r#"<item id="cover" href="capa.png" media-type="image/png"/><item id="f" href="x.bin" media-type="application/octet-stream"/>"#;
        let (_d, p) = book(&[
            ("META-INF/container.xml", CONTAINER.as_bytes().to_vec()),
            ("OEBPS/content.opf", opf(items, r#"<itemref idref="cover"/><itemref idref="f"/>"#, "").into_bytes()),
            ("OEBPS/capa.png", png()),
            ("OEBPS/x.bin", vec![1, 2, 3]),
        ]);
        let epub = Epub::open(&p).unwrap();
        assert!(epub.chapter(0).unwrap().html.contains("data:image/png;base64,"));
        assert!(epub.chapter(1).unwrap().html.contains("não é suportado"));
    }

    #[test]
    fn chapter_images_have_a_total_budget() {
        // 4 imagens de 7 MB: só 3 cabem nos 24 MB do capítulo
        let big = {
            let mut v = png();
            v.extend(std::iter::repeat(0xAB).take(7 << 20));
            v
        };
        let items = r#"<item id="c1" href="a.xhtml" media-type="application/xhtml+xml"/>"#;
        let body: String = (0..4).map(|i| format!(r#"<img src="i{i}.png"/>"#)).collect();
        let mut files: Vec<(String, Vec<u8>)> = vec![("META-INF/container.xml".into(), CONTAINER.as_bytes().to_vec()), ("OEBPS/content.opf".into(), opf(items, r#"<itemref idref="c1"/>"#, "").into_bytes()), ("OEBPS/a.xhtml".into(), xhtml("", &body).into_bytes())];
        for i in 0..4 {
            files.push((format!("OEBPS/i{i}.png"), big.clone()));
        }
        let refs: Vec<(&str, Vec<u8>)> = files.iter().map(|(n, d)| (n.as_str(), d.clone())).collect();
        let (_d, p) = book(&refs);
        let html = Epub::open(&p).unwrap().chapter(0).unwrap().html;
        assert_eq!(html.matches("data:image/png").count(), 3, "o orçamento do capítulo corta a quarta");
    }

    #[test]
    fn entry_lookup_ignores_case_but_never_reads_outside_the_zip() {
        let items = r#"<item id="c1" href="CAP1.XHTML" media-type="application/xhtml+xml"/>"#;
        let (_d, p) = book(&[
            ("META-INF/container.xml", CONTAINER.as_bytes().to_vec()),
            ("OEBPS/content.opf", opf(items, r#"<itemref idref="c1"/>"#, "").into_bytes()),
            ("OEBPS/cap1.xhtml", xhtml("", "<p>achou</p>").into_bytes()),
        ]);
        assert!(Epub::open(&p).unwrap().chapter(0).unwrap().html.contains("achou"));
    }
}
