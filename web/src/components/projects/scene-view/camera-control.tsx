'use client';

import { IconFocusCentered } from '@tabler/icons-react';

import { CAMERA_VIEWS, type CameraView } from '@/components/projects/terrain-viewer';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Bottom-right overlay: camera viewpoint selector plus a reset-to-isometric
 * button. */
export function CameraControl({
  onViewChange,
  view,
}: {
  view: CameraView;
  onViewChange: (v: CameraView) => void;
}) {
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 z-10 flex items-center gap-2">
      <div className="pointer-events-auto">
        <Select value={view} onValueChange={(v) => onViewChange(v as CameraView)}>
          <SelectTrigger size="sm" className="bg-background w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Camera</SelectLabel>
              {CAMERA_VIEWS.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <Button
            size="icon-sm"
            variant="outline"
            className="bg-background pointer-events-auto"
            aria-label="Reset camera to default view"
            onClick={() => onViewChange('iso')}
          >
            <IconFocusCentered className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reset camera (isometric)</TooltipContent>
      </Tooltip>
    </div>
  );
}
