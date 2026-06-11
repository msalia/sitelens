import { redirect } from 'next/navigation';

import { ResetPasswordForm } from '@/components/reset-password-form';
import { isAuthenticated } from '@/lib/auth-server';

export default async function ResetPasswordPage() {
  if (await isAuthenticated()) {
    redirect('/projects');
  }
  return <ResetPasswordForm />;
}
