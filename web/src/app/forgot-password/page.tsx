import { redirect } from 'next/navigation';

import { ForgotPasswordForm } from '@/components/forgot-password-form';
import { isAuthenticated } from '@/lib/auth-server';

export default async function ForgotPasswordPage() {
  if (await isAuthenticated()) {
    redirect('/projects');
  }
  return <ForgotPasswordForm />;
}
