'use client';

import { IconFileImport } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { cn } from '@/lib/utils';

const IMPORT_PROJECT = graphql(`
  mutation ImportProject($content: String!) {
    importProject(content: $content) {
      id
      name
    }
  }
`);

/** Always-present card on the projects page: drag-and-drop (or pick) a `.slx`
 * archive to import it as a new project. */
export function ImportProjectCard({ onImported }: { onImported: () => void }) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith('.slx')) {
      toast.error('Choose a .slx project archive.');
      return;
    }
    setBusy(true);
    try {
      const content = await file.text();
      const data = await gql(IMPORT_PROJECT, { content });
      toast.success(`Imported “${data.importProject.name}”`);
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  }

  return (
    <Card
      className={cn(
        'border-dashed transition-colors',
        dragOver && 'border-primary bg-accent/40',
        busy && 'pointer-events-none opacity-70',
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void handleFile(e.dataTransfer.files?.[0]);
      }}
    >
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-full">
          <IconFileImport className="size-5" />
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{busy ? 'Importing…' : 'Import a project'}</p>
          <p className="text-muted-foreground text-xs">
            Drag a <span className="font-medium">.slx</span> archive here, or choose a file.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <IconFileImport className="mr-1 size-4" /> Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".slx"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </CardContent>
    </Card>
  );
}
