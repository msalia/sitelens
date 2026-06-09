# Build and runtime share the same Debian base (bookworm) so glibc matches —
# Alpine/musl or a mismatched base causes silent exits under Docker Swarm.
FROM rust:1.93 AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
# Required at compile time by the sqlx::migrate! macro.
COPY migrations ./migrations
RUN cargo build --release

FROM rust:1.93-slim AS runner
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/sitelens-api /usr/local/bin/sitelens-api
EXPOSE 4000
CMD ["sitelens-api"]
