# Live Keymap Viewer の開発環境(devcontainer)。
#
# Windows 版は Linux から cargo-xwin でクロスビルドする。wine も Windows も要らない
# (docs/DEVELOPMENT.md「Windows に置く」)。実機は WSL / コンテナから見えないので、
# 動作確認はモック、実機は Windows 側で行う(これは Electron のころと同じ)。
FROM docker.io/library/ubuntu:26.04

# ホスト(WSL)と同じ版にそろえる。node_modules をホストと共有するため
ARG NODE_VERSION=22.20.0

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git xz-utils zip unzip python3 \
      build-essential pkg-config \
      # Tauri を Linux 向けにビルドする(cargo test / clippy と、WSLg で Linux 版を出すとき)
      libwebkit2gtk-4.1-dev librsvg2-dev \
      # hidapi の Linux 版(hidraw)
      libudev-dev \
      # Windows 向けのクロスビルド(cargo-xwin は clang と lld、exe のリソースに llvm-rc を使う)
      clang lld llvm \
      # インストーラー(scripts/installer-win.nsi)
      nsis \
      # Linux 版を WSLg で出したときに日本語が豆腐にならないように
      fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
  | tar -xJ -C /usr/local --strip-components=1 --exclude='*.md' --exclude=LICENSE

# ここから先は一般ユーザー(ubuntu, uid 1000)。podman では --userns=keep-id で
# ホストの自分と同じ uid になるので、作ったファイルがホスト側でも自分のものになる
USER ubuntu
ENV RUSTUP_HOME=/home/ubuntu/.rustup \
    CARGO_HOME=/home/ubuntu/.cargo \
    PATH=/home/ubuntu/.cargo/bin:$PATH \
    # scripts/container.mjs が「もう中にいる」と分かるように
    LKV_DEVCONTAINER=1

RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal \
      --component clippy,rustfmt --target x86_64-pc-windows-msvc \
  && cargo install --locked cargo-xwin \
  && rm -rf /home/ubuntu/.cargo/registry \
  # ボリュームを被せる場所を先に作っておく(無いと root の持ち物で作られて書けない)
  && mkdir -p /home/ubuntu/.cargo/registry /home/ubuntu/.cache/cargo-xwin
