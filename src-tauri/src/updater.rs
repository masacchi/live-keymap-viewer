//! アプリの更新(Velopack)。
//!
//! インストーラー(Setup.exe、scripts/pack-win.mjsで作る)で入れたときだけ働く。
//! `npm run deploy:win`で置いたexeや開発中はVelopackの管理下に無いので、「更新できない」と
//! 答える(画面は更新の欄を出さない)。
//!
//! 更新はGitHubのリリース(公開リポジトリ)から取る。CIがタグのときに`vpk upload github`で
//! 載せる(.github/workflows/build-windows.yml)。`releases/latest/download`は最新の正式リリースの
//! 添付に転送されるので、そこに置いた`releases.win.json`と包み(.nupkg)を読めば足りる。
//! 認証は要らない ― 公開リポジトリなので、exeにトークンを埋め込まずに済む。

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use velopack::sources::HttpSource;
use velopack::{UpdateCheck, UpdateInfo, UpdateManager};

/// 更新を探す場所。
const UPDATE_URL: &str = "https://github.com/masacchi/live-keymap-viewer/releases/latest/download";

/// 自動の確認(forceでないとき)で、前に確かめた結果を使い回す時間。
/// モードを切り替えるたびにウィンドウごと作り直し、そのたびに画面が確かめに来るので、
/// GitHubに何度も問い合わせない(認証なしの問い合わせは1時間に60回まで)。
const CHECK_CACHE: Duration = Duration::from_secs(60 * 60);

/// 前に確かめた時刻と結果。
static LAST_CHECK: Mutex<Option<(Instant, UpdateStatus)>> = Mutex::new(None);

/// 画面に返す更新の状態(src/shared/ipc.tsのUpdateStatus)。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UpdateStatus {
    /// インストーラーで入れていない(開発中・deploy:winで置いたもの)。
    Unsupported,
    /// いまの版が最新。
    Latest { current: String },
    /// 新しい版がある。
    Available { current: String, version: String },
}

/// インストーラーで入れていなければNone。
fn manager() -> Option<UpdateManager> {
    UpdateManager::new(HttpSource::new(UPDATE_URL), None, None).ok()
}

fn available(manager: &UpdateManager) -> Result<Option<Box<UpdateInfo>>, String> {
    match manager.check_for_updates().map_err(|e| e.to_string())? {
        UpdateCheck::UpdateAvailable(info) => Ok(Some(info)),
        UpdateCheck::RemoteIsEmpty | UpdateCheck::NoUpdateAvailable => Ok(None),
    }
}

/// 新しい版があるかを見る。ネットワークに出るので、メインスレッドの外で呼ぶ。
/// `force`でなければ、CHECK_CACHE以内に確かめた結果をそのまま返す。
pub fn check(force: bool) -> Result<UpdateStatus, String> {
    if !force
        && let Some((at, status)) = &*LAST_CHECK.lock().unwrap_or_else(|p| p.into_inner())
        && at.elapsed() < CHECK_CACHE
    {
        return Ok(status.clone());
    }
    let status = check_now()?;
    *LAST_CHECK.lock().unwrap_or_else(|p| p.into_inner()) = Some((Instant::now(), status.clone()));
    Ok(status)
}

fn check_now() -> Result<UpdateStatus, String> {
    let Some(manager) = manager() else { return Ok(UpdateStatus::Unsupported) };
    let current = manager.get_current_version_as_string();
    Ok(match available(&manager)? {
        Some(info) => {
            UpdateStatus::Available { current, version: info.TargetFullRelease.Version.clone() }
        }
        None => UpdateStatus::Latest { current },
    })
}

/// 新しい版を落とし、アプリを終えて入れ替え、起動し直す。
///
/// `before_exit`は、落とし終えてアプリを終える直前に呼ぶ(まとめてある設定の書き込みなど)。
/// 入れ替えはVelopackのUpdate.exeが、このプロセスが終わるのを待ってから行う。
/// 成功したら呼び出し側でアプリを終えること(Velopackが先に終えることもある)。
pub fn apply(before_exit: impl FnOnce()) -> Result<(), String> {
    let manager = manager().ok_or("インストーラーで入れたものではないので、更新できない")?;
    let info = available(&manager)?.ok_or("新しい版が見つからない")?;
    manager.download_updates(&info, None).map_err(|e| e.to_string())?;
    before_exit();
    manager.apply_updates_and_restart(&info.TargetFullRelease).map_err(|e| e.to_string())
}
