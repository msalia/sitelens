import {
  IconBox,
  IconFileExport,
  IconFileImport,
  IconStack2,
  IconVectorTriangle,
  IconWorldLongitude,
} from '@tabler/icons-react';

interface Feature {
  description: string;
  Icon: typeof IconBox;
  title: string;
}

const FEATURES: Feature[] = [
  {
    description:
      'Solve the grid-to-ground tie with a 4-parameter Helmert least-squares fit, with per-point residuals and an RMS you can trust.',
    Icon: IconVectorTriangle,
    title: 'Coordinate-tie',
  },
  {
    description:
      'Convert any point across building grid, projected northing/easting, and lat-long — EPSG-selectable, grid vs ground, in feet or meters.',
    Icon: IconWorldLongitude,
    title: 'Conversion & inspector',
  },
  {
    description:
      'Bring survey-machine exports straight in via CSV or LandXML, organized into categories and groups.',
    Icon: IconFileImport,
    title: 'Point import',
  },
  {
    description:
      'See control, grid, and points in a live 3D scene over real terrain — imported elevations stay the source of truth.',
    Icon: IconBox,
    title: '3D visualization',
  },
  {
    description:
      'Drop the architect drawing into the scene, georeferenced — full DXF vector overlay aligned to your transform.',
    Icon: IconStack2,
    title: 'DXF overlay',
  },
  {
    description:
      'Export converted coordinates and full project data back out as CSV or LandXML when the job is done.',
    Icon: IconFileExport,
    title: 'Export',
  },
];

export function Features() {
  return (
    <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold tracking-wide text-indigo-400 uppercase">Features</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          From control points to a 3D site,
          <br />
          in one tool.
        </h2>
        <p className="mt-4 text-base text-white/55">
          Everything a surveyor needs to tie an architect&apos;s grid to the real world and see it
          in space.
        </p>
      </div>

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ description, Icon, title }) => (
          <div
            key={title}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-indigo-400/10 text-indigo-300">
              <Icon className="size-5" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/55">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
