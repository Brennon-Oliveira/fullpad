use super::*;
use std::sync::atomic::AtomicBool;

/// Lotes de 3 linhas ou 64 bytes e segmentos de 16 bytes: divisas e linhas gigantes sem arquivo grande.
fn small() -> Limits {
    Limits { batch_lines: 3, batch_bytes: 64, segment_bytes: 16, max_edit_bytes: 4096 }
}

fn file(bytes: &[u8]) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("grande.log");
    std::fs::write(&p, bytes).unwrap();
    (dir, p)
}

fn open(path: &Path, limits: Limits) -> Arc<Large> {
    let l = Large::open(path, limits, None).unwrap();
    l.index_blocking();
    assert!(l.info().unwrap().done, "o índice deveria ter terminado: {:?}", l.info().unwrap().error);
    l
}

/// Tira do texto de exibição os `\n` virtuais (`breaks`, em UTF-16): sobra o texto do arquivo.
fn strip_virtual(text: &str, breaks: &[usize]) -> String {
    let mut out = String::new();
    let (mut u16, mut bi) = (0usize, 0usize);
    for ch in text.chars() {
        if bi < breaks.len() && breaks[bi] == u16 {
            assert_eq!(ch, '\n', "o corte virtual tem de cair num \\n");
            bi += 1;
        } else {
            out.push(ch);
        }
        u16 += ch.len_utf16();
    }
    assert_eq!(bi, breaks.len(), "todos os cortes virtuais têm de existir no texto");
    out
}

fn batches(l: &Large) -> Vec<BatchOut> {
    let n = l.info().unwrap().batches;
    (0..n).map(|i| l.read_batch(i).unwrap()).collect()
}

/// O arquivo inteiro como texto, lido lote a lote (sem os cortes virtuais).
fn whole(l: &Large) -> String {
    batches(l).iter().map(|b| strip_virtual(&b.text, &b.breaks)).collect()
}

/// O que o caminho normal (`fileio::decode`) acha do texto, menos a conversão de `\r` solto.
fn normalized(bytes: &[u8]) -> String {
    let d = crate::fileio::decode(bytes);
    d.text
}

fn assert_consistent(l: &Large, bytes: &[u8]) {
    let bs = batches(l);
    let total: u64 = bs.iter().map(|b| b.lines).sum::<u64>() + 1;
    assert_eq!(l.info().unwrap().lines, total);
    // linhas de cada lote somam, na ordem, o início do seguinte
    let mut acc = 0;
    for b in &bs {
        assert_eq!(b.start_line, acc);
        acc += b.lines;
        assert!(!b.lossy);
    }
    // o texto, sem cortes virtuais, é o do arquivo
    assert_eq!(whole(l), normalized(bytes));
    // cada linha cai no lote que a contém
    let display: String = bs.iter().map(|b| b.text.as_str()).collect();
    assert_eq!(display.matches('\n').count() as u64 + 1, total);
    for line in 0..total {
        let loc = l.locate(line).unwrap();
        let b = &bs[loc.batch];
        assert_eq!(loc.start_line, b.start_line);
        let last = loc.batch + 1 == bs.len();
        assert!(line >= b.start_line && (line < b.start_line + b.lines || last), "linha {line} no lote {}", loc.batch);
    }
}

// ---- elegibilidade -------------------------------------------------------------------

#[test]
fn probe_small_files_are_normal_without_reading_them() {
    let (_d, p) = file(b"oi\n");
    assert_eq!(probe(&p, LARGE_THRESHOLD).unwrap(), Probe::Normal);
    // mesmo com o limite no zero, um arquivo que não existe não quebra
    assert_eq!(probe(&p.with_file_name("nao-existe.log"), 0).unwrap(), Probe::Normal);
}

#[test]
fn probe_big_text_with_text_extension_is_large() {
    let (_d, p) = file(&vec![b'a'; 100]);
    assert!(matches!(probe(&p, 50).unwrap(), Probe::Large(_)));
    assert_eq!(probe(&p, 100).unwrap(), Probe::Normal, "no limite exato ainda é normal");
}

#[test]
fn probe_refuses_binary_unknown_extension_and_pdf() {
    let dir = tempfile::tempdir().unwrap();
    let mut bin = b"texto".to_vec();
    bin.push(0);
    bin.extend_from_slice(&[b'x'; 200]);
    let p = dir.path().join("a.log");
    std::fs::write(&p, &bin).unwrap();
    assert_eq!(probe(&p, 50).unwrap(), Probe::Normal, "NUL: binário");
    for name in ["a.bin", "a.exe", "a.zip", "a.pdf", "a.epub", "a.png"] {
        let p = dir.path().join(name);
        std::fs::write(&p, vec![b'a'; 200]).unwrap();
        assert_eq!(probe(&p, 50).unwrap(), Probe::Normal, "{name} não é texto reconhecido");
    }
}

#[test]
fn probe_accepts_extensionless_and_rotated_logs() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["messages", "app.log.1", "Makefile", "x.LOG", "y.Csv"] {
        let p = dir.path().join(name);
        std::fs::write(&p, vec![b'a'; 200]).unwrap();
        assert!(matches!(probe(&p, 50).unwrap(), Probe::Large(_)), "{name}");
    }
}

#[test]
fn probe_detects_utf16_and_does_not_open_it_as_large() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.txt");
    let mut b = vec![0xFF, 0xFE];
    b.extend(std::iter::repeat_n([b'a', 0], 200).flatten());
    std::fs::write(&p, &b).unwrap();
    assert_eq!(probe(&p, 50).unwrap(), Probe::Utf16 { size: b.len() as u64 });
    assert!(Large::open(&p, small(), None).is_err());
}

#[test]
fn probe_detects_encoding_and_eol_by_sample() {
    let dir = tempfile::tempdir().unwrap();
    let case = |name: &str, bytes: Vec<u8>| {
        let p = dir.path().join(name);
        std::fs::write(&p, bytes).unwrap();
        match probe(&p, 10).unwrap() {
            Probe::Large(s) => s,
            other => panic!("{name}: {other:?}"),
        }
    };
    let s = case("a.txt", "ação\r\nb\r\nc\r\n".repeat(5).into_bytes());
    assert_eq!((s.encoding, s.eol, s.bom), (Encoding::Utf8, Eol::Crlf, 0));
    let mut bom = vec![0xEF, 0xBB, 0xBF];
    bom.extend_from_slice("a\nb\nc\n".repeat(5).as_bytes());
    let s = case("b.txt", bom);
    assert_eq!((s.encoding, s.eol, s.bom), (Encoding::Utf8Bom, Eol::Lf, 3));
    let s = case("c.txt", [b"a\xE7\xE3o\n".as_slice(), b"abc\n".repeat(5).as_slice()].concat());
    assert_eq!((s.encoding, s.eol), (Encoding::Windows1252, Eol::Lf));
}

#[test]
fn a_multibyte_char_cut_by_the_sample_does_not_make_utf8_look_like_cp1252() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.txt");
    // "ã" (2 bytes) cai exatamente na fronteira da amostra de 64 KB
    let mut b = vec![b'a'; SAMPLE - 1];
    b.extend_from_slice("ã".as_bytes());
    b.extend_from_slice(&vec![b'b'; 100]);
    std::fs::write(&p, &b).unwrap();
    match probe(&p, 10).unwrap() {
        Probe::Large(s) => assert_eq!(s.encoding, Encoding::Utf8),
        other => panic!("{other:?}"),
    }
}

// ---- índice, lotes e linhas ----------------------------------------------------------

#[test]
fn simple_file_is_split_into_batches_of_three_lines() {
    let bytes = b"1\n2\n3\n4\n5\n6\n7\n";
    let (_d, p) = file(bytes);
    let l = open(&p, small());
    let info = l.info().unwrap();
    assert_eq!(info.batches, 3);
    assert_eq!(info.lines, 8, "7 quebras + a linha final vazia, como no CodeMirror");
    let bs = batches(&l);
    assert_eq!(bs[0].text, "1\n2\n3\n");
    assert_eq!(bs[1].text, "4\n5\n6\n");
    assert_eq!(bs[2].text, "7\n");
    assert_consistent(&l, bytes);
}

#[test]
fn the_byte_limit_closes_a_batch_before_the_line_limit() {
    // 5 linhas de 20 bytes: 64 bytes cabem 3 (60), a 4ª fecha o lote
    let line = format!("{}\n", "x".repeat(19));
    let bytes = line.repeat(5);
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, Limits { batch_lines: 100, segment_bytes: 32, ..small() });
    let bs = batches(&l);
    assert_eq!(bs.iter().map(|b| b.lines).collect::<Vec<_>>(), vec![3, 2]);
    assert_consistent(&l, bytes.as_bytes());
}

#[test]
fn file_without_trailing_newline_keeps_the_last_line_unterminated() {
    let bytes = b"a\nb\nc\nd";
    let (_d, p) = file(bytes);
    let l = open(&p, small());
    let bs = batches(&l);
    assert_eq!(bs.last().unwrap().text, "d");
    assert_eq!(l.info().unwrap().lines, 4);
    assert_consistent(&l, bytes);
}

#[test]
fn empty_file_and_only_newlines() {
    for bytes in [b"".as_slice(), b"\n", b"\n\n\n\n\n\n\n", b"\r\n\r\n"] {
        let (_d, p) = file(bytes);
        let l = open(&p, small());
        assert_consistent(&l, bytes);
        assert!(l.read_batch(0).is_ok());
    }
    let (_d, p) = file(b"");
    let l = open(&p, small());
    assert_eq!(l.info().unwrap().lines, 1);
    assert_eq!(l.read_batch(0).unwrap().text, "");
}

#[test]
fn crlf_is_shown_as_lf_and_lone_cr_is_kept_as_a_character() {
    let bytes = b"a\r\nb\rc\r\nd\r\n";
    let (_d, p) = file(bytes);
    let l = open(&p, small());
    let text = whole(&l);
    assert_eq!(text, "a\nb\rc\nd\n", "só o \\r\\n vira \\n; o \\r solto fica (o editor não o trata como quebra)");
    assert_eq!(l.info().unwrap().lines, 4);
}

#[test]
fn utf8_bom_is_skipped_and_not_shown() {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice("ação\nb\n".as_bytes());
    let (_d, p) = file(&bytes);
    let l = open(&p, small());
    assert_eq!(l.encoding, Encoding::Utf8Bom);
    assert_eq!(whole(&l), "ação\nb\n");
}

#[test]
fn cp1252_is_decoded_per_byte() {
    let bytes = b"a\xE7\xE3o\ncaf\xE9\n".to_vec();
    let (_d, p) = file(&bytes);
    let l = open(&p, small());
    assert_eq!(l.encoding, Encoding::Windows1252);
    assert_eq!(whole(&l), "a\u{e7}\u{e3}o\ncaf\u{e9}\n");
}

// ---- linhas gigantes: acento e emoji -------------------------------------------------

#[test]
fn a_giant_line_is_cut_into_virtual_segments_that_never_exceed_the_limit() {
    let line = "x".repeat(100);
    let bytes = format!("{line}\nfim\n");
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, small());
    let bs = batches(&l);
    let breaks: usize = bs.iter().map(|b| b.breaks.len()).sum();
    assert_eq!(breaks, 100 / 16, "100 bytes em segmentos de 16: 6 cortes e uma sobra");
    for b in &bs {
        for line in b.text.split('\n') {
            assert!(line.len() <= 16, "segmento de {} bytes", line.len());
        }
    }
    assert_eq!(whole(&l), bytes, "os cortes são só de exibição: o arquivo continua igual");
    assert_consistent(&l, bytes.as_bytes());
}

#[test]
fn giant_line_with_accents_and_emoji_is_cut_only_at_character_boundaries() {
    // misturas de 1, 2, 3 e 4 bytes por caractere, sem nenhuma quebra de linha
    let unit = "aé€😀ção🎉";
    let bytes = unit.repeat(40);
    for seg in [8usize, 9, 10, 11, 13, 16, 17, 31] {
        let (_d, p) = file(bytes.as_bytes());
        let l = open(&p, Limits { segment_bytes: seg, batch_bytes: 256, ..small() });
        let bs = batches(&l);
        for b in &bs {
            assert!(!b.lossy, "seg={seg}: um caractere foi cortado no meio");
            for piece in b.text.split('\n') {
                assert!(piece.len() <= seg, "seg={seg}: pedaço de {} bytes", piece.len());
            }
        }
        assert_eq!(whole(&l), bytes, "seg={seg}");
        assert_consistent(&l, bytes.as_bytes());
    }
}

#[test]
fn breaks_are_reported_in_utf16_units_not_bytes_or_chars() {
    // cada 😀 vale 2 em UTF-16, 4 em bytes, 1 caractere
    let bytes = "😀".repeat(20);
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, Limits { segment_bytes: 16, batch_bytes: 256, batch_lines: 100, ..small() });
    let b = l.read_batch(0).unwrap();
    assert_eq!(b.breaks, vec![8, 17, 26, 35], "4 emojis (8 unidades) por segmento, mais o \\n virtual de cada um");
    let utf16: Vec<u16> = b.text.encode_utf16().collect();
    for &at in &b.breaks {
        assert_eq!(utf16[at], u16::from(b'\n'));
    }
}

#[test]
fn giant_line_with_crlf_keeps_the_cr_with_its_lf() {
    let bytes = format!("{}\r\nb\r\n", "y".repeat(40));
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, small());
    assert_eq!(whole(&l), format!("{}\nb\n", "y".repeat(40)));
    assert_consistent(&l, bytes.as_bytes());
}

#[test]
fn giant_line_spanning_batches_is_one_line_in_the_file() {
    let bytes = format!("{}\n", "z".repeat(200));
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, small());
    assert!(l.info().unwrap().batches > 1, "200 bytes não cabem num lote de 64");
    assert_eq!(whole(&l), bytes);
    assert_consistent(&l, bytes.as_bytes());
}

#[test]
fn exact_segment_size_line_is_not_cut() {
    let bytes = format!("{}\n{}\n", "a".repeat(16), "b".repeat(17));
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, small());
    let breaks: usize = batches(&l).iter().map(|b| b.breaks.len()).sum();
    assert_eq!(breaks, 1, "16 bytes cabem; 17 viram dois pedaços");
}

// ---- ir para a linha -----------------------------------------------------------------

#[test]
fn locate_is_a_sum_of_batch_line_counts() {
    let bytes: String = (0..50).map(|i| format!("linha {i}\n")).collect();
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, small());
    for line in 0..=50u64 {
        let loc = l.locate(line).unwrap();
        let b = l.read_batch(loc.batch).unwrap();
        assert_eq!(loc.start_line, b.start_line);
        let last = loc.batch + 1 == l.info().unwrap().batches;
        assert!(line >= b.start_line && (line < b.start_line + b.lines || last));
        let text = b.text.split('\n').nth((line - b.start_line) as usize).unwrap_or("");
        if line < 50 {
            assert_eq!(text, format!("linha {line}"));
        }
    }
}

#[test]
fn locate_past_the_end_goes_to_the_last_batch() {
    let (_d, p) = file(b"a\nb\nc\nd\ne\n");
    let l = open(&p, small());
    let last = l.info().unwrap().batches - 1;
    assert_eq!(l.locate(9_999_999).unwrap().batch, last);
}

#[test]
fn locate_before_the_index_reaches_the_line_asks_to_wait() {
    let bytes: String = (0..50).map(|i| format!("{i}\n")).collect();
    let (_d, p) = file(bytes.as_bytes());
    let l = Large::open(&p, small(), None).unwrap(); // sem indexar
    assert!(l.locate(0).is_err());
    assert!(l.read_batch(0).is_err());
}

// ---- edição e salvar -----------------------------------------------------------------

/// Texto do lote como está no arquivo (sem cortes virtuais).
fn file_text_of(l: &Large, i: usize) -> String {
    let b = l.read_batch(i).unwrap();
    strip_virtual(&b.text, &b.breaks)
}

fn expected_after(bytes: &[u8], l: &Large, i: usize, new_text: &str, eol: Eol, enc: Encoding) -> Vec<u8> {
    let g = l.inner.read().unwrap();
    let b = g.batches[i];
    let mut out = bytes[..b.start as usize].to_vec();
    out.extend(encode_chunk(new_text, enc, eol).unwrap());
    out.extend_from_slice(&bytes[b.end as usize..]);
    out
}

#[test]
fn editing_a_batch_changes_only_that_batch_in_the_saved_file() {
    let bytes = b"1\n2\n3\n4\n5\n6\n7\n";
    let (_d, p) = file(bytes);
    let l = open(&p, small());
    let out = l.edit(1, "quatro\n5\n6\n").unwrap();
    assert!(out.edited && out.dirty);
    assert_eq!(out.lines, 3);
    assert_eq!(std::fs::read(&p).unwrap(), bytes, "editar não toca no arquivo do usuário");
    l.save(None, SaveMode::Safe).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"1\n2\n3\nquatro\n5\n6\n7\n");
    assert!(!l.is_dirty());
}

#[test]
fn inserting_and_deleting_lines_adjusts_the_numbering_of_the_next_batches() {
    let bytes = b"1\n2\n3\n4\n5\n6\n7\n8\n9\n";
    let (_d, p) = file(bytes);
    let l = open(&p, small());
    assert_eq!(l.read_batch(2).unwrap().start_line, 6);
    let out = l.edit(0, "1\nnovo a\nnovo b\n2\n3\n").unwrap();
    assert_eq!(out.lines, 5);
    assert_eq!(out.total_lines, 12);
    assert_eq!(l.read_batch(2).unwrap().start_line, 8, "o lote 3 começa 2 linhas depois");
    let out = l.edit(1, "").unwrap(); // apaga o lote 2 inteiro
    assert_eq!(out.lines, 0);
    assert_eq!(l.read_batch(2).unwrap().start_line, 5);
    assert_eq!(l.locate(5).unwrap().batch, 2);
    l.save(None, SaveMode::Safe).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"1\nnovo a\nnovo b\n2\n3\n7\n8\n9\n");
    assert!(!l.info().unwrap().done, "o lote apagado emenda linhas: o índice é refeito");
    l.index_blocking();
    // depois de salvar, o índice novo bate com o arquivo novo
    let info = l.info().unwrap();
    assert_eq!(info.lines, 9);
    assert_consistent(&l, b"1\nnovo a\nnovo b\n2\n3\n7\n8\n9\n");
}

#[test]
fn an_edit_that_crosses_the_batch_boundary_edits_both_batches() {
    let bytes = b"a1\na2\na3\nb1\nb2\nb3\nc1\n";
    let (_d, p) = file(bytes);
    let l = open(&p, small());
    // o usuário apagou a quebra entre os dois lotes (a3 + b1 viram uma linha) e escreveu nos dois
    let (t0, t1) = ("a1\nA2\na3b1".to_string(), "\nb2\nB3\n".to_string());
    l.edit(0, &t0).unwrap();
    l.edit(1, &t1).unwrap();
    assert_eq!(l.info().unwrap().edited_batches, 2);
    // lendo de novo, os dois lotes mostram as alterações; a linha emendada continua sendo uma só
    let joined = format!("{}{}", file_text_of(&l, 0), file_text_of(&l, 1));
    assert_eq!(joined, "a1\nA2\na3b1\nb2\nB3\n");
    assert_eq!(l.read_batch(1).unwrap().start_line, 2, "o lote 1 começa depois de 2 quebras");
    assert_eq!(l.info().unwrap().lines, 2 + 3 + 1 + 1, "as quebras dos três lotes, mais a linha final");
    l.save(None, SaveMode::Safe).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"a1\nA2\na3b1\nb2\nB3\nc1\n");
}

#[test]
fn editing_back_to_the_original_removes_the_change() {
    let bytes = b"1\n2\n3\n4\n";
    let (_d, p) = file(bytes);
    let l = open(&p, small());
    assert!(l.edit(0, "x\n2\n3\n").unwrap().dirty);
    let out = l.edit(0, "1\n2\n3\n").unwrap();
    assert!(!out.edited && !out.dirty);
    assert!(!l.is_dirty());
}

#[test]
fn unedited_batches_are_copied_byte_for_byte_including_mixed_line_endings() {
    // CRLF e LF misturados: só o lote editado é regravado (com a quebra dominante do arquivo)
    let bytes = b"a\r\nb\nc\r\nd\r\ne\nf\r\ng\r\n".to_vec();
    let (_d, p) = file(&bytes);
    let l = open(&p, small());
    assert_eq!(l.eol, Eol::Crlf);
    l.edit(1, "D\ne\nF\n").unwrap();
    l.save(None, SaveMode::Safe).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"a\r\nb\nc\r\nD\r\ne\r\nF\r\ng\r\n");
}

#[test]
fn utf8_bom_is_preserved_when_saving() {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice("um\ndois\ntrês\nquatro\n".as_bytes());
    let (_d, p) = file(&bytes);
    let l = open(&p, small());
    l.edit(0, "UM\ndois\ntrês\n").unwrap();
    l.save(None, SaveMode::Safe).unwrap();
    let got = std::fs::read(&p).unwrap();
    assert_eq!(&got[..3], &[0xEF, 0xBB, 0xBF]);
    assert_eq!(&got[3..], "UM\ndois\ntrês\nquatro\n".as_bytes());
}

#[test]
fn cp1252_edits_are_encoded_back_and_unencodable_text_is_refused() {
    let bytes = b"a\xE7\xE3o\nb\nc\nd\n".to_vec();
    let (_d, p) = file(&bytes);
    let l = open(&p, small());
    assert!(matches!(l.edit(0, "日本\nb\nc\n"), Err(Error::Unencodable(_))));
    assert!(!l.is_dirty(), "a recusa não deixa alteração pela metade");
    l.edit(0, "a\u{e7}\u{e3}o!\nb\nc\n").unwrap();
    l.save(None, SaveMode::Safe).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"a\xE7\xE3o!\nb\nc\nd\n");
}

#[test]
fn saving_an_edit_inside_a_giant_line_does_not_add_newlines_for_the_virtual_cuts() {
    let line = "é".repeat(60); // 120 bytes, vários segmentos de 16
    let bytes = format!("{line}\nfim\n");
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, Limits { batch_bytes: 512, ..small() });
    let b = l.read_batch(0).unwrap();
    assert!(!b.breaks.is_empty());
    // o usuário só trocou uma letra no meio; o texto de arquivo (sem os cortes) é o que vai ao core
    let edited = strip_virtual(&b.text, &b.breaks).replacen('é', "E", 1);
    l.edit(0, &edited).unwrap();
    l.save(None, SaveMode::Safe).unwrap();
    let got = String::from_utf8(std::fs::read(&p).unwrap()).unwrap();
    assert_eq!(got, format!("E{}\nfim\n", "é".repeat(59)));
    assert_eq!(got.matches('\n').count(), 2, "nenhuma quebra foi criada");
}

#[test]
fn an_edited_giant_line_is_shown_again_with_new_virtual_cuts() {
    let bytes = format!("{}\n", "a".repeat(40));
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, Limits { batch_bytes: 512, ..small() });
    l.edit(0, &format!("{}\n", "a".repeat(90))).unwrap();
    let b = l.read_batch(0).unwrap();
    assert_eq!(b.breaks.len(), 5);
    assert_eq!(b.lines, 6);
    assert!(b.edited);
}

#[test]
fn saving_nothing_keeps_the_file_identical_and_does_not_leave_temp_files() {
    let bytes = "a\r\nação\r\n".repeat(30).into_bytes();
    let (d, p) = file(&bytes);
    let l = open(&p, small());
    l.save(None, SaveMode::Safe).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), bytes);
    let names: Vec<_> = std::fs::read_dir(d.path()).unwrap().flatten().map(|e| e.file_name()).collect();
    assert_eq!(names.len(), 1, "sobrou arquivo temporário: {names:?}");
}

#[test]
fn save_as_writes_a_new_file_and_leaves_the_original_intact() {
    let bytes = b"1\n2\n3\n4\n5\n";
    let (d, p) = file(bytes);
    let l = open(&p, small());
    l.edit(0, "UM\n2\n3\n").unwrap();
    let other = d.path().join("copia.log");
    l.save(Some(&other), SaveMode::Safe).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), bytes, "o original não muda");
    assert_eq!(std::fs::read(&other).unwrap(), b"UM\n2\n3\n4\n5\n");
    assert_eq!(l.path().unwrap(), other, "a aba passa a apontar para o arquivo novo");
    assert_consistent(&l, b"UM\n2\n3\n4\n5\n");
}

#[test]
fn saving_after_the_file_changed_outside_is_a_conflict_and_nothing_is_written() {
    let bytes = b"1\n2\n3\n4\n";
    let (_d, p) = file(bytes);
    let l = open(&p, small());
    l.edit(0, "x\n2\n3\n").unwrap();
    std::fs::write(&p, b"outro programa\n").unwrap();
    assert_eq!(l.check_disk().unwrap(), DiskState::Changed);
    assert!(matches!(l.save(None, SaveMode::Safe), Err(Error::Conflict)));
    assert_eq!(std::fs::read(&p).unwrap(), b"outro programa\n");
    assert!(l.is_dirty(), "as alterações continuam guardadas");
}

#[test]
fn appending_to_the_file_is_detected_as_a_change() {
    let (_d, p) = file(b"1\n2\n3\n4\n");
    let l = open(&p, small());
    assert_eq!(l.check_disk().unwrap(), DiskState::Unchanged);
    let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
    f.write_all(b"5\n").unwrap();
    assert_eq!(l.check_disk().unwrap(), DiskState::Changed);
}

#[test]
fn a_deleted_original_cannot_be_saved_over() {
    let (_d, p) = file(b"1\n2\n3\n4\n");
    let l = open(&p, small());
    l.edit(0, "x\n2\n3\n").unwrap();
    std::fs::remove_file(&p).unwrap();
    assert_eq!(l.check_disk().unwrap(), DiskState::Missing);
    assert!(l.save(None, SaveMode::Safe).is_err());
}

#[test]
fn reading_a_batch_after_the_file_changed_size_is_a_conflict_not_garbage() {
    let (_d, p) = file(b"1\n2\n3\n4\n5\n6\n");
    let l = open(&p, small());
    std::fs::write(&p, b"1\n").unwrap();
    assert!(matches!(l.read_batch(1), Err(Error::Conflict)));
}

#[test]
fn save_needs_the_index_to_be_done() {
    let (_d, p) = file(b"1\n2\n3\n4\n");
    let l = Large::open(&p, small(), None).unwrap();
    assert!(l.save(None, SaveMode::Safe).is_err());
}

#[test]
fn an_oversized_edit_is_refused() {
    let (_d, p) = file(b"1\n2\n3\n4\n");
    let l = open(&p, small());
    assert!(l.edit(0, &"x".repeat(5000)).is_err());
    assert!(!l.is_dirty());
}

#[test]
fn a_batch_with_invalid_utf8_is_read_only() {
    // o começo parece UTF-8; mais adiante há um byte inválido (não é CP1252 porque a amostra disse UTF-8)
    let mut bytes = b"ok\nok\nok\n".to_vec();
    bytes.extend_from_slice(b"ruim \xFF aqui\nb\nc\n");
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.log");
    std::fs::write(&p, &bytes).unwrap();
    // a amostra (64 KB) inclui o byte ruim: por isso viraria CP1252; força o caso com uma amostra só de UTF-8
    let mut padded = "ok\n".repeat(SAMPLE / 3 + 10).into_bytes();
    padded.extend_from_slice(b"ruim \xFF aqui\nb\nc\n");
    std::fs::write(&p, &padded).unwrap();
    let l = open(&p, Limits { batch_lines: 5000, batch_bytes: 1 << 20, ..Limits::default() });
    assert_eq!(l.encoding, Encoding::Utf8);
    let n = l.info().unwrap().batches;
    let lossy: Vec<usize> = (0..n).filter(|&i| l.read_batch(i).unwrap().lossy).collect();
    assert!(!lossy.is_empty());
    assert!(l.edit(lossy[0], "x\n").is_err(), "editar regravaria U+FFFD no lugar do byte original");
    assert!(!l.is_dirty());
}

// ---- diário (nada se perde ao fechar) ------------------------------------------------

#[test]
fn edits_survive_closing_and_reopening_through_the_journal() {
    let bytes = b"1\n2\n3\n4\n5\n6\n";
    let (d, p) = file(bytes);
    let journal = d.path().join("diario");
    {
        let l = Large::open(&p, small(), Some(journal.clone())).unwrap();
        l.index_blocking();
        l.edit(0, "UM\n2\n3\n").unwrap();
        l.edit(1, "4\n5\nSEIS\n").unwrap();
        l.close();
    }
    let l = Large::open(&p, small(), Some(journal.clone())).unwrap();
    l.index_blocking();
    let info = l.info().unwrap();
    assert!(!info.orphaned);
    assert_eq!(info.edited_batches, 2);
    assert_eq!(whole(&l), "UM\n2\n3\n4\n5\nSEIS\n");
    assert_eq!(std::fs::read(&p).unwrap(), bytes, "o arquivo continua intocado");
    l.save(None, SaveMode::Safe).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"UM\n2\n3\n4\n5\nSEIS\n");
    assert!(!journal.exists(), "salvar limpa o diário");
}

#[test]
fn a_journal_of_another_version_of_the_file_is_kept_but_not_applied() {
    let (d, p) = file(b"1\n2\n3\n4\n");
    let journal = d.path().join("diario");
    {
        let l = Large::open(&p, small(), Some(journal.clone())).unwrap();
        l.index_blocking();
        l.edit(0, "x\n2\n3\n").unwrap();
    }
    std::fs::write(&p, b"completamente\noutro\narquivo\nagora\n").unwrap();
    let l = Large::open(&p, small(), Some(journal.clone())).unwrap();
    l.index_blocking();
    let info = l.info().unwrap();
    assert!(info.orphaned);
    assert_eq!(info.edited_batches, 0);
    assert_eq!(whole(&l), "completamente\noutro\narquivo\nagora\n");
    assert!(journal.join("0.txt").exists(), "as alterações da pessoa continuam no disco");
    assert!(matches!(l.edit(0, "z\n"), Err(Error::Conflict)));
    assert!(matches!(l.save(None, SaveMode::Safe), Err(Error::Conflict)));
    l.discard_edits().unwrap();
    assert!(!l.info().unwrap().orphaned);
    assert!(!journal.exists());
}

#[test]
fn a_corrupt_journal_file_is_not_applied_halfway() {
    let (d, p) = file(b"1\n2\n3\n4\n");
    let journal = d.path().join("diario");
    {
        let l = Large::open(&p, small(), Some(journal.clone())).unwrap();
        l.index_blocking();
        l.edit(0, "x\n2\n3\n").unwrap();
    }
    std::fs::write(journal.join("0.txt"), [0xFF, 0xFE, 0xFD]).unwrap(); // não é UTF-8
    let l = Large::open(&p, small(), Some(journal)).unwrap();
    l.index_blocking();
    assert!(l.info().unwrap().orphaned);
    assert_eq!(whole(&l), "1\n2\n3\n4\n");
}

// ---- busca ---------------------------------------------------------------------------

fn run_search(l: &Large, q: &str, opts: &search::Options, max: usize) -> (Vec<Hit>, SearchEnd) {
    let cancel = AtomicBool::new(false);
    let mut all = Vec::new();
    let end = l.search(q, opts, &cancel, max, &mut |h, _| all.extend_from_slice(h)).unwrap();
    (all, end)
}

#[test]
fn search_reports_absolute_lines_across_batches() {
    let bytes: String = (0..30).map(|i| if i % 7 == 0 { format!("alvo {i}\n") } else { format!("l {i}\n") }).collect();
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, small());
    let (hits, end) = run_search(&l, "alvo", &Default::default(), MAX_HITS);
    assert_eq!(hits.iter().map(|h| h.line).collect::<Vec<_>>(), vec![0, 7, 14, 21, 28]);
    assert!(!end.truncated && !end.cancelled);
    assert_eq!(hits[1].col, 0);
    assert_eq!(hits[1].len, 4);
    assert!(hits[1].preview.contains("alvo 7"));
}

#[test]
fn search_columns_and_lengths_are_utf16() {
    let (_d, p) = file("😀 café 😀 café\nsem\nsem\n😀 café\n".as_bytes());
    let l = open(&p, Limits { segment_bytes: 64, ..small() });
    let (hits, _) = run_search(&l, "café", &Default::default(), MAX_HITS);
    assert_eq!(hits.len(), 3);
    assert_eq!((hits[0].line, hits[0].col, hits[0].len), (0, 3, 4));
    assert_eq!((hits[1].line, hits[1].col), (0, 11), "😀 vale 2 unidades UTF-16");
    assert_eq!((hits[2].line, hits[2].col), (3, 3));
}

#[test]
fn search_sees_pending_edits_and_ignores_text_that_was_removed() {
    let (_d, p) = file(b"a\nb\nc\nd\nalvo\nf\n");
    let l = open(&p, small());
    l.edit(1, "d\nNOVO alvo\nf\n").unwrap();
    let (hits, _) = run_search(&l, "alvo", &Default::default(), MAX_HITS);
    assert_eq!(hits.iter().map(|h| h.line).collect::<Vec<_>>(), vec![4]);
    assert_eq!(hits[0].col, 5);
}

#[test]
fn search_after_an_insert_uses_the_shifted_line_numbers() {
    let (_d, p) = file(b"a\nb\nc\nalvo\ne\nf\n");
    let l = open(&p, small());
    l.edit(0, "a\nb\nc\nextra1\nextra2\n").unwrap();
    let (hits, _) = run_search(&l, "alvo", &Default::default(), MAX_HITS);
    assert_eq!(hits[0].line, 5);
    let b = l.read_batch(l.locate(5).unwrap().batch).unwrap();
    assert_eq!(b.text.split('\n').nth((5 - b.start_line) as usize), Some("alvo"));
}

#[test]
fn search_options_regex_case_and_whole_word() {
    let (_d, p) = file(b"Erro\nerro\nerros\nERRO 42\n");
    let l = open(&p, small());
    assert_eq!(run_search(&l, "erro", &Default::default(), 100).0.len(), 4 + 0 - 0, "sem diferenciar maiúsculas: 4");
    let cs = search::Options { case_sensitive: true, ..Default::default() };
    assert_eq!(run_search(&l, "erro", &cs, 100).0.len(), 2);
    let ww = search::Options { whole_word: true, ..Default::default() };
    assert_eq!(run_search(&l, "erro", &ww, 100).0.len(), 3);
    let re = search::Options { regex: true, ..Default::default() };
    assert_eq!(run_search(&l, r"\d+", &re, 100).0.len(), 1);
    assert!(l.search("(", &re, &AtomicBool::new(false), 10, &mut |_, _| {}).is_err());
}

#[test]
fn search_stops_at_the_hit_limit_and_says_it_was_truncated() {
    let bytes = "x\n".repeat(100);
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, small());
    let (hits, end) = run_search(&l, "x", &Default::default(), 10);
    assert_eq!(hits.len(), 10);
    assert!(end.truncated);
}

#[test]
fn search_can_be_cancelled_between_batches() {
    let bytes = "x\n".repeat(100);
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, small());
    let cancel = AtomicBool::new(false);
    let mut seen = 0usize;
    let end = l
        .search("x", &Default::default(), &cancel, MAX_HITS, &mut |h, _| {
            seen += h.len();
            cancel.store(true, Ordering::Relaxed);
        })
        .unwrap();
    assert!(end.cancelled);
    assert!(seen > 0 && seen < 100, "parou depois do primeiro lote: {seen}");
}

#[test]
fn search_streams_results_batch_by_batch() {
    let bytes = "x\n".repeat(30);
    let (_d, p) = file(bytes.as_bytes());
    let l = open(&p, small());
    let mut calls = Vec::new();
    l.search("x", &Default::default(), &AtomicBool::new(false), MAX_HITS, &mut |h, scanned| calls.push((h.len(), scanned))).unwrap();
    assert_eq!(calls.len(), 10, "um aviso por lote");
    assert_eq!(calls.last().unwrap().1, 10);
}

#[test]
fn empty_query_finds_nothing_and_search_waits_for_the_index() {
    let (_d, p) = file(b"a\nb\n");
    let l = open(&p, small());
    assert_eq!(run_search(&l, "", &Default::default(), 10).1.total, 0);
    let l2 = Large::open(&p, small(), None).unwrap();
    assert!(l2.search("a", &Default::default(), &AtomicBool::new(false), 10, &mut |_, _| {}).is_err());
}

// ---- indexação em segundo plano ------------------------------------------------------

#[test]
fn the_index_can_be_built_on_a_thread_and_cancelled() {
    let bytes = "linha\n".repeat(2000);
    let (_d, p) = file(bytes.as_bytes());
    let l = Large::open(&p, small(), None).unwrap();
    l.start_index();
    for _ in 0..200 {
        if l.info().unwrap().done {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(l.info().unwrap().done);
    assert_eq!(l.info().unwrap().lines, 2001);
    // cancelar antes de começar não deixa nada pela metade nem trava
    let l2 = Large::open(&p, small(), None).unwrap();
    l2.close();
    l2.index_blocking();
    assert!(!l2.info().unwrap().done);
}

// ---- propriedade: conteúdo variado, lotes minúsculos ---------------------------------

/// Quantos casos aleatórios rodar (`FULLPAD_PROP_CASES` aumenta, para uma bateria mais longa).
fn cases(default: usize) -> usize {
    std::env::var("FULLPAD_PROP_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn random_content(rng: &mut Rng, crlf: bool) -> String {
    const ATOMS: &[&str] = &["a", "bb", "é", "ção", "€", "😀", "🎉x", " ", "\t", "{}", "[1,2]", "\r"];
    let mut s = String::new();
    for _ in 0..rng.below(40) {
        match rng.below(10) {
            0 | 1 => s.push_str(if crlf { "\r\n" } else { "\n" }),
            2 => {
                // linha gigante
                for _ in 0..rng.below(60) {
                    s.push_str(ATOMS[rng.below(ATOMS.len() - 1)]);
                }
            }
            _ => s.push_str(ATOMS[rng.below(ATOMS.len())]),
        }
    }
    s
}

#[test]
fn property_invariants_hold_for_random_content_and_tiny_limits() {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for case in 0..cases(400) {
        let crlf = case % 3 == 0;
        let content = random_content(&mut rng, crlf);
        let limits = Limits {
            batch_lines: 1 + rng.below(6),
            batch_bytes: 20 + rng.below(100),
            segment_bytes: 8 + rng.below(30),
            max_edit_bytes: 1 << 20,
        };
        let bytes = content.as_bytes();
        let (_d, p) = file(bytes);
        let l = open(&p, limits);
        // 1) o texto sem os cortes virtuais é o do arquivo; 2) a contagem de linhas fecha; 3) nenhum
        //    pedaço passa do segmento; 4) nenhum caractere foi cortado
        let lim = l.limits;
        for b in batches(&l) {
            assert!(!b.lossy, "caso {case}: caractere cortado no meio");
            for piece in b.text.split('\n') {
                assert!(piece.len() <= lim.segment_bytes + 1, "caso {case}: pedaço de {} bytes", piece.len());
            }
        }
        // o `\r` solto não é quebra aqui, ao contrário do `decode` normal: compara só sem ele
        let expect = content.replace("\r\n", "\n");
        assert_eq!(whole(&l), expect, "caso {case}");
        let total: u64 = batches(&l).iter().map(|b| b.lines).sum::<u64>() + 1;
        let virtuals: usize = batches(&l).iter().map(|b| b.breaks.len()).sum();
        assert_eq!(total, (expect.matches('\n').count() + virtuals) as u64 + 1, "caso {case}: cada corte virtual é uma linha");
        for line in 0..total {
            let loc = l.locate(line).unwrap();
            let b = l.read_batch(loc.batch).unwrap();
            assert!(line >= b.start_line, "caso {case}");
        }
        // 5) salvar sem editar não muda um byte
        l.save(None, SaveMode::Safe).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), bytes, "caso {case}: salvar sem editar mudou o arquivo");
        // 6) editar um lote qualquer: o resultado é prefixo + lote novo + sufixo
        let n = l.info().unwrap().batches;
        let i = rng.below(n);
        let old = file_text_of(&l, i);
        let half = old.char_indices().nth(old.chars().count() / 2).map_or(0, |(i, _)| i);
        let tail = if rng.below(2) == 0 { "\n😀fim\n" } else { "😀fim" }; // com e sem quebra no fim (emenda de linha)
        let new_text = format!("{}Ω{}", &old[..half], tail);
        let before = std::fs::read(&p).unwrap();
        let eol = l.eol;
        let expected = expected_after(&before, &l, i, &new_text, eol, l.encoding);
        l.edit(i, &new_text).unwrap();
        l.save(None, SaveMode::Safe).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), expected, "caso {case}: lote {i}");
        if !l.info().unwrap().done {
            l.index_blocking(); // a emenda de linha pede índice novo
        }
        // 7) depois de salvar o índice é o do arquivo novo
        let again = open(&p, l.limits);
        assert_eq!(again.info().unwrap().lines, l.info().unwrap().lines, "caso {case}: índice depois de salvar");
        assert_eq!(whole(&again), whole(&l), "caso {case}");
    }
}

#[test]
fn property_edits_in_several_batches_at_once_match_the_reference() {
    let mut rng = Rng(0xD1B5_4A32_D192_ED03);
    for case in 0..cases(150) {
        let content = random_content(&mut rng, false) + &random_content(&mut rng, false);
        let limits = Limits { batch_lines: 2 + rng.below(3), batch_bytes: 30 + rng.below(60), segment_bytes: 8 + rng.below(20), max_edit_bytes: 1 << 20 };
        let (_d, p) = file(content.as_bytes());
        let l = open(&p, limits);
        let n = l.info().unwrap().batches;
        let mut expected: Vec<u8> = Vec::new();
        let (eol, enc) = (l.eol, l.encoding);
        let orig = std::fs::read(&p).unwrap();
        let ranges: Vec<(u64, u64)> = l.inner.read().unwrap().batches.iter().map(|b| (b.start, b.end)).collect();
        for (i, (s, e)) in ranges.iter().enumerate() {
            if rng.below(2) == 0 && i < n {
                let t = format!("[{i}]{}\n", file_text_of(&l, i));
                l.edit(i, &t).unwrap();
                expected.extend(encode_chunk(&t, enc, eol).unwrap());
            } else {
                expected.extend_from_slice(&orig[*s as usize..*e as usize]);
            }
        }
        let after: u64 = batches(&l).iter().map(|b| b.lines).sum::<u64>() + 1;
        assert_eq!(l.info().unwrap().lines, after, "caso {case}");
        l.save(None, SaveMode::Safe).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), expected, "caso {case}");
        if !l.info().unwrap().done {
            l.index_blocking();
        }
        let again = open(&p, l.limits);
        assert_eq!(again.info().unwrap().lines, l.info().unwrap().lines, "caso {case}: índice depois de salvar");
    }
}



/// Volume real (`cargo test -p fullpad-core --release -- --ignored volume --nocapture`): ~280 MB, uma
/// linha gigante no meio, acentos e CRLF. Confere tempos e que nada depende do tamanho do arquivo.
#[test]
#[ignore]
fn volume_indexes_reads_searches_edits_and_saves() {
    use std::time::Instant;
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("enorme.log");
    {
        let mut w = std::io::BufWriter::new(File::create(&p).unwrap());
        for i in 0..4_000_000u32 {
            if i == 2_000_000 {
                write!(w, "{}\r\n", "gigante😀é".repeat(300_000)).unwrap(); // 3,6 MB numa linha: 4 pedaços de até 1 MiB
            }
            write!(w, "2026-11-16 12:00:{:02} [INFO] requisição {i} concluída com sucesso\r\n", i % 60).unwrap();
        }
        w.flush().unwrap();
    }
    let size = std::fs::metadata(&p).unwrap().len();
    assert!(size > 250 * 1024 * 1024, "{size}");
    assert!(matches!(probe(&p, LARGE_THRESHOLD).unwrap(), Probe::Large(_)));
    let t = Instant::now();
    let l = Large::open(&p, Limits::default(), None).unwrap();
    eprintln!("open: {:?}", t.elapsed());
    let t = Instant::now();
    l.index_blocking();
    let info = l.info().unwrap();
    eprintln!("índice: {:?} ({} lotes, {} linhas, {} MB)", t.elapsed(), info.batches, info.lines, size / 1_000_000);
    assert!(info.done && info.error.is_none());
    let t = Instant::now();
    let loc = l.locate(3_000_000).unwrap();
    let b = l.read_batch(loc.batch).unwrap();
    eprintln!("ir para a linha 3.000.000: {:?} (lote {})", t.elapsed(), loc.batch);
    // depois da linha gigante (4 pedaços), a requisição `i` está na linha `i + 4`
    assert!(b.text.split('\n').nth((3_000_000 - b.start_line) as usize).unwrap().contains("requisição 2999996 "));
    let t = Instant::now();
    let cancel = AtomicBool::new(false);
    let mut first = None;
    let end = l.search("requisição 3999999 ", &Default::default(), &cancel, 10, &mut |h, scanned| {
        if first.is_none() && !h.is_empty() {
            first = Some((scanned, h[0].line));
        }
    })
    .unwrap();
    eprintln!("busca no arquivo todo: {:?} -> {first:?} {end:?}", t.elapsed());
    assert_eq!(first.unwrap().1, 4_000_003);
    let t = Instant::now();
    let text = b.text.replacen("INFO", "WARN", 1);
    l.edit(loc.batch, &strip_virtual(&text, &b.breaks)).unwrap();
    l.save(None, SaveMode::Safe).unwrap();
    eprintln!("salvar (~280 MB, 1 lote): {:?}", t.elapsed());
    assert_eq!(std::fs::metadata(&p).unwrap().len(), size);
}

// ---- CSV em modo grande: abre como texto e continua sendo um CSV válido depois de editar e salvar ------

fn csv_text(rows: usize) -> String {
    let mut s = String::from("id,nome,cidade,valor,observacao\n");
    for i in 0..rows {
        let obs = if i % 7 == 0 {
            "\"primeira linha\nsegunda linha, com vírgula e \"\"aspas\"\"\"".to_string()
        } else if i % 5 == 0 {
            "\"com vírgula, \"\"aspas\"\" e ação\"".to_string()
        } else {
            String::new()
        };
        s.push_str(&format!("{i},Ana {i},São Paulo,{}.{:02},{obs}\n", i * 3, i % 100));
    }
    s
}

#[test]
fn csv_is_accepted_for_large_mode_by_extension_and_opens_as_text() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["a.csv", "a.tsv", "a.CSV"] {
        let p = dir.path().join(name);
        std::fs::write(&p, csv_text(50)).unwrap();
        assert!(matches!(probe(&p, 100).unwrap(), Probe::Large(_)), "{name}");
    }
    // abaixo do limite o CSV segue o caminho de sempre (a tabela)
    let p = dir.path().join("pequeno.csv");
    std::fs::write(&p, csv_text(5)).unwrap();
    assert_eq!(probe(&p, LARGE_THRESHOLD).unwrap(), Probe::Normal);
}

#[test]
fn csv_with_quoted_newlines_and_commas_is_read_back_exactly() {
    let text = csv_text(200);
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.csv");
    std::fs::write(&p, &text).unwrap();
    let l = open(&p, small());
    assert_eq!(whole(&l), text, "o texto sem os cortes virtuais é o arquivo");
    assert_consistent(&l, text.as_bytes());
    // o parser de CSV do app lê o mesmo número de registros
    let csv = crate::csv::Csv::parse(whole(&l), ',');
    assert_eq!(csv.row_count(), crate::csv::Csv::parse(text, ',').row_count());
    assert!(!csv.unterminated());
}

#[test]
fn csv_stays_valid_after_editing_many_batches_and_saving() {
    let text = csv_text(300);
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.csv");
    std::fs::write(&p, &text).unwrap();
    let l = open(&p, small());
    let before = crate::csv::Csv::parse(text.clone(), ',');
    let n = l.info().unwrap().batches;
    let mut changed_batches = 0;
    for i in 0..n {
        let t = file_text_of(&l, i);
        if t.contains("Ana") {
            // troca o nome (uma edição de célula), sem mexer em aspas nem em quebras de linha
            l.edit(i, &t.replace("Ana", "ANA")).unwrap();
            changed_batches += 1;
        }
    }
    assert!(changed_batches > 10, "o teste só vale se editar muitos lotes ({changed_batches})");
    l.save(None, SaveMode::Safe).unwrap();
    let saved = std::fs::read_to_string(&p).unwrap();
    let after = crate::csv::Csv::parse(saved.clone(), ',');
    assert!(!after.unterminated(), "uma aspa ficou aberta: o CSV quebrou");
    assert_eq!(after.row_count(), before.row_count(), "mesmo número de registros");
    assert_eq!(after.cols(), before.cols());
    for r in 0..before.row_count() {
        for c in 0..before.cols() {
            let (a, b) = (before.cell(r, c).unwrap().value, after.cell(r, c).unwrap().value);
            if c == 1 && r > 0 {
                assert_eq!(b, a.replace("Ana", "ANA"), "linha {r}");
            } else {
                assert_eq!(b, a, "linha {r}, coluna {c} não devia mudar");
            }
        }
    }
    assert_eq!(saved, text.replace("Ana", "ANA"), "só os nomes mudaram, byte a byte");
}

#[test]
fn csv_edit_inside_a_giant_quoted_cell_keeps_the_record_count() {
    let giant = "célula enorme 😀 ".repeat(40); // bem acima de 16 bytes por segmento
    let text = format!("id,nome,obs\n1,Ana,\"{giant}\"\n2,Bia,ok\n");
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.csv");
    std::fs::write(&p, &text).unwrap();
    let l = open(&p, Limits { batch_bytes: 4096, ..small() });
    assert!(batches(&l).iter().any(|b| !b.breaks.is_empty()), "a célula foi cortada em segmentos virtuais");
    let t = file_text_of(&l, 0);
    l.edit(0, &t.replacen("enorme", "ENORME", 1)).unwrap();
    l.save(None, SaveMode::Safe).unwrap();
    let saved = std::fs::read_to_string(&p).unwrap();
    assert_eq!(saved, text.replacen("enorme", "ENORME", 1));
    let csv = crate::csv::Csv::parse(saved, ',');
    assert_eq!(csv.row_count(), 3);
    assert!(!csv.unterminated());
}

#[test]
fn csv_with_crlf_rows_keeps_untouched_batches_byte_identical() {
    // linhas em CRLF, como o Excel grava; o lote editado volta a usar CRLF, os outros ficam como estão
    let text = csv_text(60).replace('\n', "\r\n");
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.csv");
    std::fs::write(&p, &text).unwrap();
    let l = open(&p, small());
    assert_eq!(l.eol, Eol::Crlf);
    let t = file_text_of(&l, 2).replacen("Ana", "ANA", 1);
    let expected = expected_after(text.as_bytes(), &l, 2, &t, l.eol, l.encoding);
    l.edit(2, &t).unwrap();
    l.save(None, SaveMode::Safe).unwrap();
    let saved = std::fs::read(&p).unwrap();
    assert_eq!(saved, expected, "só o lote 2 foi regravado; os outros saem idênticos, em CRLF");
    assert_eq!(saved.iter().filter(|&&b| b == b'\n').count(), text.matches('\n').count(), "nenhuma quebra a mais nem a menos");
    assert!(!crate::csv::Csv::parse(String::from_utf8(saved).unwrap(), ',').unterminated());
}

#[test]
fn a_cancelled_save_leaves_the_file_and_the_pending_edits_alone_and_no_temp_behind() {
    let bytes = b"1\n2\n3\n4\n5\n6\n";
    let (d, p) = file(bytes);
    let l = open(&p, small());
    l.edit(1, "quatro\n5\n6\n").unwrap();
    l.close(); // o mesmo sinal de quem cancela
    let err = l.save(None, SaveMode::Safe).unwrap_err();
    assert!(err.to_string().contains("cancelado"), "{err}");
    assert_eq!(std::fs::read(&p).unwrap(), bytes, "o arquivo não muda");
    assert!(l.is_dirty(), "a alteração continua guardada");
    let leftovers: Vec<_> = std::fs::read_dir(d.path()).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with(".tmp-")).collect();
    assert!(leftovers.is_empty(), "o temporário foi apagado");
    let info = l.info().unwrap();
    assert_eq!((info.save_done, info.save_total), (0, 0), "sem salvar em andamento");
    // salvar de novo (sem o sinal) funciona e a cópia não ficou travada
    l.save_cancel.store(false, Ordering::Relaxed);
}

#[test]
fn edits_are_refused_while_a_save_runs_and_reads_still_work() {
    let (_d, p) = file(b"1\n2\n3\n4\n");
    let l = open(&p, small());
    l.saving.store(true, Ordering::Relaxed);
    assert!(l.edit(0, "x\n2\n3\n").is_err());
    assert!(l.discard_edits().is_err());
    assert!(l.info().is_ok(), "info não espera o salvar");
    assert!(l.read_batch(0).is_ok(), "ler também não");
    l.saving.store(false, Ordering::Relaxed);
    assert!(l.edit(0, "x\n2\n3\n").is_ok());
}

#[test]
fn the_progress_counts_every_byte_of_the_save() {
    let bytes = b"1\n2\n3\n4\n5\n6\n7\n";
    let (_d, p) = file(bytes);
    let l = open(&p, small());
    l.edit(0, "UM\n2\n3\n").unwrap();
    l.save(None, SaveMode::Safe).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"UM\n2\n3\n4\n5\n6\n7\n");
    assert_eq!(l.info().unwrap().save_total, 0, "zera ao terminar");
}

// ---- salvar direto ---------------------------------------------------------------------

fn tmp_files(dir: &Path) -> usize {
    std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with(".tmp-")).count()
}

#[test]
fn direct_save_of_same_size_edits_overwrites_in_place_without_a_temp() {
    let bytes = b"id,valor\n1,10\n2,20\n3,30\n4,40\n5,50\n6,60\n";
    let (d, p) = file(bytes);
    let l = open(&p, small());
    let before = l.save_plan().unwrap();
    assert_eq!((before.edited, before.resized), (0, 0));
    l.edit(1, "3,30\n4,99\n5,50\n").unwrap(); // 40 → 99: mesmo tamanho
    let plan = l.save_plan().unwrap();
    assert_eq!((plan.edited, plan.resized, plan.direct_bytes), (1, 0, 0));
    l.save(None, SaveMode::Direct).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"id,valor\n1,10\n2,20\n3,30\n4,99\n5,50\n6,60\n");
    assert_eq!(tmp_files(d.path()), 0);
    assert!(!l.is_dirty());
    assert_consistent(&l, b"id,valor\n1,10\n2,20\n3,30\n4,99\n5,50\n6,60\n");
}

#[test]
fn direct_save_that_grows_or_shrinks_rewrites_only_from_the_first_resized_batch() {
    let bytes = b"1\n2\n3\n4\n5\n6\n7\n8\n9\n";
    let (_d, p) = file(bytes);
    let l = open(&p, small());
    l.edit(2, "7\n8\nOITO E MEIO\n9\n").unwrap();
    let plan = l.save_plan().unwrap();
    assert_eq!((plan.edited, plan.resized), (1, 1));
    let start = 12; // "1\n2\n3\n4\n5\n6\n" são 12 bytes: o lote 2 começa em 12
    assert_eq!(plan.direct_bytes, bytes.len() as u64 - start);
    l.save(None, SaveMode::Direct).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"1\n2\n3\n4\n5\n6\n7\n8\nOITO E MEIO\n9\n");
    // e encolhe
    let l = open(&p, small());
    l.edit(0, "1\n").unwrap();
    l.save(None, SaveMode::Direct).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"1\n4\n5\n6\n7\n8\nOITO E MEIO\n9\n");
}

#[test]
fn direct_save_ignores_the_cancel_signal_because_stopping_halfway_would_corrupt_the_file() {
    let (_d, p) = file(b"1\n2\n3\n4\n5\n6\n");
    let l = open(&p, small());
    l.edit(1, "quatro\n5\n6\n").unwrap();
    l.close();
    l.save(None, SaveMode::Direct).unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"1\n2\n3\nquatro\n5\n6\n");
}

#[test]
fn saving_without_edits_does_not_touch_the_file() {
    let (d, p) = file(b"1\n2\n3\n");
    let l = open(&p, small());
    let before = std::fs::metadata(&p).unwrap().modified().unwrap();
    l.save(None, SaveMode::Safe).unwrap();
    l.save(None, SaveMode::Direct).unwrap();
    assert_eq!(std::fs::metadata(&p).unwrap().modified().unwrap(), before);
    assert_eq!(tmp_files(d.path()), 0);
}

#[test]
fn direct_save_after_the_file_changed_outside_is_a_conflict_and_writes_nothing() {
    let (_d, p) = file(b"1\n2\n3\n4\n");
    let l = open(&p, small());
    l.edit(0, "x\n2\n3\n").unwrap();
    std::fs::write(&p, b"outro programa\n").unwrap();
    assert!(matches!(l.save(None, SaveMode::Direct), Err(Error::Conflict)));
    assert_eq!(std::fs::read(&p).unwrap(), b"outro programa\n");
}

/// Direto e seguro dão o mesmo arquivo, com edições que crescem, encolhem e mantêm o tamanho, em
/// qualquer mistura e posição (arquivo com CRLF, acentos e BOM incluídos).
#[test]
fn direct_and_safe_save_produce_the_same_bytes_for_random_edits() {
    let mut seed = 0x2545_f491_4f6c_dd1du64;
    let mut rnd = move |n: u64| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed % n.max(1)
    };
    for round in 0..300 {
        let crlf = round % 3 == 0;
        let bom = round % 5 == 0;
        let nl = if crlf { "\r\n" } else { "\n" };
        let lines = 3 + rnd(40);
        let mut bytes = if bom { vec![0xEF, 0xBB, 0xBF] } else { vec![] };
        for i in 0..lines {
            let w = ["a", "ção", "😀", "xx", "linha longa de teste"][rnd(5) as usize];
            bytes.extend_from_slice(format!("{i}:{}{nl}", w.repeat(1 + rnd(3) as usize)).as_bytes());
        }
        let (d1, p1) = file(&bytes);
        let (d2, p2) = file(&bytes);
        let (a, b) = (open(&p1, small()), open(&p2, small()));
        let count = a.info().unwrap().batches as u64;
        for _ in 0..1 + rnd(4) {
            let idx = rnd(count) as usize;
            let cur = a.read_batch(idx).unwrap();
            let text = strip_virtual(&cur.text, &cur.breaks);
            let new = match rnd(3) {
                0 => text.replacen(|c: char| c.is_ascii_digit(), "7", 1), // mesmo tamanho
                1 => format!("{text}INSERIDO {}\n", "z".repeat(rnd(40) as usize)),
                _ => text.lines().take(1).map(|l| format!("{l}\n")).collect::<String>(),
            };
            if new.is_empty() {
                continue;
            }
            let _ = a.edit(idx, &new);
            let _ = b.edit(idx, &new);
        }
        a.save(None, SaveMode::Safe).unwrap();
        b.save(None, SaveMode::Direct).unwrap();
        assert_eq!(std::fs::read(&p1).unwrap(), std::fs::read(&p2).unwrap(), "rodada {round}");
        assert_eq!(tmp_files(d2.path()), 0);
        drop((d1, d2));
    }
}

#[test]
fn direct_save_with_growth_bigger_than_the_stream_chunk_matches_the_safe_save() {
    let limits = Limits { batch_lines: 1_000_000, batch_bytes: 1024 * 1024, segment_bytes: 1024 * 1024, max_edit_bytes: 32 * 1024 * 1024 };
    let mut bytes = Vec::new();
    for i in 0..400_000u32 {
        bytes.extend_from_slice(format!("linha número {i} com algum texto de enchimento\n").as_bytes());
    }
    assert!(bytes.len() > 16 * 1024 * 1024);
    let (_d1, p1) = file(&bytes);
    let (_d2, p2) = file(&bytes);
    let (a, b) = (open(&p1, limits), open(&p2, limits));
    let n = a.info().unwrap().batches;
    assert!(n > 8, "{n}");
    for l in [&a, &b] {
        let first = l.read_batch(1).unwrap();
        l.edit(1, &format!("{}{}", first.text, "crescimento\n".repeat(600_000))).unwrap(); // ~7 MB a mais: passa de um bloco de 4 MB
        let late = l.read_batch(n - 2).unwrap();
        let short: String = late.text.lines().skip(10).map(|x| format!("{x}\n")).collect();
        l.edit(n - 2, &short).unwrap(); // e depois encolhe
    }
    a.save(None, SaveMode::Safe).unwrap();
    b.save(None, SaveMode::Direct).unwrap();
    assert!(std::fs::read(&p1).unwrap() == std::fs::read(&p2).unwrap(), "direto e seguro divergem");
    assert!(std::fs::metadata(&p2).unwrap().len() > bytes.len() as u64);
}
