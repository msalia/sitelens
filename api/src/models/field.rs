use async_graphql::{Enum, SimpleObject};

use crate::field::FieldFormat;
use crate::units::LengthUnit;

use super::ExportSpace;

/// A curated field-app export preset, surfaced to the client for the picker.
#[derive(SimpleObject)]
pub struct FieldPresetInfo {
    pub id: String,
    pub app: String,
    pub format: FieldFormat,
    pub default_space: ExportSpace,
    pub default_unit: LengthUnit,
    pub description: String,
}

/// An encoded field file ready for download.
#[derive(SimpleObject)]
pub struct FieldExportResult {
    pub filename: String,
    pub mime_type: String,
    pub content_base64: String,
}

/// Which point attribute becomes the exported feature code.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum CodeField {
    /// The point's free-text description (default).
    Description,
    /// The point's category name.
    Category,
}
