-- Property boundary for a project: an ordered polygon of [e, n] vertices in the
-- site's projected meters (JSONB, nullable), matching how every other geometry in
-- SiteLens is stored. It is the area-of-interest for the detailed 1 m LiDAR fetch
-- that terrain-hydrology analysis runs on — NOT the coarse context terrain, which
-- stays driven by the survey-point footprint.
ALTER TABLE projects ADD COLUMN boundary jsonb;
