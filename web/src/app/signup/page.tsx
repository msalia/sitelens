import { redirect } from 'next/navigation';

import { SignupForm } from '@/components/signup-form';
import { isAuthenticated } from '@/lib/auth-server';

export const metadata = {
  robots: { follow: false, index: false },
  title: 'Sign up',
};

export default async function SignupPage() {
  if (await isAuthenticated()) {
    redirect('/projects');
  }
  return <SignupForm />;
}
