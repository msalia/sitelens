//! Stakeout QC reports for an as-built comparison: a CSV (built in-process) and
//! the HTML for a PDF (rendered by the shared WeasyPrint report service,
//! foundation §8). Pure builders — the resolver does the HTTP/DB I/O.

use crate::export;
use crate::models::{AsBuiltBatch, ComparisonRow, ComparisonStatus, ComparisonSummary};
use crate::units::LengthUnit;

fn status_label(s: ComparisonStatus) -> &'static str {
    match s {
        ComparisonStatus::Pass => "Pass",
        ComparisonStatus::Warn => "Warn",
        ComparisonStatus::Fail => "Fail",
        ComparisonStatus::Unmatched => "Unmatched",
        ComparisonStatus::NoVertical => "No vertical",
    }
}

/// The stakeout comparison as CSV: point, design N/E/Z, as-built N/E/Z, deltas,
/// radial, status — all linear values in `unit`.
pub fn comparison_csv(rows: &[ComparisonRow], unit: LengthUnit) -> String {
    let headers: Vec<String> = [
        "Point",
        "Design N",
        "Design E",
        "Design Z",
        "As-built N",
        "As-built E",
        "As-built Z",
        "ΔN",
        "ΔE",
        "ΔZ",
        "Radial",
        "Status",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let f = |m: Option<f64>| {
        m.map(|v| format!("{:.4}", unit.from_meters(v)))
            .unwrap_or_default()
    };

    let out: Vec<Vec<String>> = rows
        .iter()
        .map(|r| {
            vec![
                r.as_built_label.clone(),
                f(r.design_n),
                f(r.design_e),
                f(r.design_z),
                f(Some(r.as_built_n)),
                f(Some(r.as_built_e)),
                f(r.as_built_z),
                f(r.delta_n),
                f(r.delta_e),
                f(r.delta_z),
                f(r.delta_h_radial),
                status_label(r.status).to_string(),
            ]
        })
        .collect();

    export::to_csv(&headers, &out)
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The stakeout report as a self-contained HTML document for the WeasyPrint
/// service to render to PDF: project header, snapshotted tolerance spec, summary
/// stats, and the per-point table. All linear values in `unit`.
pub fn comparison_html(
    project_name: &str,
    unit_label: &str,
    batch: &AsBuiltBatch,
    rows: &[ComparisonRow],
    summary: &ComparisonSummary,
    unit: LengthUnit,
) -> String {
    let ft = |m: f64| format!("{:.4}", unit.from_meters(m));
    let f = |m: Option<f64>| {
        m.map(|v| format!("{:.4}", unit.from_meters(v)))
            .unwrap_or_else(|| "—".into())
    };

    let mut body = String::new();
    for r in rows {
        let cls = match r.status {
            ComparisonStatus::Pass => "pass",
            ComparisonStatus::Warn => "warn",
            ComparisonStatus::Fail => "fail",
            ComparisonStatus::Unmatched => "unmatched",
            ComparisonStatus::NoVertical => "novert",
        };
        body.push_str(&format!(
            "<tr><td>{}</td><td class=\"n\">{}</td><td class=\"n\">{}</td>\
             <td class=\"n\">{}</td><td class=\"n\">{}</td><td class=\"n\">{}</td>\
             <td class=\"{}\">{}</td></tr>",
            esc(&r.as_built_label),
            f(r.delta_n),
            f(r.delta_e),
            f(r.delta_z),
            f(r.delta_h_radial),
            if r.design_point_id.is_some() {
                "✓"
            } else {
                "—"
            },
            cls,
            status_label(r.status),
        ));
    }

    let max = summary.max_miss.map(ft).unwrap_or_else(|| "—".into());
    let rms = summary.rms_miss.map(ft).unwrap_or_else(|| "—".into());

    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page {{ size: letter; margin: 20mm; }}
body {{ font-family: 'DejaVu Sans', sans-serif; color: #1a1a1a; font-size: 10pt; }}
h1 {{ font-size: 16pt; margin: 0 0 2mm; }}
.meta {{ color: #555; font-size: 9pt; margin-bottom: 4mm; }}
.summary {{ margin: 4mm 0; }}
.summary span {{ display: inline-block; margin-right: 6mm; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 3mm; font-size: 9pt; }}
th, td {{ border: 1px solid #ddd; padding: 1.5mm 2mm; text-align: left; }}
th {{ background: #f2f4f7; }}
td.n {{ text-align: right; font-variant-numeric: tabular-nums; }}
.pass {{ color: #067647; }} .warn {{ color: #b54708; }} .fail {{ color: #b42318; }}
.unmatched {{ color: #667085; }} .novert {{ color: #026aa2; }}
.appendix {{ margin-top: 6mm; color: #667085; font-size: 8pt; }}
</style></head><body>
<h1>As-built stakeout report</h1>
<div class="meta">{project} · {file} · {date} · values in {unit_label}</div>
<div class="summary">
  <span><b>{pass}</b> pass</span><span><b>{warn}</b> warn</span>
  <span><b>{fail}</b> fail</span><span><b>{unmatched}</b> unmatched</span>
  <span>Max miss: <b>{max}</b></span><span>RMS miss: <b>{rms}</b></span>
</div>
<div class="meta">Tolerance — horizontal warn {thw} / fail {thf}; vertical warn {tvw} / fail {tvf}.</div>
<table>
<thead><tr><th>Point</th><th>ΔN</th><th>ΔE</th><th>ΔZ</th><th>Radial</th><th>Matched</th><th>Status</th></tr></thead>
<tbody>{body}</tbody>
</table>
<div class="appendix">Deltas are as-built minus design in the projected-ground frame.
This report reproduces a snapshot taken at comparison time and is unaffected by
later edits to the design points.</div>
</body></html>"#,
        project = esc(project_name),
        file = esc(&batch.source_filename),
        date = batch.created_at.format("%Y-%m-%d"),
        unit_label = esc(unit_label),
        pass = summary.pass,
        warn = summary.warn,
        fail = summary.fail,
        unmatched = summary.unmatched,
        max = max,
        rms = rms,
        thw = ft(batch.tol_h_warn),
        thf = ft(batch.tol_h_fail),
        tvw = ft(batch.tol_v_warn),
        tvf = ft(batch.tol_v_fail),
        body = body,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    fn row(label: &str, status: ComparisonStatus, radial: Option<f64>) -> ComparisonRow {
        ComparisonRow {
            id: Uuid::nil(),
            as_built_label: label.into(),
            as_built_n: 100.0,
            as_built_e: 200.0,
            as_built_z: Some(5.0),
            design_point_id: Some(Uuid::nil()),
            design_n: Some(100.0),
            design_e: Some(200.0),
            design_z: Some(5.0),
            match_method: crate::models::FieldMatchMethod::Number,
            delta_n: Some(0.0),
            delta_e: radial,
            delta_z: Some(0.0),
            delta_h_radial: radial,
            delta_grid_n: None,
            delta_grid_e: None,
            status,
            as_built_latitude: None,
            as_built_longitude: None,
            as_built_height: None,
            design_latitude: None,
            design_longitude: None,
            design_height: None,
        }
    }

    fn batch() -> AsBuiltBatch {
        AsBuiltBatch {
            id: Uuid::nil(),
            project_id: Uuid::nil(),
            source_filename: "field.csv".into(),
            format: crate::field::FieldFormat::Csv,
            baseline_scope: crate::models::BaselineScope::All,
            baseline_ref_id: None,
            delta_space: "projected_ground".into(),
            tol_h_warn: 0.05,
            tol_h_fail: 0.10,
            tol_v_warn: 0.05,
            tol_v_fail: 0.10,
            report_unit: LengthUnit::Meter,
            created_at: Utc::now(),
        }
    }

    fn summary() -> ComparisonSummary {
        ComparisonSummary {
            pass: 1,
            warn: 0,
            fail: 1,
            unmatched: 0,
            no_vertical: 0,
            max_miss: Some(0.2),
            rms_miss: Some(0.14),
        }
    }

    #[test]
    fn csv_has_header_and_status() {
        let rows = vec![
            row("1", ComparisonStatus::Pass, Some(0.0)),
            row("2", ComparisonStatus::Fail, Some(0.2)),
        ];
        let csv = comparison_csv(&rows, LengthUnit::Meter);
        let lines: Vec<&str> = csv.lines().collect();
        assert!(lines[0].starts_with("Point,Design N,Design E"));
        assert!(lines[0].ends_with("Radial,Status"));
        assert!(lines[1].ends_with("Pass"));
        assert!(lines[2].ends_with("Fail"));
    }

    #[test]
    fn html_includes_summary_and_rows() {
        let rows = vec![row("PT1", ComparisonStatus::Pass, Some(0.0))];
        let html = comparison_html(
            "My Site",
            "meter",
            &batch(),
            &rows,
            &summary(),
            LengthUnit::Meter,
        );
        assert!(html.contains("As-built stakeout report"));
        assert!(html.contains("My Site"));
        assert!(html.contains("PT1"));
        assert!(html.contains("pass")); // status class/label present
        assert!(html.contains("Tolerance"));
    }
}
