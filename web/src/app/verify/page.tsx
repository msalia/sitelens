import { redirect } from 'next/navigation';

import { VerifyEmailForm } from '@/components/verify-email-form';
import { isAuthenticated } from '@/lib/auth-server';

export default async function VerifyPage() {
  if (await isAuthenticated()) {
    redirect('/projects');
  }
  return <VerifyEmailForm />;
}
