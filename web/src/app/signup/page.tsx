import { redirect } from 'next/navigation';

import { SignupForm } from '@/components/signup-form';
import { isAuthenticated } from '@/lib/auth-server';

export default async function SignupPage() {
  if (await isAuthenticated()) {
    redirect('/projects');
  }
  return <SignupForm />;
}
