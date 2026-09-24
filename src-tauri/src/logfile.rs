//! 配布ビルドの診断用ログ(設定と同じフォルダのlog.txt)。
//!
//! 開発はWSL、動かすのはWindowsなので、実機で何かが起きても開発側の端末には何も残らない。
//! 配布ビルドではDevToolsも開けない。そこで、まれにしか起きない出来事だけをファイルに残す:
//!
//!   - 起動(版とWebViewの版。どのビルドが動いていたかが分かる)
//!   - 警告(ショートカットの登録失敗、ぼかしの切り替え失敗、設定の保存失敗)
//!   - Rust側のpanic
//!   - 画面から報告されたエラー(components/ErrorBoundary.tsxなど)
//!
//! ポーリングのように毎秒起きることは書かない。まれなので書き込みは同期でよく、そのぶん
//! 落ちる直前の1行も取りこぼさない。際限なく伸びないよう、MAX_LINESを超えたら古い方から捨てる。

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// 残す行数。1行100文字として50KBほど。
const MAX_LINES: usize = 500;

struct LogFile {
    path: PathBuf,
    /// 直近のログ(メモリ上の控え)。ファイルを書き直すときの元になる。まだ読んでいなければNone。
    kept: Mutex<Option<Vec<String>>>,
}

static LOG: OnceLock<LogFile> = OnceLock::new();

/// 置き場所を決める。これより前のログは端末にだけ出る。
pub fn init(path: PathBuf) {
    let _ = LOG.set(LogFile { path, kept: Mutex::new(None) });
}

pub fn path() -> Option<PathBuf> {
    LOG.get().map(|log| log.path.clone())
}

pub fn info(message: &str, detail: Option<&str>) {
    write("info", message, detail);
}

pub fn warn(message: &str, detail: Option<&str>) {
    write("warn", message, detail);
}

pub fn error(message: &str, detail: Option<&str>) {
    write("error", message, detail);
}

fn write(level: &str, message: &str, detail: Option<&str>) {
    let entry = match detail {
        Some(detail) => format!("{} [{level}] {message} {detail}", iso_now()),
        None => format!("{} [{level}] {message}", iso_now()),
    };
    // 開発中は端末で読む。ファイルは配布ビルドのためのもの
    eprintln!("{entry}");

    let Some(log) = LOG.get() else { return };
    let mut kept = log.kept.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let lines = kept.get_or_insert_with(|| {
        // ファイルが無い・読めないときは空から始める
        let text = std::fs::read_to_string(&log.path).unwrap_or_default();
        let all: Vec<String> = text.lines().filter(|l| !l.is_empty()).map(str::to_owned).collect();
        all[all.len().saturating_sub(MAX_LINES)..].to_vec()
    });
    lines.extend(entry.lines().map(str::to_owned));
    // ログが書けないこと自体でアプリを止めない(端末には出ている)
    let _ = (|| -> std::io::Result<()> {
        if let Some(dir) = log.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        if lines.len() > MAX_LINES {
            let excess = lines.len() - MAX_LINES;
            lines.drain(..excess);
            std::fs::write(&log.path, format!("{}\n", lines.join("\n")))
        } else {
            let mut file = OpenOptions::new().create(true).append(true).open(&log.path)?;
            writeln!(file, "{entry}")
        }
    })();
}

/// 処理されなかったpanicをログに残す。
///
/// panicしてもアプリは終わらせない(Cargo.tomlでunwindのまま)。キーボードの表示はほとんど
/// 画面の側で動いていて、裏のスレッドが1つpanicしても画面は使えることが多い。
/// 黙って消えるより、記録を残して動き続ける方がよい。
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        error("Rust側で処理されなかったpanic", Some(&info.to_string()));
        default(info);
    }));
}

/// いまの時刻をISO 8601(UTC、ミリ秒まで)で返す。
fn iso_now() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format_iso(now.as_secs() as i64, now.subsec_millis())
}

fn format_iso(seconds: i64, millis: u32) -> String {
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// 1970-01-01からの日数を年月日に(Howard Hinnantのcivil_from_days)。
/// 時刻の書式のためだけに日付のライブラリは入れない。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 時刻を_iso_8601_で書く() {
        assert_eq!(format_iso(0, 0), "1970-01-01T00:00:00.000Z");
        // 2026-09-24T12:34:56.789Z
        assert_eq!(format_iso(1_790_253_296, 789), "2026-09-24T12:34:56.789Z");
        // うるう年の2月29日
        assert_eq!(format_iso(951_782_400, 0), "2000-02-29T00:00:00.000Z");
    }
}
