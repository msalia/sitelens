-- Global vehicle presets for turning analysis (org_id NULL = shared preset).
-- Dimensions in meters, steering in degrees. AASHTO design-vehicle values from
-- "A Policy on Geometric Design of Highways and Streets" (Green Book, Exhibit
-- 2-2); fire apparatus from typical NFPA-class specs.
--
-- Modeling note: SiteLens v1 uses a single-unit tractrix. Cars, single-unit
-- trucks, buses, and fire apparatus are exact. Articulated tractor-trailers
-- (WB-*) are approximated as a single unit whose wheelbase is the trailer's
-- kingpin-to-rear-axle distance (which dominates off-tracking) — flagged in the
-- source string. Articulated modeling is a v2 refinement.

INSERT INTO vehicle_template
    (org_id, name, vehicle_class, wheelbase, front_overhang, rear_overhang, width,
     max_steering_angle, source)
VALUES
    (NULL, 'P (Passenger car)', 'aashto', 3.40, 0.90, 1.50, 2.10, 40,
     'AASHTO Green Book — P'),
    (NULL, 'SU-30 (Single-unit truck)', 'aashto', 6.10, 1.20, 1.80, 2.44, 31.7,
     'AASHTO Green Book — SU-30'),
    (NULL, 'BUS-40 (City transit bus)', 'aashto', 7.62, 2.10, 2.40, 2.59, 40,
     'AASHTO Green Book — CITY-BUS (40 ft)'),
    (NULL, 'WB-40 (Interm. semitrailer)', 'aashto', 8.40, 1.20, 3.00, 2.44, 20,
     'AASHTO Green Book — WB-40 (trailer off-tracking, single-unit approx)'),
    (NULL, 'WB-50 (Interm. semitrailer)', 'aashto', 11.40, 1.20, 3.00, 2.44, 20,
     'AASHTO Green Book — WB-50 (trailer off-tracking, single-unit approx)'),
    (NULL, 'WB-62 (Interstate semitrailer)', 'aashto', 14.00, 1.20, 3.00, 2.59, 20,
     'AASHTO Green Book — WB-62 (trailer off-tracking, single-unit approx)'),
    (NULL, 'Fire pumper', 'fire', 6.10, 1.50, 2.10, 2.59, 45,
     'NFPA fire pumper (typical)'),
    (NULL, 'Fire aerial (straight)', 'fire', 6.40, 2.60, 4.00, 2.59, 45,
     'NFPA aerial apparatus (typical, straight-frame)');
