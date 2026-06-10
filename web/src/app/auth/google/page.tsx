import { IconCompass } from '@tabler/icons-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Placeholder target for the login page's "Continue with Google" button. The
// OAuth backend isn't built yet; this is the wired entry point to swap in later.
export default function GoogleAuthPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="bg-primary text-primary-foreground mb-2 flex size-10 items-center justify-center rounded-xl">
            <IconCompass className="size-5" />
          </div>
          <CardTitle>Single sign-on is coming soon</CardTitle>
          <CardDescription>
            Google sign-in isn&apos;t available yet. For now, use your email and password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className={cn(buttonVariants(), 'w-full')}>
            Back to login
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
