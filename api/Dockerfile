# Build and runtime share the same Debian base (bookworm) so glibc matches —
# Alpine/musl or a mismatched base causes silent exits under Docker Swarm.
FROM rust:1.93 AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
# Required at compile time by the sqlx::migrate! macro.
COPY migrations ./migrations
# Declared as a [[bench]] target in Cargo.toml; cargo validates its path at parse
# time, so it must be present even though the release build doesn't compile it.
COPY benches ./benches
# BuildKit cache mounts keep the compiled dependency crates + registry between
# builds, so a source-only change recompiles just our crate instead of the whole
# tree (a cold build is still full; later ones are incremental). `target` is a
# cache mount — not persisted in the image layer — so copy the binary out before
# the RUN ends; the runner stage then COPYs that path.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release && cp target/release/sitelens-api /app/sitelens-api

FROM rust:1.93-slim AS runner
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/sitelens-api /usr/local/bin/sitelens-api
EXPOSE 4000
CMD ["sitelens-api"]
