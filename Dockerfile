# SpeakMCP Docker Image
# Multi-stage build for development and Linux builds
#
# Usage:
#   Development shell: docker compose run --rm shell
#   Build Linux:       docker compose run --rm build-linux

# =============================================================================
# Stage 1: Base image with Node.js and system dependencies
# =============================================================================
FROM node:20-bookworm AS base

# Install system dependencies for Electron, Rust, and Linux builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build essentials
    build-essential \
    git \
    curl \
    ca-certificates \
    python3 \
    # Electron dependencies
    libgtk-3-0 \
    libnotify4 \
    libnss3 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    libatspi2.0-0 \
    libuuid1 \
    libsecret-1-0 \
    libayatana-appindicator3-1 \
    # Audio support
    libasound2 \
    pulseaudio \
    # X11 for headless builds
    xvfb \
    # Rust dependencies for speakmcp-rs
    libx11-dev \
    libxi-dev \
    libxcb1-dev \
    libxcb-render0-dev \
    libxcb-shape0-dev \
    libxcb-xfixes0-dev \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

# Install Rust toolchain
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Set working directory
WORKDIR /app

# =============================================================================
# Stage 2: Dependencies installation
# =============================================================================
FROM base AS deps

# Copy package manager config for consistent installs (e.g., shamefully-hoist=true)
COPY .npmrc ./
# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
# Note: --ignore-scripts skips postinstall hooks (including electron-builder install-app-deps)
# This is intentional to avoid issues in the container. The electron-builder install-app-deps
# is explicitly run in the 'builder' stage before packaging to ensure native dependencies
# are correctly installed for the Linux target platform.
RUN pnpm install --frozen-lockfile --ignore-scripts

# =============================================================================
# Stage 3: Development image
# =============================================================================
FROM deps AS development

# Copy source code
COPY . .

# Build shared package
RUN pnpm --filter @speakmcp/shared build

# Build Rust binary for Linux
WORKDIR /app/apps/desktop/speakmcp-rs
RUN cargo build --release
RUN mkdir -p /app/apps/desktop/resources/bin && \
    cp target/release/speakmcp-rs /app/apps/desktop/resources/bin/

WORKDIR /app

# Expose ports for development
# Electron dev server
EXPOSE 5173
# Remote server (if enabled)
EXPOSE 3210

# Default command for development
CMD ["pnpm", "dev"]

# =============================================================================
# Stage 4: Linux build image
# =============================================================================
FROM development AS builder

# Run electron-builder install-app-deps
RUN cd apps/desktop && pnpm exec electron-builder install-app-deps

# Build the application
RUN pnpm --filter @speakmcp/shared build
RUN cd apps/desktop && pnpm run typecheck
RUN cd apps/desktop && pnpm run test:run
RUN cd apps/desktop && pnpm exec electron-vite build

# Build Linux packages (AppImage and deb only)
# Note: snap builds require snapcraft which adds significant complexity;
# use native build environment or CI/CD with snapcraft for snap packages
RUN cd apps/desktop && pnpm exec electron-builder --linux AppImage deb --config electron-builder.config.cjs

# =============================================================================
# Stage 5: Artifacts extraction (minimal image with just the built packages)
# =============================================================================
FROM alpine:latest AS artifacts

WORKDIR /artifacts

# Copy built packages from builder stage
# Note: Only AppImage and deb are built (snap requires snapcraft which is not installed)
COPY --from=builder /app/apps/desktop/dist/ /tmp/dist/
RUN for ext in AppImage deb; do \
      cp /tmp/dist/*.$ext ./ 2>/dev/null || true; \
    done && \
    rm -rf /tmp/dist

# List artifacts
CMD ["ls", "-la", "/artifacts"]

