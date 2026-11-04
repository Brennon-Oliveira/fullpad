//! Leitura e gravação de arquivos reais: encoding e fim de linha.
//!
//! O editor sempre trabalha com texto UTF-8 e quebras `\n`. Os metadados
//! (`Encoding`, `Eol`) ficam na aba e só são aplicados ao gravar no disco.

use crate::atomic::write_atomic;
use crate::error::{Error, IoContext, Result};
use crate::model::{Encoding, Eol};
use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub struct Decoded {
    /// Texto normalizado: UTF-8, só `\n`, sem BOM.
    pub text: String,
    pub encoding: Encoding,
    pub eol: Eol,
}

pub fn decode(bytes: &[u8]) -> Decoded {
    let (encoding, raw) = if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        (Encoding::Utf8Bom, encoding_rs::UTF_8.decode_without_bom_handling(rest).0)
    } else if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        (Encoding::Utf16Le, encoding_rs::UTF_16LE.decode_without_bom_handling(rest).0)
    } else if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        (Encoding::Utf16Be, encoding_rs::UTF_16BE.decode_without_bom_handling(rest).0)
    } else if let Ok(s) = std::str::from_utf8(bytes) {
        (Encoding::Utf8, s.into())
    } else {
        (Encoding::Windows1252, encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes).0)
    };

    let crlf = raw.matches("\r\n").count();
    let lf_only = raw.matches('\n').count() - crlf;
    let eol = if crlf > 0 && crlf >= lf_only {
        Eol::Crlf
    } else if lf_only > 0 {
        Eol::Lf
    } else {
        Eol::platform_default()
    };
    let text = raw.replace("\r\n", "\n").replace('\r', "\n");
    Decoded { text, encoding, eol }
}

pub fn encode(text: &str, encoding: Encoding, eol: Eol) -> Result<Vec<u8>> {
    let text = match eol {
        Eol::Lf => std::borrow::Cow::Borrowed(text),
        Eol::Crlf => std::borrow::Cow::Owned(text.replace('\n', "\r\n")),
    };
    Ok(match encoding {
        Encoding::Utf8 => text.into_owned().into_bytes(),
        Encoding::Utf8Bom => {
            let mut v = vec![0xEF, 0xBB, 0xBF];
            v.extend_from_slice(text.as_bytes());
            v
        }
        Encoding::Utf16Le => {
            let mut v = vec![0xFF, 0xFE];
            v.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
            v
        }
        Encoding::Utf16Be => {
            let mut v = vec![0xFE, 0xFF];
            v.extend(text.encode_utf16().flat_map(u16::to_be_bytes));
            v
        }
        Encoding::Windows1252 => {
            let (bytes, _, had_errors) = encoding_rs::WINDOWS_1252.encode(&text);
            if had_errors {
                return Err(Error::Unencodable("Windows-1252"));
            }
            bytes.into_owned()
        }
    })
}

/// Lê o arquivo e devolve também o carimbo dele (para detectar mudança externa depois).
pub fn read_file_stamped(path: &Path) -> Result<(Decoded, crate::disk::DiskStamp)> {
    let bytes = std::fs::read(path).at(path)?;
    let stamp = crate::disk::stamp_of(path, &bytes);
    Ok((decode(&bytes), stamp))
}

pub fn read_file(path: &Path) -> Result<Decoded> {
    let bytes = std::fs::read(path).at(path)?;
    Ok(decode(&bytes))
}

pub fn write_file(path: &Path, text: &str, encoding: Encoding, eol: Eol) -> Result<()> {
    write_atomic(path, &encode(text, encoding, eol)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_crlf_roundtrip() {
        let bytes = "olá\r\nmundo\r\n".as_bytes();
        let d = decode(bytes);
        assert_eq!(d.text, "olá\nmundo\n");
        assert_eq!((d.encoding, d.eol), (Encoding::Utf8, Eol::Crlf));
        assert_eq!(encode(&d.text, d.encoding, d.eol).unwrap(), bytes);
    }

    #[test]
    fn utf8_bom_is_detected_and_stripped() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("a\nb".as_bytes());
        let d = decode(&bytes);
        assert_eq!(d.text, "a\nb");
        assert_eq!((d.encoding, d.eol), (Encoding::Utf8Bom, Eol::Lf));
        assert_eq!(encode(&d.text, d.encoding, d.eol).unwrap(), bytes);
    }

    #[test]
    fn windows_1252_fallback_for_invalid_utf8() {
        let bytes = [b'a', 0xE7, 0xE3, b'o']; // "ação" em CP1252
        let d = decode(&bytes);
        assert_eq!(d.text, "a\u{e7}\u{e3}o");
        assert_eq!(d.encoding, Encoding::Windows1252);
        assert_eq!(encode(&d.text, d.encoding, d.eol).unwrap(), bytes);
    }

    #[test]
    fn utf16_roundtrip() {
        for enc in [Encoding::Utf16Le, Encoding::Utf16Be] {
            let bytes = encode("oi\nçã", enc, Eol::Crlf).unwrap();
            let d = decode(&bytes);
            assert_eq!(d.text, "oi\nçã");
            assert_eq!((d.encoding, d.eol), (enc, Eol::Crlf));
        }
    }

    #[test]
    fn mixed_eol_picks_majority_and_normalizes() {
        let d = decode(b"a\nb\nc\r\nd");
        assert_eq!(d.eol, Eol::Lf);
        assert_eq!(d.text, "a\nb\nc\nd");
    }

    #[test]
    fn unencodable_in_cp1252_is_an_error() {
        assert!(encode("日本", Encoding::Windows1252, Eol::Lf).is_err());
    }
}
