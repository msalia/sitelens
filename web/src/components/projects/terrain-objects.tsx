'use client';

// Public surface for the 3D scene objects. Each concern lives in its own module
// under ./terrain; this barrel keeps the import path stable for terrain-viewer.
export { Fade, FadeHtml } from './terrain/fade';
export { TerrainSurface } from './terrain/terrain-surface';
export { GridLines } from './terrain/grid-lines';
export { DxfOverlays } from './terrain/dxf-overlays';
export { BUILDING_COLOR, Buildings } from './terrain/buildings';
export { Markers, useMarkers, usePresence } from './terrain/markers';
export { useBounds } from './terrain/use-bounds';
