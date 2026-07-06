//! Append-only change logging for utility records. `diff` computes a field-level
//! before/after (pure); `log` appends one `utility_audit` row. Every run/
//! structure mutation calls `log` so the record is defensible years later.

use serde_json::{Map, Value};
use uuid::Uuid;

/// A field-level before/after diff of two JSON objects: for each key whose value
/// changed (in either object), `{ "<key>": { "before": …, "after": … } }`.
/// Missing sides are `null` — so a create (before `{}`) or delete (after `{}`)
/// records every field. Non-object inputs are treated as empty.
pub fn diff(before: &Value, after: &Value) -> Value {
    let empty = Map::new();
    let b = before.as_object().unwrap_or(&empty);
    let a = after.as_object().unwrap_or(&empty);
    let mut out = Map::new();
    for key in b.keys().chain(a.keys()) {
        if out.contains_key(key) {
            continue;
        }
        let bv = b.get(key).unwrap_or(&Value::Null);
        let av = a.get(key).unwrap_or(&Value::Null);
        if bv != av {
            out.insert(
                key.clone(),
                serde_json::json!({ "before": bv, "after": av }),
            );
        }
    }
    Value::Object(out)
}

/// Appends one audit row. Works with a pool or a transaction (`&mut *tx`).
pub async fn log<'e, E>(
    exec: E,
    project_id: Uuid,
    entity_type: &str,
    entity_id: Uuid,
    action: &str,
    changed_by: Option<Uuid>,
    diff: &Value,
) -> Result<(), sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    sqlx::query(
        "INSERT INTO utility_audit \
           (project_id, entity_type, entity_id, action, changed_by, diff) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(project_id)
    .bind(entity_type)
    .bind(entity_id)
    .bind(action)
    .bind(changed_by)
    .bind(sqlx::types::Json(diff))
    .execute(exec)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn diff_reports_only_changed_fields() {
        let before = json!({ "material": "PVC", "diameter": 8, "owner": "City" });
        let after = json!({ "material": "PVC", "diameter": 10, "owner": "City" });
        let d = diff(&before, &after);
        assert_eq!(d, json!({ "diameter": { "before": 8, "after": 10 } }));
    }

    #[test]
    fn create_records_every_field() {
        let d = diff(&json!({}), &json!({ "material": "PVC", "diameter": 8 }));
        assert_eq!(
            d,
            json!({
                "material": { "before": null, "after": "PVC" },
                "diameter": { "before": null, "after": 8 },
            })
        );
    }

    #[test]
    fn delete_records_removed_fields() {
        let d = diff(&json!({ "material": "PVC" }), &json!({}));
        assert_eq!(d, json!({ "material": { "before": "PVC", "after": null } }));
    }

    #[test]
    fn identical_objects_have_empty_diff() {
        let same = json!({ "a": 1, "b": [1, 2] });
        assert_eq!(diff(&same, &same), json!({}));
    }
}
