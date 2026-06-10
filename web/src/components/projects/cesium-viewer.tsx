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

export interface CesiumViewerProps {
  categories: PointCategory[];
  ionToken?: string;
  /** Called with a survey point id (the entity id) when picked in 3D. */
  onSelectPoint?: (id: string) => void;
  scene: SceneData;
  /** Category ids to show; null shows all. Points without a category always show. */
  visibleCategoryIds: Set<string> | null;
}

function populate(Cesium: any, viewer: any, props: CesiumViewerProps) {
  const { categories, scene, visibleCategoryIds } = props;
  viewer.entities.removeAll();
  const colorOf = new Map(categories.map((c) => [c.id, c.color]));

  const addPoint = (
    id: string | undefined,
    label: string,
    lon: number,
    lat: number,
    height: number,
    color: string,
    size: number,
  ) => {
    viewer.entities.add({
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

  for (const cp of scene.controlPoints) {
    addPoint(undefined, cp.label, cp.longitude, cp.latitude, cp.height, CONTROL_COLOR, 12);
  }
  for (const sp of scene.surveyPoints) {
    if (visibleCategoryIds && sp.categoryId && !visibleCategoryIds.has(sp.categoryId)) {
      continue;
    }
    const color = (sp.categoryId && colorOf.get(sp.categoryId)) || DEFAULT_POINT_COLOR;
    addPoint(sp.id ?? undefined, sp.label, sp.longitude, sp.latitude, sp.height, color, 9);
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

  if (viewer.entities.values.length > 0) {
    viewer.zoomTo(viewer.entities).catch(() => {});
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
      populate(Cesium, viewer, propsRef.current);
    })();

    return () => {
      disposed = true;
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }
      viewerRef.current = null;
      link.remove();
    };
  }, []);

  // Re-populate when the scene or visibility changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const Cesium: any = await loadCesium();
      const viewer = viewerRef.current;
      if (!cancelled && viewer && !viewer.isDestroyed()) {
        populate(Cesium, viewer, props);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.scene, props.visibleCategoryIds, props.categories]);

  return <div ref={containerRef} className="h-[70vh] w-full overflow-hidden rounded-lg border" />;
}
