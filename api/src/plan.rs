//! Single source of truth for the plan → capability mapping.
//!
//! To introduce a new gated capability: add a [`Feature`] variant, its row in
//! [`Feature::meta`], and include it in [`Feature::all`]. Nothing else in the
//! codebase hard-codes feature names or plan caps — resolvers call
//! `require_feature(ctx, Feature::X)` and the web renders upgrade UI from the
//! `planCatalog` GraphQL query, so the mapping lives here and only here.
//!
//! The plan itself is *derived* from the org's Stripe subscription status (see
//! [`crate::billing`]); it is not stored.

use async_graphql::Enum;

/// The subscription plans. Binary today: free `Solo` vs paid `Crew`.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum Plan {
    /// Free tier.
    Solo,
    /// Paid tier.
    Crew,
}

impl Plan {
    /// Lowercase wire string (`"solo"` / `"crew"`) used by the legacy
    /// `billing.plan` field.
    pub const fn as_str(self) -> &'static str {
        match self {
            Plan::Solo => "solo",
            Plan::Crew => "crew",
        }
    }

    /// Per-plan usage quotas.
    pub const fn limits(self) -> Limits {
        match self {
            Plan::Solo => Limits {
                projects: 1,
                admins: 1,
                non_admin: 5,
            },
            Plan::Crew => Limits::UNLIMITED,
        }
    }

    /// Whether this plan is allowed to use `feature`.
    pub const fn allows(self, feature: Feature) -> bool {
        // Binary model: a Solo-min feature is always allowed; a Crew-min feature
        // needs the paid plan. Generalizes cleanly if more tiers are added.
        match feature.meta().min_plan {
            Plan::Solo => true,
            Plan::Crew => matches!(self, Plan::Crew),
        }
    }

    /// All plans, cheapest first — for the `planCatalog` query.
    pub const fn all() -> &'static [Plan] {
        &[Plan::Solo, Plan::Crew]
    }
}

/// Per-plan usage caps. `-1` means unlimited.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Limits {
    pub projects: i64,
    pub admins: i64,
    pub non_admin: i64,
}

impl Limits {
    pub const UNLIMITED: Limits = Limits {
        projects: -1,
        admins: -1,
        non_admin: -1,
    };
}

/// Every gated capability in SiteLens. Add a variant + a [`Feature::meta`] row to
/// gate a new feature; include it in [`Feature::all`] so it appears in the catalog.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Feature {
    /// CSV / LandXML point export + full project (`.slx`) export.
    Export,
    /// DXF overlays in the 3D scene.
    DxfOverlays,
    /// Field-survey-app interop (per-app formats) + as-built QC comparison.
    FieldExchange,
    // Planned site-analysis suite (add here when built):
    //   TurningRadius, Parking, Hydrology, Traffic, Utilities, Surfaces
}

/// Display + gating metadata for a [`Feature`].
#[derive(Copy, Clone, Debug)]
pub struct FeatureMeta {
    /// Stable id shared with the web (upgrade dialogs key off this). Snake_case.
    pub key: &'static str,
    /// Short human label, e.g. "DXF overlays".
    pub label: &'static str,
    /// One-line upgrade-dialog description / selling point.
    pub blurb: &'static str,
    /// Minimum plan required to use the feature.
    pub min_plan: Plan,
}

impl Feature {
    /// The single mapping table: feature → metadata + required plan.
    pub const fn meta(self) -> FeatureMeta {
        match self {
            Feature::Export => FeatureMeta {
                key: "export",
                label: "Exports",
                blurb: "CSV / LandXML & full project exports.",
                min_plan: Plan::Crew,
            },
            Feature::DxfOverlays => FeatureMeta {
                key: "dxf_overlays",
                label: "DXF overlays",
                blurb: "Overlay DXF drawings in the 3D view.",
                min_plan: Plan::Crew,
            },
            Feature::FieldExchange => FeatureMeta {
                key: "field_exchange",
                label: "Field Exchange",
                blurb: "Native field-app formats & as-built QC.",
                min_plan: Plan::Crew,
            },
        }
    }

    /// All gated features — for the `planCatalog` query.
    pub const fn all() -> &'static [Feature] {
        &[
            Feature::Export,
            Feature::DxfOverlays,
            Feature::FieldExchange,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_feature_has_nonempty_metadata_and_unique_keys() {
        let mut keys = Vec::new();
        for &f in Feature::all() {
            let m = f.meta();
            assert!(!m.key.is_empty(), "empty key for {f:?}");
            assert!(!m.label.is_empty(), "empty label for {f:?}");
            assert!(!m.blurb.is_empty(), "empty blurb for {f:?}");
            assert!(!keys.contains(&m.key), "duplicate feature key {}", m.key);
            keys.push(m.key);
        }
    }

    #[test]
    fn solo_is_capped_crew_is_unlimited() {
        let solo = Plan::Solo.limits();
        assert!(solo.projects > 0 && solo.admins > 0 && solo.non_admin > 0);
        assert_eq!(Plan::Crew.limits(), Limits::UNLIMITED);
    }

    #[test]
    fn plan_gating_matches_min_plan() {
        for &f in Feature::all() {
            // Crew allows everything; Solo only Solo-min features.
            assert!(Plan::Crew.allows(f));
            assert_eq!(
                Plan::Solo.allows(f),
                matches!(f.meta().min_plan, Plan::Solo)
            );
        }
    }
}
