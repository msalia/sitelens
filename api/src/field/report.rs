//! Stakeout QC reports for an as-built comparison: a CSV (built in-process) and
//! the HTML for a PDF (rendered by the shared WeasyPrint report service,
//! foundation §8). Pure builders — the resolver does the HTTP/DB I/O.

use crate::export;
use crate::models::{
    AsBuiltBatch, BaselineScope, ComparisonRow, ComparisonStatus, ComparisonSummary,
};
use crate::report::{self, Document, Fact, StatPanel};
use crate::units::LengthUnit;

/// "projected_ground" → "Projected ground".
fn prettify(s: &str) -> String {
    let s = s.replace('_', " ");
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => s,
    }
}

fn status_class(s: ComparisonStatus) -> &'static str {
    match s {
        ComparisonStatus::Pass => "pass",
        ComparisonStatus::Warn => "warn",
        ComparisonStatus::Fail => "fail",
        ComparisonStatus::Unmatched => "unmatched",
        ComparisonStatus::NoVertical => "novert",
    }
}

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
/// service to render to PDF. The report-specific body (snapshotted tolerance
/// spec, summary stats, per-point table) is wrapped in the shared branded shell
/// (cover + running legal footer, `crate::report`). All linear values in `unit`.
/// `generated_on` (e.g. "2026-07-07") and `year` come from the resolver.
#[allow(clippy::too_many_arguments)]
pub fn comparison_html(
    project_name: &str,
    unit_label: &str,
    batch: &AsBuiltBatch,
    rows: &[ComparisonRow],
    summary: &ComparisonSummary,
    unit: LengthUnit,
    generated_on: &str,
    year: &str,
) -> String {
    let ft = |m: f64| format!("{:.4}", unit.from_meters(m));
    let f = |m: Option<f64>| {
        m.map(|v| format!("{:.4}", unit.from_meters(v)))
            .unwrap_or_else(|| "—".into())
    };

    // One result table per bucket (empty → a caller-supplied alert instead).
    let table = |bucket: &[&ComparisonRow]| -> String {
        let body: String = bucket
            .iter()
            .map(|r| {
                format!(
                    "<tr><td>{}</td><td class=\"n\">{}</td><td class=\"n\">{}</td>\
                     <td class=\"n\">{}</td><td class=\"n\">{}</td><td class=\"st {}\">{}</td></tr>",
                    esc(&r.as_built_label),
                    f(r.delta_n),
                    f(r.delta_e),
                    f(r.delta_z),
                    f(r.delta_h_radial),
                    status_class(r.status),
                    status_label(r.status),
                )
            })
            .collect();
        format!(
            "<table><thead><tr><th>Point</th><th class=\"n\">ΔN</th><th class=\"n\">ΔE</th>\
             <th class=\"n\">ΔZ</th><th class=\"n\">Radial</th><th>Status</th></tr></thead>\
             <tbody>{body}</tbody></table>"
        )
    };

    // Buckets: errors (couldn't evaluate) → failed/warned → passed.
    let errors: Vec<&ComparisonRow> = rows
        .iter()
        .filter(|r| {
            matches!(
                r.status,
                ComparisonStatus::Unmatched | ComparisonStatus::NoVertical
            )
        })
        .collect();
    let failed: Vec<&ComparisonRow> = rows
        .iter()
        .filter(|r| matches!(r.status, ComparisonStatus::Fail | ComparisonStatus::Warn))
        .collect();
    let passed: Vec<&ComparisonRow> = rows
        .iter()
        .filter(|r| matches!(r.status, ComparisonStatus::Pass))
        .collect();

    let errors_block = if errors.is_empty() {
        "<div class=\"alert-ok\">✓ No errors — every point was matched and evaluated.</div>".into()
    } else {
        table(&errors)
    };
    let failed_block = if failed.is_empty() {
        "<div class=\"alert-ok\">✓ No points failed or fell outside the warning tolerance.</div>"
            .into()
    } else {
        table(&failed)
    };
    let passed_block = if passed.is_empty() {
        "<div class=\"alert-none\">No passing points.</div>".into()
    } else {
        table(&passed)
    };

    let baseline = match batch.baseline_scope {
        BaselineScope::All => "All design points".to_string(),
        _ => "Category".to_string(),
    };
    let frame = prettify(&batch.delta_space);

    let info = format!(
        "<div><span class=\"k\">Project</span><span class=\"v\">{}</span></div>\
         <div><span class=\"k\">Source file</span><span class=\"v\">{}</span></div>\
         <div><span class=\"k\">Compared on</span><span class=\"v\">{}</span></div>\
         <div><span class=\"k\">Report unit</span><span class=\"v\">{}</span></div>\
         <div><span class=\"k\">Baseline</span><span class=\"v\">{}</span></div>\
         <div><span class=\"k\">Delta frame</span><span class=\"v\">{}</span></div>",
        esc(project_name),
        esc(&batch.source_filename),
        batch.created_at.format("%Y-%m-%d"),
        esc(unit_label),
        esc(&baseline),
        esc(&frame),
    );

    let tolerance = format!(
        "<b>Tolerance</b> — horizontal warn {thw} / fail {thf}; vertical warn {tvw} / fail {tvf} \
         ({unit}). Deltas are as-built minus design in the {frame} frame.",
        thw = ft(batch.tol_h_warn),
        thf = ft(batch.tol_h_fail),
        tvw = ft(batch.tol_v_warn),
        tvf = ft(batch.tol_v_fail),
        unit = esc(unit_label),
        frame = esc(&frame.to_lowercase()),
    );
    let fine = format!(
        "This report reproduces a snapshot taken at comparison time and is unaffected by later \
         edits to the design points. {}",
        report::DISCLAIMER
    );

    let body = format!(
        r#"<div class="cols2">
  <div><h2 class="sec">Report information</h2><div class="info">{info}</div></div>
  <div><h2 class="sec">Disclaimers</h2><div class="notebox"><p>{tolerance}</p><p class="fine">{fine}</p></div></div>
</div>
<h2 class="sec">Errors <span class="count">({ne})</span></h2>{errors_block}
<h2 class="sec">Failed or outside warning tolerance <span class="count">({nf})</span></h2>{failed_block}
<h2 class="sec">Passed <span class="count">({np})</span></h2>{passed_block}"#,
        info = info,
        tolerance = tolerance,
        fine = fine,
        ne = errors.len(),
        errors_block = errors_block,
        nf = failed.len(),
        failed_block = failed_block,
        np = passed.len(),
        passed_block = passed_block,
    );

    let matched = rows.len().saturating_sub(summary.unmatched as usize);
    let pass_pct = if rows.is_empty() {
        0
    } else {
        (summary.pass as f64 / rows.len() as f64 * 100.0).round() as i64
    };
    let doc = Document {
        title: "As-Built Stakeout Report".into(),
        subtitle: Some("Design vs. as-built comparison".into()),
        summary: format!(
            "{total} as-built point{s} compared against the design baseline \
             ({matched} matched): {pass} pass, {warn} warn, {fail} fail, {un} unmatched.",
            total = rows.len(),
            s = if rows.len() == 1 { "" } else { "s" },
            matched = matched,
            pass = summary.pass,
            warn = summary.warn,
            fail = summary.fail,
            un = summary.unmatched,
        ),
        panels: vec![
            StatPanel::new(
                "Points compared",
                rows.len().to_string(),
                "As-built points checked against the design baseline.",
                true,
            ),
            StatPanel::new(
                "Within tolerance",
                format!("{pass_pct}%"),
                format!(
                    "{} pass · {} warn · {} fail · {} unmatched",
                    summary.pass, summary.warn, summary.fail, summary.unmatched
                ),
                false,
            ),
        ],
        facts: vec![
            Fact::new("Project", project_name),
            Fact::new("Source file", &batch.source_filename),
            Fact::new(
                "Compared on",
                batch.created_at.format("%Y-%m-%d").to_string(),
            ),
            Fact::new("Report unit", unit_label),
        ],
        body_html: body,
        generated_on: generated_on.into(),
        year: year.into(),
    };
    report::render(&doc)
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
            "2026-07-07",
            "2026",
        );
        assert!(html.contains("As-Built Stakeout Report")); // shared shell title
        assert!(html.contains("My Site"));
        assert!(html.contains("PT1"));
        assert!(html.contains("pass")); // status class/label present
        assert!(html.contains("Tolerance"));
        // Wrapped in the shared branded shell (cover + running footer).
        assert!(html.contains("by KeshavTech LLC"));
        assert!(html.contains("Generated by SiteLens"));
    }
}
