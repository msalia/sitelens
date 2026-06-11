import { IconCompass } from '@tabler/icons-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/login-form';
import { LoginShowcase } from '@/components/login-showcase';
import { isAuthenticated } from '@/lib/auth-server';

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect('/projects');
  }
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

      {/* Cover panel — a live, orbiting 3D view of a cached iconic place. The
          gradient + survey grid stays underneath as the fallback backdrop when
          the baked showcase assets aren't present. */}
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
        <LoginShowcase />
      </div>
    </div>
  );
}
