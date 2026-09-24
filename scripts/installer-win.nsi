; Windows 用のインストーラー(NSIS)。scripts/installer-win.mjs が makensis に渡す。
;
; 次を -D で受け取る:
;   VERSION      表示用の版(package.json の version)
;   VERSION_WIN  exe のバージョン情報に入れる版。VIProductVersion は数字 4 つの形しか受け付けない
;   SOURCE_DIR   package-win.mjs が作ったもの(dist/win32-x64。中身は exe 1 つ)
;   ICON         セットアップ exe とアンインストーラーのアイコン(assets/icon.ico)
;   OUT_FILE     出力するセットアップ exe
;
; 方針:
;   - ユーザーごとに入れる(%LOCALAPPDATA%\Programs\LiveKeymapViewer)。管理者権限を求めない
;   - 置き場所は選ばせない(/D= も無視する)。上書きのときに前の版を丸ごと消してから置くため
;     ― 版によって置くファイルが変わることがあり(Electron 版は DLL や locales を並べていた)、
;     古いものが残ると紛らわしい。
;     選べるようにすると、選ばれた場所を丸ごと消すことになり危ない
;   - 起動中なら止めずに断る。勝手に終了させると、確認中の画面を落とすことになる
;     (deploy-win.mjs と同じ考え)
;   - 設定とログ(%APPDATA%\Live Keymap Viewer)はアンインストールでも残す。入れ直したときに
;     そのまま使えるように

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!macro Require NAME
  !ifndef ${NAME}
    !error "${NAME} を -D で渡すこと(scripts/installer-win.mjs から呼ぶ)"
  !endif
!macroend
!insertmacro Require VERSION
!insertmacro Require VERSION_WIN
!insertmacro Require SOURCE_DIR
!insertmacro Require ICON
!insertmacro Require OUT_FILE

!define APP_NAME "Live Keymap Viewer"
!define APP_ID "LiveKeymapViewer"
!define EXE_NAME "LiveKeymapViewer.exe"
!define INSTALL_DIR "$LOCALAPPDATA\Programs\${APP_ID}"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "${INSTALL_DIR}"
BrandingText "${APP_NAME} ${VERSION}"

; --- 画面 ---

!define MUI_ABORTWARNING
; セットアップ exe とアンインストーラーのアイコン。両方に同じものを使う
; (NSIS はアンインストーラーのアイコンに、インストーラーと同じ大きさの組を求める)
; (こちらは makensis が作るときに読むパス。Linux でも動くので / で書く)
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE_NAME}"
; 「readme を開く」の欄を、デスクトップのショートカットを作るかの選択に使う(MUI2 の定番の手)
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "デスクトップにショートカットを作る"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Japanese"

; セットアップ exe 自体のバージョン情報(エクスプローラーのプロパティに出る)
VIProductVersion "${VERSION_WIN}"
VIFileVersion "${VERSION_WIN}"
VIAddVersionKey /LANG=${LANG_JAPANESE} "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=${LANG_JAPANESE} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_JAPANESE} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_JAPANESE} "FileDescription" "${APP_NAME} セットアップ"
; 無いと makensis が警告を出す。書く中身が無いので空にしておく
VIAddVersionKey /LANG=${LANG_JAPANESE} "LegalCopyright" ""

; --- 起動中かを見る ---

; 起動中の exe は書き込み用に開けない(Windows がロックしている)ので、それで見分ける。
; 開けたら何も書かずに閉じる。インストーラーとアンインストーラーで関数を分けないといけないのでマクロにする
!macro EnsureNotRunning
  retry:
    IfFileExists "$INSTDIR\${EXE_NAME}" 0 done
    ClearErrors
    FileOpen $0 "$INSTDIR\${EXE_NAME}" a
    IfErrors 0 closed
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
      "${APP_NAME} が起動中です。$\r$\n閉じてから「再試行」を押してください。" \
      /SD IDCANCEL IDRETRY retry
    Abort
  closed:
    FileClose $0
  done:
!macroend

; --- WebView2 があるかを見る ---

; 画面は Windows の WebView2 で描く。Windows 11 には最初から入っているが、Windows 10 では
; 入っていないことがある。無ければ入れ方を案内する(インストールは続ける。後から入れれば動く)。
; 入っているかは、Microsoft が案内している EdgeUpdate の登録(pv に版が入る)で見る
!define WEBVIEW2_CLIENT "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WEBVIEW2_MISSING "画面の表示に使う Microsoft Edge WebView2 ランタイムが見つかりませんでした。$\r$\n$\r$\nインストールは続けます。起動しない場合は、次のページから「エバーグリーン ブートストラップ」を入れてください。$\r$\n$\r$\nhttps://developer.microsoft.com/microsoft-edge/webview2/"

Function CheckWebView2
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\${WEBVIEW2_CLIENT}" "pv"
  StrCmp $0 "" 0 found
  ReadRegStr $0 HKCU "Software\${WEBVIEW2_CLIENT}" "pv"
  StrCmp $0 "" 0 found
  MessageBox MB_OK|MB_ICONINFORMATION "${WEBVIEW2_MISSING}" /SD IDOK
  found:
FunctionEnd

Function .onInit
  StrCpy $INSTDIR "${INSTALL_DIR}"
  !insertmacro EnsureNotRunning
  Call CheckWebView2
FunctionEnd

Function un.onInit
  StrCpy $INSTDIR "${INSTALL_DIR}"
  !insertmacro EnsureNotRunning
FunctionEnd

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${EXE_NAME}"
FunctionEnd

; --- インストール ---

Section
  ; 前の版を消してから置く(冒頭の方針)
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${SOURCE_DIR}/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${EXE_NAME}"

  ; 「設定 → アプリ」に出す
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${EXE_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
SectionEnd

; --- アンインストール ---

Section "Uninstall"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  RMDir /r "$INSTDIR"
SectionEnd
