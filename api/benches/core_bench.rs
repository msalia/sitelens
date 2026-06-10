//! Micro-benchmarks for the geo-core hot paths: the Helmert solve/apply, CRS
//! projection, full coordinate conversion, and import parsing throughput.
//!
//! Run with `cargo bench`. These are CPU-only (no database), so they run
//! anywhere and give stable baselines for Phase 9 regression tracking.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use sitelens_api::convert::{convert, Space};
use sitelens_api::crs::projected_to_geographic;
use sitelens_api::geo::{solve_helmert, Correspondence, HelmertParams};
use sitelens_api::import::{parse_csv, CsvMapping};

// UTM zone 10N / NAD83 — a realistic metric projected CRS.
const EPSG: i32 = 26910;

/// A deterministic set of grid↔projected correspondences with a slight rotation
/// and scale, so the SVD solve does real work.
fn correspondences(n: usize) -> Vec<Correspondence> {
    let (a, b, tx, ty) = (1.000_05_f64, 0.0008_f64, 500_000.0, 4_000_000.0);
    (0..n)
        .map(|i| {
            let gx = (i % 50) as f64 * 10.0;
            let gy = (i / 50) as f64 * 10.0;
            Correspondence {
                grid_x: gx,
                grid_y: gy,
                proj_e: a * gx - b * gy + tx,
                proj_n: b * gx + a * gy + ty,
            }
        })
        .collect()
}

fn bench_solve(c: &mut Criterion) {
    let mut group = c.benchmark_group("solve_helmert");
    for n in [4_usize, 50, 500] {
        let pts = correspondences(n);
        group.throughput(Throughput::Elements(n as u64));
        group.bench_with_input(BenchmarkId::from_parameter(n), &pts, |bch, pts| {
            bch.iter(|| solve_helmert(black_box(pts)).unwrap());
        });
    }
    group.finish();
}

fn bench_apply(c: &mut Criterion) {
    let t = HelmertParams::from_components(1.0001, 0.001, 500_000.0, 4_000_000.0);
    c.bench_function("helmert_apply", |b| {
        b.iter(|| black_box(t).apply(black_box(123.4), black_box(567.8)));
    });
}

fn bench_crs(c: &mut Criterion) {
    c.bench_function("projected_to_geographic", |b| {
        b.iter(|| projected_to_geographic(EPSG, black_box(545_000.0), black_box(4_184_000.0)));
    });
}

fn bench_convert(c: &mut Criterion) {
    let t = HelmertParams::from_components(1.0001, 0.001, 500_000.0, 4_000_000.0);
    c.bench_function("convert_full", |b| {
        b.iter(|| {
            convert(
                Space::Projected,
                black_box(545_000.0),
                black_box(4_184_000.0),
                Some(t),
                EPSG,
                0.999_6,
            )
        });
    });
}

/// Builds a CSV body of `n` data rows: P,N,E,Z,D
fn csv_body(n: usize) -> String {
    let mut s = String::from("P,N,E,Z,D\n");
    for i in 0..n {
        s.push_str(&format!(
            "PT{i},{},{},{},pt {i}\n",
            1000 + i,
            2000 + i,
            i % 30
        ));
    }
    s
}

fn bench_parse_csv(c: &mut Criterion) {
    let mapping = CsvMapping {
        has_header: true,
        label_col: Some(0),
        northing_col: 1,
        easting_col: 2,
        elevation_col: Some(3),
        description_col: Some(4),
    };
    let mut group = c.benchmark_group("parse_csv");
    for n in [1_000_usize, 10_000] {
        let body = csv_body(n);
        group.throughput(Throughput::Elements(n as u64));
        group.bench_with_input(BenchmarkId::from_parameter(n), &body, |bch, body| {
            bch.iter(|| parse_csv(black_box(body), black_box(&mapping)).unwrap());
        });
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_solve,
    bench_apply,
    bench_crs,
    bench_convert,
    bench_parse_csv
);
criterion_main!(benches);
