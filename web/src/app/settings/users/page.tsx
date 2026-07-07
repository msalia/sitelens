'use client';

import { IconKey, IconTrash, IconUserPlus, IconUsers } from '@tabler/icons-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { Me } from '@/lib/types';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { cn } from '@/lib/utils';

type Role = 'ADMIN' | 'SURVEYOR' | 'VIEWER';

type OrgMember = {
  id: string;
  email: string;
  role: Role;
  status: string;
  createdAt: string;
};

const ME = graphql(`
  query UsersMe {
    me {
      id
      orgId
      email
      role
      emailVerified
    }
  }
`);
const ORG_MEMBERS = graphql(`
  query OrgMembers {
    orgMembers {
      id
      email
      role
      status
      createdAt
    }
  }
`);
const INVITE_USER = graphql(`
  mutation InviteUser($email: String!, $role: Role!) {
    inviteUser(email: $email, role: $role) {
      user {
        id
      }
    }
  }
`);
const UPDATE_USER_ROLE = graphql(`
  mutation UpdateUserRole($userId: UUID!, $role: Role!) {
    updateUserRole(userId: $userId, role: $role) {
      id
    }
  }
`);
const ADMIN_RESET_PASSWORD = graphql(`
  mutation AdminResetPassword($userId: UUID!) {
    adminResetPassword(userId: $userId)
  }
`);
const REMOVE_USER = graphql(`
  mutation RemoveUser($userId: UUID!) {
    removeUser(userId: $userId)
  }
`);

const ROLES: { value: Role; label: string }[] = [
  { label: 'Admin', value: 'ADMIN' },
  { label: 'Surveyor', value: 'SURVEYOR' },
  { label: 'Viewer', value: 'VIEWER' },
];

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  unverified: 'bg-muted text-muted-foreground',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {status}
    </span>
  );
}

export default function UsersPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { orgMembers } = await gql(ORG_MEMBERS);
    setMembers(orgMembers as OrgMember[]);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { me } = await gql(ME);
        setMe(me);
        if (me?.role === 'ADMIN') {
          await refresh();
        }
      } catch {
        // handled by AppShell auth guard
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const adminCount = useMemo(() => members.filter((m) => m.role === 'ADMIN').length, [members]);

  async function changeRole(member: OrgMember, role: Role) {
    if (role === member.role) {
      return;
    }
    try {
      await gql(UPDATE_USER_ROLE, { role, userId: member.id });
      toast.success(`${member.email} is now ${role.toLowerCase()}.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change role');
    }
  }

  async function resetPassword(member: OrgMember) {
    try {
      await gql(ADMIN_RESET_PASSWORD, { userId: member.id });
      toast.success(`Sent a reset link to ${member.email}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send reset link');
    }
  }

  async function removeUser(member: OrgMember) {
    try {
      await gql(REMOVE_USER, { userId: member.id });
      toast.success(`Removed ${member.email}.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove user');
    }
  }

  if (loading) {
    return <div className="text-muted-foreground p-6 text-sm">Loading…</div>;
  }

  if (me?.role !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Admins only</CardTitle>
            <CardDescription>
              Only organization admins can manage users.{' '}
              <Link href="/settings" className="underline underline-offset-4">
                Back to settings
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <IconUsers className="size-6" /> Users
          </h1>
          <p className="text-muted-foreground text-sm">
            Invite teammates and manage their roles in your organization.
          </p>
        </div>
        <InviteDialog onInvited={refresh} />
      </div>

      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const isSelf = m.id === me.id;
                const isLastAdmin = m.role === 'ADMIN' && adminCount <= 1;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.email}
                      {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={m.role}
                        onValueChange={(v) => v && changeRole(m, v as Role)}
                        disabled={isLastAdmin}
                      >
                        <SelectTrigger className="w-36" aria-label={`Role for ${m.email}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button variant="ghost" size="sm" title="Send password reset link">
                                <IconKey className="size-4" /> Reset
                              </Button>
                            }
                          />
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Send a password reset link?</AlertDialogTitle>
                              <AlertDialogDescription>
                                We’ll email {m.email} a link to set a new password. Their current
                                password keeps working until they use it.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogCancel variant="default" onClick={() => resetPassword(m)}>
                                Send reset link
                              </AlertDialogCancel>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isSelf || isLastAdmin}
                                title={
                                  isSelf
                                    ? 'You can’t remove yourself'
                                    : isLastAdmin
                                      ? 'Can’t remove the last admin'
                                      : 'Remove user'
                                }
                                className="text-destructive hover:text-destructive"
                              >
                                <IconTrash className="size-4" /> Remove
                              </Button>
                            }
                          />
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {m.email}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                They’ll immediately lose access to this organization. This can’t be
                                undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogCancel
                                variant="destructive"
                                onClick={() => removeUser(m)}
                              >
                                Remove
                              </AlertDialogCancel>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function InviteDialog({ onInvited }: { onInvited: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('SURVEYOR');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await gql(INVITE_USER, { email, role });
      toast.success(`Invite sent to ${email}.`);
      setEmail('');
      setRole('SURVEYOR');
      setOpen(false);
      await onInvited();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send invite');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <IconUserPlus className="size-4" /> Invite user
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Invite a user</DialogTitle>
            <DialogDescription>
              We’ll email them a link to set a password and join your organization.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Field>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <Select value={role} onValueChange={(v) => v && setRole(v as Role)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Role</SelectLabel>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
