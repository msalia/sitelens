-- Per-overlay elevation (meters) so a DXF can be placed flat at any Z as a
-- reference plane — e.g. a floor plan at the building's floor level, or lifted
-- above the terrain for visibility. 0 = the project's vertical datum origin.
ALTER TABLE cad_overlays
    ADD COLUMN elevation DOUBLE PRECISION NOT NULL DEFAULT 0;
