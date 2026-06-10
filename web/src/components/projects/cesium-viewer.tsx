'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Cesium is dynamically imported and untyped at this boundary, hence `any`.

import { useEffect, useRef } from 'react';

import type { PointCategory, SceneData } from '@/lib/types';

// Cesium loads its workers/assets from this base path (see scripts/copy-cesium.mjs).
if (typeof window !== 'undefined') {
  (window as any).CESIUM_BASE_URL = '/cesium';
}

/**
 * Loads the prebuilt Cesium bundle from /cesium via a script tag rather than
 * importing the npm module. This avoids bundling Cesium's internals (KML/zip
 * workers) which don't resolve cleanly under the Next bundler.
 */
function loadCesium(): Promise<any> {
  const w = window as any;
  if (w.Cesium) {
    return Promise.resolve(w.Cesium);
  }
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('cesium-script') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(w.Cesium));
      existing.addEventListener('error', () => reject(new Error('Failed to load Cesium')));
      return;
    }
    const s = document.createElement('script');
    s.id = 'cesium-script';
    s.src = '/cesium/Cesium.js';
    s.async = true;
    s.onload = () => resolve(w.Cesium);
    s.onerror = () => reject(new Error('Failed to load Cesium'));
    document.head.appendChild(s);
  });
}

const CONTROL_COLOR = '#ef4444';
const DEFAULT_POINT_COLOR = '#38bdf8';
const GRID_COLOR = '#64748b';

/** A DXF overlay ready to render: geometry + georeference. */
export interface RenderableOverlay {
  hiddenLayers: string[];
  id: string;
  offsetE: number;
  offsetN: number;
  polylines: { layer: string; points: { x: number; y: number }[] }[];
  rotationDeg: number;
  scale: number;
}

export interface CesiumViewerProps {
  /** When set, the viewer assigns a function that downloads the canvas as a PNG. */
  captureRef?: React.MutableRefObject<(() => void) | null>;
  categories: PointCategory[];
  ionToken?: string;
  /** Called with a survey point id (the entity id) when picked in 3D. */
  onSelectPoint?: (id: string) => void;
  overlays?: RenderableOverlay[];
  scene: SceneData;
  /** Category ids to show; null shows all. Points without a category always show. */
  visibleCategoryIds: Set<string> | null;
}

function populate(Cesium: any, viewer: any, pointSource: any, props: CesiumViewerProps) {
  const { categories, scene, visibleCategoryIds } = props;
  viewer.entities.removeAll();
  pointSource.entities.removeAll();
  const colorOf = new Map(categories.map((c) => [c.id, c.color]));

  const addPoint = (
    collection: any,
    id: string | undefined,
    label: string,
    lon: number,
    lat: number,
    height: number,
    color: string,
    size: number,
  ) => {
    collection.add({
      id,
      label: {
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        fillColor: Cesium.Color.WHITE,
        font: '12px sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -16),
        scale: 0.8,
        showBackground: true,
        text: label,
      },
      name: label,
      point: {
        color: Cesium.Color.fromCssColorString(color),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        pixelSize: size,
      },
      position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    });
  };

  // Control points stay on the main collection (always visible, low count).
  for (const cp of scene.controlPoints) {
    addPoint(
      viewer.entities,
      undefined,
      cp.label,
      cp.longitude,
      cp.latitude,
      cp.height,
      CONTROL_COLOR,
      12,
    );
  }
  // Survey points (potentially many) go on the clustered data source.
  for (const sp of scene.surveyPoints) {
    if (visibleCategoryIds && sp.categoryId && !visibleCategoryIds.has(sp.categoryId)) {
      continue;
    }
    const color = (sp.categoryId && colorOf.get(sp.categoryId)) || DEFAULT_POINT_COLOR;
    addPoint(
      pointSource.entities,
      sp.id ?? undefined,
      sp.label,
      sp.longitude,
      sp.latitude,
      sp.height,
      color,
      9,
    );
  }
  for (const line of scene.gridLines) {
    viewer.entities.add({
      polyline: {
        material: Cesium.Color.fromCssColorString(GRID_COLOR).withAlpha(0.7),
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(
          line.coordinates.flatMap((c) => [c.longitude, c.latitude, c.height]),
        ),
        width: 1.5,
      },
    });
  }

  // DXF overlays — placed in a local east-north frame anchored at the origin.
  const op = scene.origin;
  const opE = scene.originProjectedE;
  const opN = scene.originProjectedN;
  if (op && opE !== null && opN !== null && props.overlays?.length) {
    const originCart = Cesium.Cartesian3.fromDegrees(op.longitude, op.latitude, 0);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(originCart);
    for (const ov of props.overlays) {
      const hidden = new Set(ov.hiddenLayers);
      const theta = (ov.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      for (const pl of ov.polylines) {
        if (hidden.has(pl.layer)) {
          continue;
        }
        const positions = pl.points.map((p) => {
          const worldE = ov.offsetE + ov.scale * (p.x * cos - p.y * sin);
          const worldN = ov.offsetN + ov.scale * (p.x * sin + p.y * cos);
          const local = new Cesium.Cartesian3(worldE - opE, worldN - opN, 0);
          return Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3());
        });
        viewer.entities.add({
          polyline: {
            material: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.9),
            positions,
            width: 1,
          },
        });
      }
    }
  }

  const hasMain = viewer.entities.values.length > 0;
  const hasPoints = pointSource.entities.values.length > 0;
  if (hasMain || hasPoints) {
    const targets = [];
    if (hasMain) {
      targets.push(viewer.entities);
    }
    if (hasPoints) {
      targets.push(pointSource);
    }
    viewer.zoomTo(targets).catch(() => {});
  } else if (scene.origin) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        scene.origin.longitude,
        scene.origin.latitude,
        2000,
      ),
    });
  }
}

export function CesiumViewer(props: CesiumViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const pointSourceRef = useRef<any>(null);
  const propsRef = useRef(props);

  // Keep the latest props available to the long-lived viewer callbacks.
  useEffect(() => {
    propsRef.current = props;
  });

  // Create the viewer once.
  useEffect(() => {
    let viewer: any;
    let disposed = false;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/cesium/Widgets/widgets.css';
    document.head.appendChild(link);

    (async () => {
      const Cesium: any = await loadCesium();
      if (disposed || !containerRef.current) {
        return;
      }
      viewer = new Cesium.Viewer(containerRef.current, {
        animation: false,
        baseLayer: new Cesium.ImageryLayer(
          new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
        ),
        baseLayerPicker: false,
        // preserveDrawingBuffer lets us read the canvas back for PNG snapshots.
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: true,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: true,
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        timeline: false,
      });
      viewerRef.current = viewer;

      // Survey points live on a clustered data source so dense sites stay legible
      // and fast — nearby points collapse into a labelled cluster when zoomed out.
      const pointSource = new Cesium.CustomDataSource('survey-points');
      viewer.dataSources.add(pointSource);
      const clustering = pointSource.clustering;
      clustering.enabled = true;
      clustering.pixelRange = 40;
      clustering.minimumClusterSize = 5;
      clustering.clusterEvent.addEventListener((entities: any[], cluster: any) => {
        cluster.label.show = true;
        cluster.label.text = String(entities.length);
        cluster.label.font = 'bold 13px sans-serif';
        cluster.label.fillColor = Cesium.Color.WHITE;
        cluster.label.disableDepthTestDistance = Number.POSITIVE_INFINITY;
        cluster.point.show = true;
        cluster.point.pixelSize = 18;
        cluster.point.color = Cesium.Color.fromCssColorString('#0ea5e9');
        cluster.point.outlineColor = Cesium.Color.WHITE;
        cluster.point.outlineWidth = 2;
      });
      pointSourceRef.current = pointSource;

      // Expose a snapshot function: force a render, then download the canvas.
      if (propsRef.current.captureRef) {
        propsRef.current.captureRef.current = () => {
          viewer.render();
          const url = viewer.canvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.href = url;
          a.download = 'sitelens-scene.png';
          a.click();
        };
      }

      viewer.selectedEntityChanged.addEventListener((entity: any) => {
        const id = entity?.id;
        if (typeof id === 'string') {
          propsRef.current.onSelectPoint?.(id);
        }
      });

      const token = propsRef.current.ionToken;
      if (token) {
        Cesium.Ion.defaultAccessToken = token;
        try {
          viewer.terrainProvider = await Cesium.createWorldTerrainAsync();
        } catch {
          /* keep ellipsoid terrain */
        }
      }
      populate(Cesium, viewer, pointSource, propsRef.current);
    })();

    const captureRef = propsRef.current.captureRef;
    return () => {
      disposed = true;
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }
      viewerRef.current = null;
      pointSourceRef.current = null;
      if (captureRef) {
        captureRef.current = null;
      }
      link.remove();
    };
  }, []);

  // Re-populate when the scene or visibility changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const Cesium: any = await loadCesium();
      const viewer = viewerRef.current;
      const pointSource = pointSourceRef.current;
      if (!cancelled && viewer && pointSource && !viewer.isDestroyed()) {
        populate(Cesium, viewer, pointSource, props);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.scene, props.visibleCategoryIds, props.categories, props.overlays]);

  return <div ref={containerRef} className="h-[70vh] w-full overflow-hidden rounded-lg border" />;
}
