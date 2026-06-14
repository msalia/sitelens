import { redirect } from 'next/navigation';

import { AcceptInviteForm } from '@/components/accept-invite-form';
import { isAuthenticated } from '@/lib/auth-server';

export const metadata = {
  robots: { follow: false, index: false },
  title: 'Accept invitation',
};

export default async function AcceptInvitePage() {
  // A signed-in user already belongs to an org — send them to the app rather than
  // the invite acceptance flow (which is for new accounts).
  if (await isAuthenticated()) {
    redirect('/projects');
  }
  return <AcceptInviteForm />;
}
