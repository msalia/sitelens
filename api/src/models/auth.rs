use async_graphql::SimpleObject;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::auth::Role;

/// A user as exposed over GraphQL. Never carries the password hash or tokens.
#[derive(SimpleObject, Clone)]
pub struct User {
    pub id: Uuid,
    pub org_id: Uuid,
    pub email: String,
    pub role: Role,
    pub email_verified: bool,
    pub created_at: DateTime<Utc>,
}

/// An organization as exposed over GraphQL.
#[derive(SimpleObject, Clone)]
pub struct Org {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

/// Row shape for safe user reads.
#[derive(sqlx::FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub email: String,
    pub role: String,
    pub email_verified: bool,
    pub created_at: DateTime<Utc>,
}

impl From<UserRow> for User {
    fn from(r: UserRow) -> Self {
        User {
            id: r.id,
            org_id: r.org_id,
            email: r.email,
            role: Role::parse(&r.role).unwrap_or(Role::Viewer),
            email_verified: r.email_verified,
            created_at: r.created_at,
        }
    }
}

/// An org member for the admin user-management roster, with a derived status.
#[derive(SimpleObject, Clone)]
pub struct OrgMember {
    pub id: Uuid,
    pub email: String,
    pub role: Role,
    /// Derived: `active` (verified), `pending` (invite not yet accepted), or
    /// `unverified` (signed up but email not verified).
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct OrgMemberRow {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

impl From<OrgMemberRow> for OrgMember {
    fn from(r: OrgMemberRow) -> Self {
        OrgMember {
            id: r.id,
            email: r.email,
            role: Role::parse(&r.role).unwrap_or(Role::Viewer),
            status: r.status,
            created_at: r.created_at,
        }
    }
}

/// Row shape for login: includes the password hash and verification state.
#[derive(sqlx::FromRow)]
pub struct LoginRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub role: String,
    pub email_verified: bool,
    pub password_hash: Option<String>,
}

/// Result returned from signup. The verification token is surfaced here only
/// because no email provider is wired yet (deferred); it will be delivered by
/// email in a later phase.
#[derive(SimpleObject)]
pub struct SignupResult {
    pub user: User,
    pub org: Org,
    pub verification_token: String,
}

/// Result returned from inviting a user. The invite token is surfaced for the
/// same reason as above (no email provider yet).
#[derive(SimpleObject)]
pub struct InviteResult {
    pub user: User,
    pub invite_token: String,
}
