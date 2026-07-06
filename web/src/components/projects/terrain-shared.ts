/** Predefined camera viewpoints offered by the view selector. */
export type CameraView = 'top' | 'front' | 'back' | 'left' | 'right' | 'iso';
export const CAMERA_VIEWS: { value: CameraView; label: string }[] = [
  { label: 'Top', value: 'top' },
  { label: 'Front', value: 'front' },
  { label: 'Back', value: 'back' },
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' },
  { label: 'Isometric', value: 'iso' },
];

/** A camera-focus request: fly to a point. `nonce` re-triggers. */
export interface FocusTarget {
  height: number;
  id: string;
  lat: number;
  lon: number;
  nonce: number;
}

/** The cached DEM, ready to mesh. */
export interface TerrainData {
  /** Base64-encoded GeoTIFF bytes (from `projectTerrainContent`). */
  contentBase64: string;
}

/** An OSM building footprint (from `projectBuildingsContent`): a lat/lon ring
 * plus an estimated height in meters. Visual context only. */
export interface BuildingFootprint {
  /** Estimated height in meters. */
  height: number;
  /** Outer ring as [lat, lon] pairs. */
  poly: [number, number][];
}

/** Comparison classification driving the overlay colour. */
export type ComparisonStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNMATCHED' | 'NO_VERTICAL';

/** One as-built QC point for the 3D overlay: the as-built position, its matched
 * design position (null when unmatched), and the tolerance status. Coords are
 * `[lat, lon, height]` (degrees + meters). */
export interface ComparisonMarker {
  asBuilt: [number, number, number];
  design: [number, number, number] | null;
  key: string;
  status: ComparisonStatus;
}

/** A parsed + georeferenced DXF overlay, ready to draw. */
export interface RenderableOverlay {
  /** Flat placement height (meters) in the project's vertical datum. */
  elevation: number;
  id: string;
  offsetE: number;
  offsetN: number;
  polylines: { layer: string; points: { x: number; y: number }[] }[];
  rotationDeg: number;
  scale: number;
}
