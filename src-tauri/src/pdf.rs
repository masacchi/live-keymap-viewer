//! キーマップのPDF書き出し。
//!
//! 画面が印刷用のレイアウト(`@media print`。PrintSheet.tsx)を用意し、ここでWebView2の
//! 「PDFに印刷」(PrintToPdf)で書き出す。画面と同じフォント・色のまま、図がベクターで残る。
//! そのあとPDFに、メタデータ(題名・作成アプリ・キーボードのUIDなど)と、キーマップのJSONを
//! **添付ファイル**として書き足す(lopdf)。PDFビューアの添付ファイルの欄から取り出せる。
//!
//! PrintToPdfはWebView2だけにあるので、Windowsでだけ使える。書き足す部分(annotate)は
//! どこでも動くので、Linuxのテストで確かめる。

use std::path::Path;

use lopdf::{Dictionary, Document, Object, Stream, StringFormat, dictionary};
use serde::Deserialize;
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// 添付するキーマップの大きさの上限(バイト)。10レイヤーのCornixで数十KB。
const MAX_KEYMAP_JSON: usize = 4 * 1024 * 1024;
/// 添付ファイルの名前。
const ATTACHMENT_NAME: &str = "keymap.json";

/// 画面から渡される、書き出す内容(src/shared/ipc.tsのPdfExport)。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExport {
    /// 保存するときに勧めるファイル名(拡張子なし)。
    pub file_name: String,
    pub title: String,
    pub subject: String,
    pub keywords: String,
    /// Info辞書に足す独自の項目(`KeyboardUID`など)。名前は英数字だけを使う。
    pub custom: Vec<(String, String)>,
    /// 添付するキーマップ(JSONの文字列)。
    pub keymap_json: String,
}

/// 保存先を選んで書き出す。選ぶのをやめたらNone、書き出したら保存した場所を返す。
pub async fn export(
    app: AppHandle,
    window: WebviewWindow,
    export: PdfExport,
) -> Result<Option<String>, String> {
    if export.keymap_json.len() > MAX_KEYMAP_JSON {
        return Err("キーマップが大きすぎる".into());
    }
    let dialog = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(format!("{}.pdf", safe_file_name(&export.file_name)));
    // ダイアログはメインスレッドを止めないよう、別のスレッドで待つ
    let chosen =
        spawn_blocking(move || dialog.blocking_save_file()).await.map_err(|e| e.to_string())?;
    let Some(chosen) = chosen else { return Ok(None) };
    let path = chosen.into_path().map_err(|e| e.to_string())?;

    // 一時ファイルに印刷してから書き足す(選んだ場所に書きかけのファイルを残さないように)
    let printed = std::env::temp_dir().join(format!("lkv-print-{}.pdf", std::process::id()));
    print_to_pdf(&window, &printed).await?;
    let bytes = std::fs::read(&printed).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&printed);
    let creator = format!("Live Keymap Viewer {}", app.package_info().version);
    let annotated = annotate(&bytes?, &export, &creator)?;
    std::fs::write(&path, annotated).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// ファイル名に使えない文字を外す(Windowsで使えないものと、パスの区切り)。
fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() { "keymap".into() } else { trimmed.chars().take(80).collect() }
}

/// PDFの文字列(テキスト)。ASCIIだけならそのまま、ほかはUTF-16BE(BOM付き)にする(PDFの決まり)。
fn text(value: &str) -> Object {
    if value.is_ascii() {
        return Object::String(value.as_bytes().to_vec(), StringFormat::Literal);
    }
    let mut bytes = vec![0xFE, 0xFF];
    for unit in value.encode_utf16() {
        bytes.extend_from_slice(&unit.to_be_bytes());
    }
    Object::String(bytes, StringFormat::Hexadecimal)
}

/// Info辞書の独自の項目に使える名前か(英数字だけ。標準の項目は上書きさせない)。
fn usable_custom_key(key: &str) -> bool {
    const STANDARD: [&str; 8] = [
        "Title",
        "Author",
        "Subject",
        "Keywords",
        "Creator",
        "Producer",
        "CreationDate",
        "ModDate",
    ];
    !key.is_empty()
        && key.len() <= 64
        && key.chars().all(|c| c.is_ascii_alphanumeric())
        && !STANDARD.contains(&key)
}

/// 印刷したPDFに、メタデータとキーマップの添付を書き足す。
pub fn annotate(pdf: &[u8], export: &PdfExport, creator: &str) -> Result<Vec<u8>, String> {
    let mut doc = Document::load_mem(pdf).map_err(|e| format!("PDFを読めなかった: {e}"))?;

    // --- メタデータ(Info辞書)。WebView2が書いたもの(作成日時など)は残し、足す・上書きする ---
    let mut info = match doc.trailer.get(b"Info").and_then(Object::as_reference) {
        Ok(id) => doc.get_dictionary(id).cloned().unwrap_or_default(),
        Err(_) => Dictionary::new(),
    };
    info.set("Title", text(&export.title));
    info.set("Subject", text(&export.subject));
    info.set("Keywords", text(&export.keywords));
    info.set("Creator", text(creator));
    for (key, value) in &export.custom {
        if usable_custom_key(key) {
            info.set(key.as_bytes(), text(value));
        }
    }
    let info_id = doc.add_object(info);
    doc.trailer.set("Info", info_id);

    // --- キーマップの添付(EmbeddedFiles)。PDF 2.0 / PDF/A-3のやり方に合わせ、/AFでも指す ---
    let data = export.keymap_json.as_bytes().to_vec();
    let size = data.len() as i64;
    let file = Stream::new(
        dictionary! {
            "Type" => "EmbeddedFile",
            "Subtype" => Object::Name(b"application/json".to_vec()),
            "Params" => dictionary! { "Size" => size },
        },
        data,
    );
    let file_id = doc.add_object(file);
    let spec_id = doc.add_object(dictionary! {
        "Type" => "Filespec",
        "F" => text(ATTACHMENT_NAME),
        "UF" => text(ATTACHMENT_NAME),
        "Desc" => text("キーマップ(Live Keymap Viewerの形式)"),
        "AFRelationship" => "Data",
        "EF" => dictionary! { "F" => file_id, "UF" => file_id },
    });
    let embedded = dictionary! {
        "Names" => vec![text(ATTACHMENT_NAME), spec_id.into()],
    };
    let catalog = doc.catalog_mut().map_err(|e| format!("PDFの目次(Catalog)が無い: {e}"))?;
    // 印刷したPDFに/Namesがあれば(しおりの行き先など)、それは残してEmbeddedFilesだけ足す
    let mut names = match catalog.get(b"Names") {
        Ok(Object::Dictionary(existing)) => existing.clone(),
        _ => Dictionary::new(),
    };
    names.set("EmbeddedFiles", embedded);
    catalog.set("Names", names);
    catalog.set("AF", vec![Object::Reference(spec_id)]);

    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|e| format!("PDFを書けなかった: {e}"))?;
    Ok(out)
}

/// WebView2の「PDFに印刷」で`path`に書き出す。A4横・背景の色も印刷する・余白は画面が決める。
#[cfg(windows)]
async fn print_to_pdf(window: &WebviewWindow, path: &Path) -> Result<(), String> {
    use std::sync::mpsc;
    use std::time::Duration;

    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE, ICoreWebView2_7, ICoreWebView2Environment6,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{HSTRING, Interface};

    let (sender, receiver) = mpsc::channel::<Result<(), String>>();
    let target = HSTRING::from(path.as_os_str());
    window
        .with_webview(move |webview| {
            // この中はメインスレッド。印刷を始めるだけで、終わるのは待たない(待つと止まる)
            let done = sender.clone();
            let start = move || -> windows::core::Result<()> {
                unsafe {
                    let core = webview.controller().CoreWebView2()?;
                    let core7: ICoreWebView2_7 = core.cast()?;
                    let environment: ICoreWebView2Environment6 = webview.environment().cast()?;
                    let settings = environment.CreatePrintSettings()?;
                    settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE)?;
                    // A4(インチ)。向きは上で横にする
                    settings.SetPageWidth(8.27)?;
                    settings.SetPageHeight(11.69)?;
                    settings.SetShouldPrintBackgrounds(true)?;
                    settings.SetShouldPrintHeaderAndFooter(false)?;
                    // 余白は印刷用のレイアウト(styles.cssの.print-page)が持つ
                    settings.SetMarginTop(0.0)?;
                    settings.SetMarginBottom(0.0)?;
                    settings.SetMarginLeft(0.0)?;
                    settings.SetMarginRight(0.0)?;
                    let handler = PrintToPdfCompletedHandler::create(Box::new(
                        move |result: windows::core::Result<()>, ok: bool| {
                            let _ = done.send(match (result, ok) {
                                (Ok(()), true) => Ok(()),
                                (Err(error), _) => Err(error.to_string()),
                                (Ok(()), false) => Err("WebView2がPDFに印刷できなかった".into()),
                            });
                            Ok(())
                        },
                    ));
                    core7.PrintToPdf(&target, &settings, &handler)
                }
            };
            if let Err(error) = start() {
                let _ = sender.send(Err(error.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
    spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(60)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "PDFへの印刷が終わらなかった".to_string())?
}

/// Windows以外(開発用のLinux版)にはPrintToPdfが無い。
#[cfg(not(windows))]
async fn print_to_pdf(_window: &WebviewWindow, _path: &Path) -> Result<(), String> {
    Err("PDFの書き出しはWindowsでだけ使えます".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1ページだけの小さなPDF(WebView2が印刷したものの代わり)。
    fn blank_pdf() -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 842.into(), 595.into()],
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
            }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let info_id = doc.add_object(dictionary! { "Producer" => text("Skia/PDF") });
        doc.trailer.set("Info", info_id);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    fn export() -> PdfExport {
        PdfExport {
            file_name: "Cornix LP キーマップ".into(),
            title: "Cornix LP キーマップ".into(),
            subject: "L0〜L4".into(),
            keywords: "基本, 記号".into(),
            custom: vec![
                ("KeyboardUID".into(), "16882930253541522617".into()),
                ("Title".into(), "上書きさせない".into()),
                ("Bad Key".into(), "x".into()),
            ],
            keymap_json: r#"{"format":"live-keymap-viewer/keymap","version":1}"#.into(),
        }
    }

    fn info_text(doc: &Document, key: &[u8]) -> Option<String> {
        let id = doc.trailer.get(b"Info").ok()?.as_reference().ok()?;
        let bytes = doc.get_dictionary(id).ok()?.get(key).ok()?.as_str().ok()?.to_vec();
        if bytes.starts_with(&[0xFE, 0xFF]) {
            let units: Vec<u16> =
                bytes[2..].chunks(2).map(|pair| u16::from_be_bytes([pair[0], pair[1]])).collect();
            return String::from_utf16(&units).ok();
        }
        String::from_utf8(bytes).ok()
    }

    #[test]
    fn メタデータを書き足し_印刷したときの項目は残す() {
        let out = annotate(&blank_pdf(), &export(), "Live Keymap Viewer 0.2.0").unwrap();
        let doc = Document::load_mem(&out).unwrap();
        assert_eq!(info_text(&doc, b"Title").as_deref(), Some("Cornix LP キーマップ"));
        assert_eq!(info_text(&doc, b"Keywords").as_deref(), Some("基本, 記号"));
        assert_eq!(info_text(&doc, b"Creator").as_deref(), Some("Live Keymap Viewer 0.2.0"));
        assert_eq!(info_text(&doc, b"Producer").as_deref(), Some("Skia/PDF"));
        assert_eq!(info_text(&doc, b"KeyboardUID").as_deref(), Some("16882930253541522617"));
        // 標準の項目は独自の項目で上書きさせない。名前に使えない文字を含むものは足さない
        assert_ne!(info_text(&doc, b"Title").as_deref(), Some("上書きさせない"));
        assert_eq!(info_text(&doc, b"Bad Key"), None);
    }

    #[test]
    fn キーマップを添付ファイルとして埋め込む() {
        let out = annotate(&blank_pdf(), &export(), "Live Keymap Viewer").unwrap();
        let doc = Document::load_mem(&out).unwrap();
        let catalog = doc.catalog().unwrap();
        let names = catalog.get(b"Names").unwrap().as_dict().unwrap();
        let embedded = names.get(b"EmbeddedFiles").unwrap().as_dict().unwrap();
        let list = embedded.get(b"Names").unwrap().as_array().unwrap();
        assert_eq!(list[0].as_str().unwrap(), b"keymap.json");
        let spec = doc.get_dictionary(list[1].as_reference().unwrap()).unwrap();
        let ef = spec.get(b"EF").unwrap().as_dict().unwrap();
        let stream = doc.get_object(ef.get(b"F").unwrap().as_reference().unwrap()).unwrap();
        let content = stream
            .as_stream()
            .unwrap()
            .decompressed_content()
            .unwrap_or_else(|_| stream.as_stream().unwrap().content.clone());
        assert_eq!(content, export().keymap_json.as_bytes());
        assert!(catalog.get(b"AF").is_ok());
    }

    #[test]
    fn ファイル名に使えない文字を外す() {
        assert_eq!(safe_file_name("Cornix/LP: キーマップ?"), "Cornix-LP- キーマップ-");
        assert_eq!(safe_file_name("  "), "keymap");
    }
}
