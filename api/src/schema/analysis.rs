//! Site-analysis resolvers (Phase 1): CRUD for the `analysis` record + duplicate.
//! Everything is Crew-gated (`Feature::SiteAnalysis`) and org/project scoped;
//! mutations also require an editor role + an active subscription. No compute yet —
//! `create`/`update` persist a drawn `draft`; the per-type run mutations land in
//! later phases.
use serde_json::{json, Value};

use super::*;
use crate::models::{Analysis, AnalysisInput, AnalysisStatus, AnalysisType};

/// Read columns for an `analysis` row, in the order [`row_to_analysis`] expects.
const ANALYSIS_COLUMNS: &str = "id, project_id, type, name, status, params, input_geometry, \
     result, result_geometry, error, created_at, updated_at";

type AnalysisRow = (
    Uuid,           // id
    Uuid,           // project_id
    String,         // type
    String,         // name
    String,         // status
    Value,          // params (jsonb)
    Option<Value>,  // input_geometry (jsonb)
    Value,          // result (jsonb)
    Option<Value>,  // result_geometry (jsonb)
    Option<String>, // error
    DateTime<Utc>,  // created_at
    DateTime<Utc>,  // updated_at
);

fn row_to_analysis(r: AnalysisRow) -> Analysis {
    Analysis {
        id: r.0,
        project_id: r.1,
        kind: AnalysisType::from_db_str(&r.2),
        name: r.3,
        status: AnalysisStatus::from_db_str(&r.4),
        params: r.5.to_string(),
        input_geometry: r.6.map(|v| v.to_string()),
        result: r.7.to_string(),
        result_geometry: r.8.map(|v| v.to_string()),
        error: r.9,
        created_at: r.10,
        updated_at: r.11,
    }
}

/// Parses a JSON-object string param (`params`), defaulting to `{}` on empty.
fn parse_json_object(s: &str) -> Result<Value> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(s).map_err(|e| async_graphql::Error::new(format!("invalid JSON: {e}")))
}

/// Parses an optional JSON geometry string.
fn parse_json_opt(s: &Option<String>) -> Result<Option<Value>> {
    match s.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => Ok(Some(serde_json::from_str(s).map_err(|e| {
            async_graphql::Error::new(format!("invalid geometry JSON: {e}"))
        })?)),
        None => Ok(None),
    }
}

/// Resolves an analysis's project (org-scoped); errors if not in the org.
async fn analysis_in_org(pool: &PgPool, id: Uuid, org_id: Uuid) -> Result<Uuid> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT a.project_id FROM analysis a JOIN projects p ON p.id = a.project_id \
         WHERE a.id = $1 AND p.org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    Ok(found_in_org(row, "analysis")?.0)
}

#[derive(Default)]
pub struct AnalysisQuery;

#[Object]
impl AnalysisQuery {
    /// Every analysis in a project (newest first).
    async fn analyses(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<Analysis>> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<AnalysisRow> = sqlx::query_as(&format!(
            "SELECT {ANALYSIS_COLUMNS} FROM analysis WHERE project_id = $1 \
             ORDER BY created_at DESC"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(row_to_analysis).collect())
    }

    /// A single analysis by id (org-scoped).
    async fn analysis(&self, ctx: &Context<'_>, id: Uuid) -> Result<Analysis> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<AnalysisRow> = sqlx::query_as(&format!(
            "SELECT {} FROM analysis a JOIN projects p ON p.id = a.project_id \
             WHERE a.id = $1 AND p.org_id = $2",
            qualify_columns(ANALYSIS_COLUMNS, "a")
        ))
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        Ok(row_to_analysis(found_in_org(row, "analysis")?))
    }
}

#[derive(Default)]
pub struct AnalysisMutation;

#[Object]
impl AnalysisMutation {
    /// Creates a draft analysis from a drawn input + params.
    async fn create_analysis(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: AnalysisInput,
    ) -> Result<Analysis> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let params = parse_json_object(&input.params)?;
        let geometry = parse_json_opt(&input.input_geometry)?;
        let row: AnalysisRow = sqlx::query_as(&format!(
            "INSERT INTO analysis (project_id, type, name, status, params, input_geometry, created_by) \
             VALUES ($1, $2, $3, 'draft', $4, $5, $6) RETURNING {ANALYSIS_COLUMNS}"
        ))
        .bind(project_id)
        .bind(input.kind.as_db_str())
        .bind(&input.name)
        .bind(sqlx::types::Json(params))
        .bind(geometry.map(sqlx::types::Json))
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_analysis(row))
    }

    /// Updates a draft analysis's name / params / drawn input (resets it to draft).
    async fn update_analysis(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        input: AnalysisInput,
    ) -> Result<Analysis> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        analysis_in_org(pool, id, auth.org_id).await?;
        let params = parse_json_object(&input.params)?;
        let geometry = parse_json_opt(&input.input_geometry)?;
        let row: AnalysisRow = sqlx::query_as(&format!(
            "UPDATE analysis SET type = $2, name = $3, params = $4, input_geometry = $5, \
               status = 'draft', result = '{{}}', result_geometry = NULL, error = NULL, \
               updated_at = now() \
             WHERE id = $1 RETURNING {ANALYSIS_COLUMNS}"
        ))
        .bind(id)
        .bind(input.kind.as_db_str())
        .bind(&input.name)
        .bind(sqlx::types::Json(params))
        .bind(geometry.map(sqlx::types::Json))
        .fetch_one(pool)
        .await?;
        Ok(row_to_analysis(row))
    }

    /// Deletes an analysis.
    async fn delete_analysis(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let row: Option<(Uuid,)> = sqlx::query_as(
            "DELETE FROM analysis a USING projects p \
             WHERE a.id = $1 AND p.id = a.project_id AND p.org_id = $2 RETURNING a.id",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        found_in_org(row, "analysis")?;
        Ok(true)
    }

    /// Clones an analysis (input + params) as a fresh draft — informal scenarios.
    async fn duplicate_analysis(&self, ctx: &Context<'_>, id: Uuid) -> Result<Analysis> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        analysis_in_org(pool, id, auth.org_id).await?;
        // Copy type/name/params/input_geometry; reset status + results.
        let row: AnalysisRow = sqlx::query_as(&format!(
            "INSERT INTO analysis (project_id, type, name, status, params, input_geometry, created_by) \
             SELECT project_id, type, name || ' (copy)', 'draft', params, input_geometry, $2 \
             FROM analysis WHERE id = $1 RETURNING {ANALYSIS_COLUMNS}"
        ))
        .bind(id)
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_analysis(row))
    }
}
