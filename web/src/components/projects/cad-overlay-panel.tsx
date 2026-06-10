'use client';

import { IconTrash, IconUpload } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { CadOverlay, Project } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { gql } from '@/lib/graphql';

const UPLOAD = `
  mutation ($id: UUID!, $f: String!, $c: String!) {
    uploadDxf(projectId: $id, filename: $f, content: $c) { id }
  }`;

const SET_GEO = `
  mutation ($id: UUID!, $oe: Float, $on: Float, $rot: Float, $sc: Float, $vis: Boolean) {
    setCadGeoreference(id: $id, offsetE: $oe, offsetN: $on, rotationDeg: $rot, scale: $sc, visible: $vis) { id }
  }`;

export function CadOverlayPanel({
  onChanged,
  overlays,
  project,
}: {
  project: Project;
  overlays: CadOverlay[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    setBusy(true);
    try {
      await gql(UPLOAD, { c: await file.text(), f: file.name, id: project.id });
      toast.success('DXF uploaded');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function remove(id: string) {
    try {
      await gql('mutation ($id: UUID!) { deleteCadOverlay(id: $id) }', { id });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">DXF overlays</p>
        <Button size="sm" variant="outline" disabled={busy} render={<label htmlFor="dxf-file" />}>
          <IconUpload className="mr-1 size-4" /> {busy ? 'Uploading…' : 'Upload DXF'}
        </Button>
        <input id="dxf-file" type="file" accept=".dxf" className="hidden" onChange={onFile} />
      </div>
      {overlays.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Upload a DXF to overlay the architect drawing. Default is real-world coordinates; adjust
          offset / rotation / scale to place it.
        </p>
      ) : (
        overlays.map((o) => (
          <OverlayRow key={o.id} overlay={o} onChanged={onChanged} onDelete={() => remove(o.id)} />
        ))
      )}
    </div>
  );
}

function OverlayRow({
  onChanged,
  onDelete,
  overlay,
}: {
  overlay: CadOverlay;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [oe, setOe] = useState(String(overlay.offsetE));
  const [on, setOn] = useState(String(overlay.offsetN));
  const [rot, setRot] = useState(String(overlay.rotationDeg));
  const [sc, setSc] = useState(String(overlay.scale));
  const [saving, setSaving] = useState(false);

  async function apply(vis?: boolean) {
    setSaving(true);
    try {
      await gql(SET_GEO, {
        id: overlay.id,
        oe: parseFloat(oe) || 0,
        on: parseFloat(on) || 0,
        rot: parseFloat(rot) || 0,
        sc: parseFloat(sc) || 1,
        vis: vis ?? overlay.visible,
      });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      <div className="flex items-center justify-between">
        <span className="truncate text-sm font-medium">{overlay.originalFilename}</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={overlay.visible}
              onChange={(e) => apply(e.target.checked)}
            />
            visible
          </label>
          <Button variant="ghost" size="icon-sm" aria-label="Delete overlay" onClick={onDelete}>
            <IconTrash className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Field label="Offset E" value={oe} onChange={setOe} />
        <Field label="Offset N" value={on} onChange={setOn} />
        <Field label="Rotation°" value={rot} onChange={setRot} />
        <Field label="Scale" value={sc} onChange={setSc} />
      </div>
      <Button size="sm" variant="outline" disabled={saving} onClick={() => apply()}>
        {saving ? 'Applying…' : 'Apply georeference'}
      </Button>
    </div>
  );
}

function Field({
  label,
  onChange,
  value,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
