# Live Keymap Viewerの開発環境(devcontainer)。
#
# Windows版はLinuxからcargo-xwinでクロスビルドする。wineもWindowsも要らない
# (docs/DEVELOPMENT.md「Windowsに置く」)。実機はWSL / コンテナから見えないので、
# 動作確認はモック、実機はWindows側で行う。
FROM docker.io/library/ubuntu:26.04

# ホスト(WSL)と同じ版にそろえる。node_modulesをホストと共有するため
ARG NODE_VERSION=22.20.0

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git xz-utils zip unzip python3 \
      build-essential pkg-config \
      # TauriをLinux向けにビルドする(cargo test / clippyと、WSLgでLinux版を出すとき)
      libwebkit2gtk-4.1-dev librsvg2-dev \
      # hidapiのLinux版(hidraw)
      libudev-dev \
      # Windows向けのクロスビルド(cargo-xwinはclangとlld、exeのリソースにllvm-rcを使う)
      clang lld llvm \
      # インストーラーと更新用のパッケージを作るvpk(Velopack)を動かす
      dotnet-sdk-10.0 \
      # Linux版をWSLgで出したときに日本語が豆腐にならないように
      fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
  | tar -xJ -C /usr/local --strip-components=1 --exclude='*.md' --exclude=LICENSE

# ここから先は一般ユーザー(ubuntu, uid 1000)。podmanでは--userns=keep-idで
# ホストの自分と同じuidになるので、作ったファイルがホスト側でも自分のものになる
USER ubuntu
ENV RUSTUP_HOME=/home/ubuntu/.rustup \
    CARGO_HOME=/home/ubuntu/.cargo \
    PATH=/home/ubuntu/.cargo/bin:/home/ubuntu/.dotnet/tools:$PATH \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    # scripts/container.mjsが「もう中にいる」と分かるように
    LKV_DEVCONTAINER=1

# cargo-xwinはcrates.ioからビルドして入れる(glibc版)。配布されているバイナリはmusl版で、
# メモリの取り回しが遅く、MSVCのCRT / SDKの初回ダウンロードが10分以上かかって止まったように見える
# (glibc版なら十数秒)。CI(.github/workflows/build-windows.yml)もこの版を読んで同じように入れる
ARG CARGO_XWIN_VERSION=0.23.1
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal \
      --component clippy,rustfmt --target x86_64-pc-windows-msvc \
  && cargo install --locked cargo-xwin --version "${CARGO_XWIN_VERSION}" \
  && rm -rf /home/ubuntu/.cargo/registry \
  # ボリュームを被せる場所を先に作っておく(無いとrootの持ち物で作られて書けない)
  && mkdir -p /home/ubuntu/.cargo/registry /home/ubuntu/.cache/cargo-xwin

# vpk(VelopackのCLI)。アプリが使うvelopack crate(src-tauri/Cargo.toml)と同じ版にそろえる
# (パッケージの形式と、アプリ側の更新の読み方が食い違わないように)
ARG VPK_VERSION=1.2.158
RUN dotnet tool install --global vpk --version "${VPK_VERSION}"

# devcontainerでClaude Codeの設定のボリュームを被せる場所(devcontainer.json)。
# 上のcargoのRUNに混ぜると、そこから先を作り直すことになる(cargo-xwinのビルドで数分)ので分ける
RUN mkdir -p /home/ubuntu/.claude

# 開発用のElectron(npm run shots / gen:icon。アプリ本体ではない)が要るライブラリ。
# 残りはwebkit2gtkが連れてくる。最初のapt-getに混ぜると、cargo-xwinのビルドから作り直すことになるので、
# ここでrootに戻って足す
USER root
RUN apt-get update && apt-get install -y --no-install-recommends libnss3 libasound2t64 \
  && rm -rf /var/lib/apt/lists/*
USER ubuntu
