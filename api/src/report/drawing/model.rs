//! Data model for the plan-view drawing sheet — the public, domain-agnostic API
//! a caller populates. No rendering logic lives here.

/// Meters → US survey feet.
const M_TO_USFT: f64 = 3937.0 / 1200.0;

/// Sheet palette. Defaults match the SiteLens brand; override per call.
#[derive(Clone)]
pub struct Theme {
    /// Annotation/indicator accent (grid, dims, labels).
    pub primary: String,
    /// Structure outlines + dark text.
    pub ink: String,
    /// Context (non-emphasized) geometry.
    pub gray: String,
    /// Muted labels / graduations.
    pub mute: String,
    /// Sheet background block.
    pub bg: String,
}

impl Default for Theme {
    fn default() -> Self {
        Theme {
            primary: "#6366f1".into(),
            ink: "#111827".into(),
            gray: "#b4b8c0".into(),
            mute: "#6b7280".into(),
            bg: "#fff8e7".into(), // Cosmic Latte
        }
    }
}

/// Where the sheet sits in the PDF (drives the SVG aspect ratio).
pub enum Placement {
    /// A landscape band inside the (portrait) page, `height_mm` tall.
    Band { height_mm: f64 },
    /// A full page, optionally rotated to landscape.
    FullPage { landscape: bool },
}

/// Units for the dimension chains + scale bar.
#[derive(Clone, Copy)]
pub enum DimUnit {
    Feet,
    Meters,
}

impl DimUnit {
    pub(super) fn conv(self, m: f64) -> f64 {
        match self {
            DimUnit::Feet => m * M_TO_USFT,
            DimUnit::Meters => m,
        }
    }
    pub(super) fn label(self) -> &'static str {
        match self {
            DimUnit::Feet => "ft",
            DimUnit::Meters => "m",
        }
    }
}

/// Generic point marker (a feature maps its own types onto these shapes).
#[derive(Clone, Copy, PartialEq)]
pub enum Marker {
    Circle,
    Square,
    Diamond,
    Triangle,
    Bowtie,
    Plus,
    None,
}

/// Planar geometry (world meters: x = easting, y = northing; y flips to north-up).
pub enum Geom {
    Polyline(Vec<(f64, f64)>),
    Point(f64, f64),
    Polygon(Vec<(f64, f64)>),
}

/// Fill texture for a casing/polygon body. A feature maps its own attributes
/// (e.g. pipe material) onto these; the renderer supplies the SVG patterns.
#[derive(Clone, Copy, PartialEq)]
pub enum Hatch {
    None,
    Diagonal,
    Cross,
    Dots,
    Horizontal,
}

/// How one entity is drawn.
pub struct Style {
    /// Stroke / marker fill when emphasized.
    pub color: String,
    /// Fallback stroke width (px) for lines when no casing is drawn.
    pub weight: f64,
    pub dashed: bool,
    /// false → rendered gray (context).
    pub emphasis: bool,
    /// Real-world width (m) to draw a to-scale pipe casing + hatch, when large
    /// enough at the sheet scale; else the line falls back to `weight`.
    pub casing_m: Option<f64>,
    /// Texture drawn inside a casing/polygon body (e.g. material → hatch).
    pub hatch: Hatch,
    /// Polygon fill color (defaults to a tint of `color`).
    pub fill: Option<String>,
    pub marker: Marker,
    pub label: Option<String>,
}

impl Style {
    /// A plain emphasized line in `color`.
    pub fn line(color: impl Into<String>, weight: f64) -> Self {
        Style {
            color: color.into(),
            weight,
            dashed: false,
            emphasis: true,
            casing_m: None,
            hatch: Hatch::Diagonal,
            fill: None,
            marker: Marker::None,
            label: None,
        }
    }
}

/// Text justification for a callout, relative to its anchor point.
#[derive(Clone, Copy, PartialEq)]
pub enum Justify {
    Left,
    Right,
}

/// How a callout is placed relative to its target.
pub enum Place {
    /// The renderer chooses the side, routes an elbow leader to the nearer
    /// margin, and de-collides against other auto callouts. For auto-generated
    /// drawings where nothing hand-positions the labels.
    Auto,
    /// An explicit leader: horizontal (or `vertical`) toward `justify`.
    Leader { vertical: bool, justify: Justify },
    /// Text only, no leader, offset toward `justify`.
    Note { justify: Justify },
}

/// A generic annotation: multi-line text with an optional leader to a world
/// point, in a caller-chosen color/weight. Composes the reference's styles: a
/// gray note, a bold primary leader, or a faint primary description.
pub struct Callout {
    /// World point (x = easting/grid-x, y = northing/grid-y) being annotated.
    pub target: (f64, f64),
    /// One or more stacked text lines.
    pub lines: Vec<String>,
    /// Text + leader color (e.g. theme primary, or a muted gray).
    pub color: String,
    /// Lighter weight + reduced opacity (secondary description text).
    pub faint: bool,
    pub place: Place,
}

/// A hexagonal detail/section reference tag (e.g. "A2") at a world point.
pub struct Tag {
    pub at: (f64, f64),
    pub code: String,
}

pub struct Entity {
    pub geom: Geom,
    pub style: Style,
}

/// A legend swatch: a filled color chip or a symbol.
pub enum Swatch {
    Color(String),
    Symbol(Marker, String),
}

pub struct LegendItem {
    pub swatch: Swatch,
    pub label: String,
    pub note: Option<String>,
}

/// The big center-column callout.
pub struct Stat {
    pub big: String,
    pub sub: String,
    pub note: String,
}

pub struct CenterColumn {
    pub north: bool,
    pub scale_bar: bool,
    pub stat: Option<Stat>,
}

/// Explicit grid axes (e.g. a project's building grid), in world coordinates.
/// `vertical` lines sit at world-x = pos; `horizontal` at world-y = pos.
pub struct GridAxes {
    pub vertical: Vec<(f64, String)>,
    pub horizontal: Vec<(f64, String)>,
}

pub struct Grid {
    pub bubbles: bool,
    pub dims: bool,
    pub unit: DimUnit,
    /// When set, draw these real axes/labels; otherwise auto-derive a coordinate
    /// grid with lettered/numbered labels.
    pub axes: Option<GridAxes>,
}

pub struct InfoPanel {
    pub caption: String,
    pub title: String,
    pub subtitle: String,
    pub legend: Vec<LegendItem>,
    pub meta: Vec<(String, String)>,
    pub notes: Vec<String>,
}

pub struct Sheet {
    pub theme: Theme,
    pub placement: Placement,
    pub info: InfoPanel,
    pub center: CenterColumn,
    pub grid: Grid,
    pub entities: Vec<Entity>,
    /// Leader/text callouts drawn over the plot.
    pub callouts: Vec<Callout>,
    /// Hexagonal detail/section tags drawn over the plot.
    pub tags: Vec<Tag>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dim_unit_converts_and_labels() {
        assert!((DimUnit::Feet.conv(1.0) - 3.280_833).abs() < 1e-4);
        assert_eq!(DimUnit::Meters.conv(12.5), 12.5);
        assert_eq!(DimUnit::Feet.label(), "ft");
        assert_eq!(DimUnit::Meters.label(), "m");
    }

    #[test]
    fn theme_default_is_brand() {
        let t = Theme::default();
        assert_eq!(t.primary, "#6366f1");
        assert_eq!(t.bg, "#fff8e7");
    }

    #[test]
    fn style_line_is_emphasized_plain() {
        let s = Style::line("#2563eb", 2.0);
        assert!(s.emphasis && !s.dashed);
        assert!(s.casing_m.is_none() && s.label.is_none());
        assert!(matches!(s.marker, Marker::None));
    }
}
