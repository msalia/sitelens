import { IconCompass } from '@tabler/icons-react';
import Link from 'next/link';

import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <IconCompass className="size-4" />
            </div>
            SiteLens
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <LoginForm />
          </div>
        </div>
      </div>

      {/* Cover panel — branded gradient + survey grid in lieu of a photo asset. */}
      <div className="bg-muted relative hidden overflow-hidden lg:block">
        <div className="from-primary/25 via-background to-background absolute inset-0 bg-gradient-to-br" />
        <div
          className="absolute inset-0 opacity-[0.18] dark:opacity-10"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--color-foreground) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        {/* A few "control point" ticks to evoke a survey tie. */}
        <div className="bg-primary absolute left-[20%] top-[30%] size-2 rounded-full" />
        <div className="bg-primary absolute left-[64%] top-[22%] size-2 rounded-full" />
        <div className="bg-primary absolute left-[44%] top-[68%] size-2 rounded-full" />
        <div className="relative flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
          <div className="bg-primary text-primary-foreground flex size-12 items-center justify-center rounded-xl">
            <IconCompass className="size-7" />
          </div>
          <p className="text-2xl font-semibold tracking-tight">SiteLens</p>
          <p className="text-muted-foreground max-w-xs text-sm text-balance">
            Tie the building grid to the real world. Solve, convert, and visualize survey
            coordinates in 3D.
          </p>
        </div>
      </div>
    </div>
  );
}
