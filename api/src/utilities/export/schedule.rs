//! The PDF utility schedule: an architectural plan sheet (via the reusable
//! [`crate::report::drawing`] renderer) plus dual-unit run/structure tables,
//! assembled into a [`report::Document`] for the shared WeasyPrint template.

use crate::geo::HelmertParams;
use crate::report::drawing::{
    Callout, CenterColumn, DimUnit, Entity, Geom, Grid, GridAxes, Hatch, InfoPanel, LegendItem,
    Marker, Place, Placement, Sheet, Stat, Style, Swatch, Theme,
};
use crate::report::{self, Document, Fact, StatPanel};

use super::{ExRun, ExStruct};

/// Meters → US survey feet (1 US ft = 1200/3937 m). Report tables list both.
const M_TO_USFT: f64 = 3937.0 / 1200.0;

/// Humanizes a type key for display, e.g. `"storm_sewer"` → `"Storm Sewer"`.
fn humanize(type_key: &str) -> String {
    type_key
        .split('_')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Generic marker glyph for a structure type (APWA symbol convention).
fn marker_for(type_key: &str) -> Marker {
    match type_key {
        "manhole" => Marker::Circle,
        "catch_basin" => Marker::Square,
        "valve" => Marker::Diamond,
        "hydrant" => Marker::Triangle,
        "cleanout" => Marker::Plus,
        "vault" => Marker::Bowtie,
        _ => Marker::Circle,
    }
}

/// Fallback line weight (px) from diameter — thicker for larger pipes. Used when
/// the pipe is too small to draw a to-scale casing at the sheet scale.
fn weight_for(diameter_m: Option<f64>) -> f64 {
    let inches = diameter_m.map(|d| d / 0.0254).unwrap_or(6.0);
    (1.2 + inches / 12.0 * 2.5).clamp(1.2, 6.0)
}

/// Record/imported provenance → dashed; measured (field survey / locate co.) → solid.
fn is_record(source: &str) -> bool {
    matches!(source, "dxf" | "geojson" | "other")
}

/// `"12\" PVC"`-style detail suffix from a run's size + material.
fn size_detail(diameter_m: Option<f64>, material: Option<&str>) -> String {
    let mut parts = Vec::new();
    if let Some(d) = diameter_m {
        parts.push(format!("{:.0}\"", d / 0.0254));
    }
    if let Some(m) = material {
        parts.push(m.to_string());
    }
    parts.join(" ")
}

/// Maps a free-text pipe material to a casing hatch texture (color still comes
/// from the APWA type). Best-effort keyword match; unknown → diagonal.
fn hatch_for(material: Option<&str>) -> Hatch {
    match material.map(str::to_lowercase) {
        Some(m) if m.contains("dip") || m.contains("ductile") => Hatch::Cross,
        Some(m) if m.contains("rcp") || m.contains("concrete") => Hatch::Dots,
        Some(m) if m.contains("steel") || m.contains("metal") || m.contains("iron") => {
            Hatch::Horizontal
        }
        _ => Hatch::Diagonal, // PVC / HDPE / plastic / unknown
    }
}

/// Whether a condition value is worth flagging on the plan (present + not benign).
fn flag_condition(condition: &Option<String>) -> Option<String> {
    let c = condition.as_deref()?.trim();
    let l = c.to_lowercase();
    if l.is_empty() || matches!(l.as_str(), "good" | "new" | "excellent" | "n/a") {
        None
    } else {
        Some(c.to_string())
    }
}

/// Builds the reusable architectural drawing sheet for the utility network.
/// `runs`/`structs` are the WHOLE network; entities matching the active filter
/// (`in_report`) render in APWA color, the rest gray for context.
fn network_sheet(
    project_name: &str,
    epsg: i32,
    params: Option<HelmertParams>,
    axes: &[(String, String, f64)],
    runs: &[ExRun],
    structs: &[ExStruct],
    date: &str,
) -> Sheet {
    // Plot in building-grid coordinates when a transform is solved (inverse-map
    // projected → grid), so the plan overlays the real grid axes exactly like the
    // 3D top view; otherwise fall back to projected easting/northing.
    let to_plan = |e: f64, n: f64| -> (f64, f64) {
        match &params {
            Some(p) => p.inverse(e, n),
            None => (e, n),
        }
    };
    let mut entities: Vec<Entity> = Vec::new();
    for r in runs {
        if r.vertices.len() < 2 {
            continue;
        }
        let detail = size_detail(r.diameter_m, r.material.as_deref());
        let label = if detail.is_empty() {
            r.label.clone()
        } else {
            format!("{} · {detail}", r.label)
        };
        entities.push(Entity {
            geom: Geom::Polyline(
                r.vertices
                    .iter()
                    .map(|v| to_plan(v.easting, v.northing))
                    .collect(),
            ),
            style: Style {
                color: r.color.clone(),
                weight: weight_for(r.diameter_m),
                dashed: is_record(&r.source),
                emphasis: r.in_report,
                casing_m: r.diameter_m,
                hatch: hatch_for(r.material.as_deref()),
                fill: None,
                marker: Marker::None,
                label: r.in_report.then_some(label),
            },
        });
    }
    for s in structs {
        let label = match s.rim_elev {
            Some(z) => format!("{} · RIM {z:.1}", s.label),
            None => s.label.clone(),
        };
        let (sx, sy) = to_plan(s.easting, s.northing);
        entities.push(Entity {
            geom: Geom::Point(sx, sy),
            style: Style {
                color: s.color.clone(),
                weight: 1.0,
                dashed: false,
                emphasis: s.in_report,
                casing_m: None,
                hatch: Hatch::None,
                fill: None,
                marker: marker_for(&s.type_key),
                label: s.in_report.then_some(label),
            },
        });
    }

    // Building grid → explicit axes when we're in grid space (a transform exists):
    // per the scene, `lettered` family = horizontal lines (grid-y = position),
    // `numbered` = vertical (grid-x = position). Labels are the axis labels.
    let grid_axes = params.map(|_| {
        let mut vertical = Vec::new();
        let mut horizontal = Vec::new();
        for (family, label, pos) in axes {
            if family == "numbered" {
                vertical.push((*pos, label.clone()));
            } else {
                horizontal.push((*pos, label.clone()));
            }
        }
        GridAxes {
            vertical,
            horizontal,
        }
    });

    // Legend: distinct in-report types, in first-seen order. Runs → color swatch;
    // structures → symbol swatch.
    let mut legend: Vec<LegendItem> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for r in runs.iter().filter(|r| r.in_report) {
        if !seen.iter().any(|k| k == &r.type_key) {
            seen.push(r.type_key.clone());
            legend.push(LegendItem {
                swatch: Swatch::Color(r.color.clone()),
                label: humanize(&r.type_key),
                note: None,
            });
        }
    }
    for s in structs.iter().filter(|s| s.in_report) {
        if !seen.iter().any(|k| k == &s.type_key) {
            seen.push(s.type_key.clone());
            legend.push(LegendItem {
                swatch: Swatch::Symbol(marker_for(&s.type_key), s.color.clone()),
                label: humanize(&s.type_key),
                note: None,
            });
        }
    }

    let total_len_m: f64 = runs
        .iter()
        .filter(|r| r.in_report)
        .filter_map(|r| r.length_m)
        .sum();
    let nr = runs.iter().filter(|r| r.in_report).count();
    let ns = structs.iter().filter(|s| s.in_report).count();

    // Flag noteworthy assets (a non-benign condition) with a faint primary leader
    // callout, right-justified toward the plot.
    let mut callouts: Vec<Callout> = Vec::new();
    let primary = Theme::default().primary;
    for r in runs.iter().filter(|r| r.in_report) {
        if let Some(cond) = flag_condition(&r.condition) {
            if let Some(v) = r.vertices.get(r.vertices.len() / 2) {
                callouts.push(Callout {
                    target: to_plan(v.easting, v.northing),
                    lines: vec![format!("{} — {cond}", r.label)],
                    color: primary.clone(),
                    faint: true,
                    place: Place::Auto,
                });
            }
        }
    }
    for s in structs.iter().filter(|s| s.in_report) {
        if let Some(cond) = flag_condition(&s.condition) {
            callouts.push(Callout {
                target: to_plan(s.easting, s.northing),
                lines: vec![format!("{} — {cond}", s.label)],
                color: primary.clone(),
                faint: true,
                place: Place::Auto,
            });
        }
    }

    Sheet {
        theme: Theme::default(),
        placement: Placement::Band { height_mm: 112.0 },
        info: InfoPanel {
            caption: "As-built utility network".into(),
            title: "Utility Plan".into(),
            subtitle: project_name.to_string(),
            legend,
            meta: vec![
                ("Drawing No.".into(), "UTIL-01".into()),
                ("Scale".into(), "N.T.S".into()),
                ("Date".into(), date.to_string()),
                ("CRS".into(), format!("EPSG:{epsg}")),
                ("Units".into(), "m · US ft".into()),
            ],
            notes: Vec::new(),
        },
        center: CenterColumn {
            north: true,
            scale_bar: true,
            stat: Some(Stat {
                big: format!("{:.0} ft", total_len_m * M_TO_USFT),
                sub: format!("{total_len_m:.1} m"),
                note: format!(
                    "{nr} run{} · {ns} structure{}",
                    if nr == 1 { "" } else { "s" },
                    if ns == 1 { "" } else { "s" }
                ),
            }),
        },
        grid: Grid {
            bubbles: true,
            dims: true,
            unit: DimUnit::Feet,
            axes: grid_axes,
        },
        entities,
        callouts,
        tags: Vec::new(),
    }
}

/// A `report::Document` for the utility schedule PDF (rendered by the shared
/// WeasyPrint template). `runs`/`structs` are the whole network; only entities
/// with `in_report` set are listed in the schedule (and colored in the plan),
/// mirroring the export's active type/search filter. Linear values are listed in
/// both meters and US survey feet.
#[allow(clippy::too_many_arguments)]
pub fn schedule_document(
    project_name: &str,
    epsg: i32,
    params: Option<HelmertParams>,
    axes: &[(String, String, f64)],
    runs: &[ExRun],
    structs: &[ExStruct],
    generated_on: &str,
    year: &str,
) -> Document {
    let esc = report::esc;
    let inv_runs: Vec<&ExRun> = runs.iter().filter(|r| r.in_report).collect();
    let inv_structs: Vec<&ExStruct> = structs.iter().filter(|s| s.in_report).collect();

    // Architectural plan sheet (landscape band) across the top of the first body
    // page. The sheet renders its own beige ground, so the block is borderless.
    let sheet = network_sheet(
        project_name,
        epsg,
        params,
        axes,
        runs,
        structs,
        generated_on,
    )
    .to_svg();
    let visual = format!("<div style=\"height:112mm;margin-bottom:5mm;\">{sheet}</div>");

    let mut body_runs = String::new();
    for r in &inv_runs {
        body_runs.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td><td class=\"n\">{}</td>\
             <td class=\"n\">{}</td><td class=\"n\">{}</td></tr>",
            esc(&humanize(&r.type_key)),
            esc(&r.label),
            esc(r.material.as_deref().unwrap_or("—")),
            r.diameter_m
                .map(|d| format!("{:.1}\"", d / 0.0254))
                .unwrap_or_else(|| "—".into()),
            r.length_m
                .map(|l| format!("{l:.2}"))
                .unwrap_or_else(|| "—".into()),
            r.length_m
                .map(|l| format!("{:.2}", l * M_TO_USFT))
                .unwrap_or_else(|| "—".into()),
        ));
    }
    let mut body_structs = String::new();
    for s in &inv_structs {
        body_structs.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td><td class=\"n\">{}</td><td class=\"n\">{}</td></tr>",
            esc(&humanize(&s.type_key)),
            esc(&s.label),
            esc(s.material.as_deref().unwrap_or("—")),
            s.rim_elev
                .map(|z| format!("{z:.2}"))
                .unwrap_or_else(|| "—".into()),
            s.rim_elev
                .map(|z| format!("{:.2}", z * M_TO_USFT))
                .unwrap_or_else(|| "—".into()),
        ));
    }
    let runs_table = if inv_runs.is_empty() {
        "<div class=\"alert-none\">No runs.</div>".to_string()
    } else {
        format!(
            "<table><thead><tr><th>Type</th><th>Label</th><th>Material</th>\
             <th class=\"n\">Dia.</th><th class=\"n\">Length (m)</th>\
             <th class=\"n\">Length (US ft)</th></tr></thead><tbody>{body_runs}</tbody></table>"
        )
    };
    let structs_table = if inv_structs.is_empty() {
        "<div class=\"alert-none\">No structures.</div>".to_string()
    } else {
        format!(
            "<table><thead><tr><th>Type</th><th>Label</th><th>Material</th>\
             <th class=\"n\">Rim (m)</th><th class=\"n\">Rim (US ft)</th></tr></thead>\
             <tbody>{body_structs}</tbody></table>"
        )
    };
    let total_len_m: f64 = inv_runs.iter().filter_map(|r| r.length_m).sum();
    Document {
        title: "Utility Inventory".into(),
        subtitle: Some("As-built utility schedule".into()),
        summary: format!(
            "{} run{} and {} structure{} in the as-built utility record.",
            inv_runs.len(),
            if inv_runs.len() == 1 { "" } else { "s" },
            inv_structs.len(),
            if inv_structs.len() == 1 { "" } else { "s" },
        ),
        panels: vec![
            StatPanel::new(
                "Runs",
                inv_runs.len().to_string(),
                "Linear utilities captured.",
                true,
            ),
            StatPanel::new(
                "Structures",
                inv_structs.len().to_string(),
                "Nodes (manholes, valves, …).",
                false,
            ),
        ],
        facts: vec![
            Fact::new("Project", project_name),
            Fact::new("Units", "meters & US survey feet"),
            Fact::new(
                "Total run length",
                format!("{total_len_m:.2} m / {:.2} US ft", total_len_m * M_TO_USFT),
            ),
        ],
        body_html: format!(
            "{visual}\
             <h2 class=\"sec\">Runs <span class=\"count\">({nr})</span></h2>{runs_table}\
             <h2 class=\"sec\">Structures <span class=\"count\">({ns})</span></h2>{structs_table}",
            nr = inv_runs.len(),
            ns = inv_structs.len(),
        ),
        generated_on: generated_on.into(),
        year: year.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utilities::export::fixtures::{run, structure};
    use crate::utilities::export::ExVertex;

    #[test]
    fn schedule_document_lists_items_with_both_units_and_a_plan_sheet() {
        let doc = schedule_document(
            "Site",
            32111,
            None,
            &[],
            &[run()],
            &[structure()],
            "2026-07-07",
            "2026",
        );
        assert!(doc.body_html.contains("W-1"));
        assert!(doc.body_html.contains("MH-1"));
        // Dual-unit table headers.
        assert!(doc.body_html.contains("Length (m)"));
        assert!(doc.body_html.contains("Length (US ft)"));
        assert!(doc.body_html.contains("Rim (US ft)"));
        // The reusable architectural plan sheet is embedded on top.
        assert!(doc.body_html.contains("<svg"));
        assert!(doc.body_html.contains("Utility Plan"));
        assert_eq!(doc.panels.len(), 2);
    }

    #[test]
    fn schedule_excludes_out_of_filter_items_from_tables() {
        let mut context = run();
        context.label = "CTX-1".into();
        context.in_report = false; // context-only (gray in plan, not listed)
        let doc = schedule_document(
            "Site",
            32111,
            None,
            &[],
            &[run(), context],
            &[structure()],
            "2026-07-07",
            "2026",
        );
        assert!(doc.body_html.contains("W-1"));
        assert!(!doc.body_html.contains("CTX-1")); // not in the schedule table
                                                   // Only the in-report run is counted.
        assert!(doc.summary.contains("1 run"));
    }

    /// Renders the REAL BAPS utility schedule from the dev DB to /tmp for visual
    /// QA via the WeasyPrint preview loop (no api rebuild). Pulls the project's
    /// grid axes + transform + utilities so the plan matches the 3D top view. Run:
    ///   DATABASE_URL=postgres://postgres:postgres@localhost:5442/sitelens \
    ///     cargo test -p sitelens-api dump_schedule_preview -- --ignored --nocapture
    /// then: scripts/report-preview.sh /tmp/util-schedule.html /tmp/util-schedule.pdf
    #[tokio::test]
    #[ignore]
    #[allow(clippy::type_complexity)]
    async fn dump_schedule_preview() {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5442/sitelens".into());
        let pool = sqlx::PgPool::connect(&url).await.expect("connect dev db");

        let (pid, name, epsg): (uuid::Uuid, String, i32) = sqlx::query_as(
            "SELECT id, name, epsg_code FROM projects WHERE name ILIKE '%BAPS%' \
             ORDER BY created_at LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .expect("a BAPS project");

        let params = sqlx::query_as::<_, (f64, f64, f64, f64)>(
            "SELECT scale, rotation_rad, translation_e, translation_n FROM transforms \
             WHERE project_id = $1",
        )
        .bind(pid)
        .fetch_optional(&pool)
        .await
        .unwrap()
        .map(|(s, r, tx, ty)| HelmertParams::from_components(s, r, tx, ty));

        let axes: Vec<(String, String, f64)> =
            sqlx::query_as("SELECT family, label, position FROM grid_axes WHERE project_id = $1")
                .bind(pid)
                .fetch_all(&pool)
                .await
                .unwrap();

        let colors: std::collections::HashMap<String, String> =
            sqlx::query_as::<_, (String, String)>("SELECT key, apwa_color FROM utility_types")
                .fetch_all(&pool)
                .await
                .unwrap()
                .into_iter()
                .collect();
        let color_of = |tk: &str| colors.get(tk).cloned().unwrap_or_else(|| "#6b7280".into());
        let plan_len = |vs: &[ExVertex]| -> f64 {
            vs.windows(2)
                .map(|w| {
                    ((w[1].easting - w[0].easting).powi(2)
                        + (w[1].northing - w[0].northing).powi(2))
                    .sqrt()
                })
                .sum()
        };

        let run_rows: Vec<(
            uuid::Uuid,
            String,
            String,
            Option<f64>,
            Option<String>,
            Option<f64>,
            Option<String>,
            String,
        )> = sqlx::query_as(
            "SELECT id, type_key, label, diameter, material, slope, condition, source FROM utility_runs \
                 WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at",
        )
        .bind(pid)
        .fetch_all(&pool)
        .await
        .unwrap();
        let mut runs = Vec::new();
        for (id, tk, label, diameter, material, slope, condition, source) in run_rows {
            let vrows: Vec<(f64, f64, Option<f64>)> = sqlx::query_as(
                "SELECT northing, easting, elevation FROM utility_vertices WHERE run_id = $1 ORDER BY seq",
            )
            .bind(id)
            .fetch_all(&pool)
            .await
            .unwrap();
            let vertices: Vec<ExVertex> = vrows
                .into_iter()
                .map(|(n, e, z)| ExVertex {
                    northing: n,
                    easting: e,
                    elevation: z,
                    lat: 0.0,
                    lon: 0.0,
                })
                .collect();
            let length_m = (vertices.len() >= 2).then(|| plan_len(&vertices));
            let color = color_of(&tk);
            runs.push(ExRun {
                type_key: tk,
                label,
                material,
                diameter_m: diameter,
                invert_up: None,
                invert_down: None,
                slope,
                length_m,
                tags: vec![],
                vertices,
                color,
                condition,
                source,
                in_report: true,
            });
        }

        let s_rows: Vec<(
            String,
            String,
            Option<String>,
            Option<f64>,
            f64,
            f64,
            Option<String>,
            String,
        )> = sqlx::query_as(
            "SELECT type_key, label, material, rim_elev, northing, easting, condition, source \
                 FROM utility_structures WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at",
        )
        .bind(pid)
        .fetch_all(&pool)
        .await
        .unwrap();
        let structs: Vec<ExStruct> = s_rows
            .into_iter()
            .map(|(tk, label, material, rim, n, e, condition, source)| {
                let color = color_of(&tk);
                ExStruct {
                    type_key: tk,
                    label,
                    material,
                    rim_elev: rim,
                    northing: n,
                    easting: e,
                    lat: 0.0,
                    lon: 0.0,
                    tags: vec![],
                    color,
                    condition,
                    source,
                    in_report: true,
                }
            })
            .collect();

        let doc = schedule_document(
            &name,
            epsg,
            params,
            &axes,
            &runs,
            &structs,
            "2026-07-07",
            "2026",
        );
        std::fs::write("/tmp/util-schedule.html", report::render(&doc)).unwrap();
        eprintln!(
            "wrote /tmp/util-schedule.html — {} ({} runs, {} structs, {} axes)",
            name,
            runs.len(),
            structs.len(),
            axes.len()
        );
    }
}
