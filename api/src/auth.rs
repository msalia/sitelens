//! Authentication primitives: roles, password hashing, JWT sessions, and the
//! per-request auth context.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use async_graphql::Enum;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// In-org role. The string values match the `users.role` CHECK constraint.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum Role {
    Admin,
    Surveyor,
    Viewer,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::Surveyor => "surveyor",
            Role::Viewer => "viewer",
        }
    }

    pub fn parse(s: &str) -> Option<Role> {
        match s {
            "admin" => Some(Role::Admin),
            "surveyor" => Some(Role::Surveyor),
            "viewer" => Some(Role::Viewer),
            _ => None,
        }
    }
}

/// Runtime configuration shared with resolvers via the GraphQL schema data.
#[derive(Clone)]
pub struct AuthConfig {
    pub jwt_secret: String,
    pub cookie_secure: bool,
}

pub const SESSION_COOKIE: &str = "session";
const SESSION_DAYS: i64 = 7;

/// JWT claims for a session.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid, // user id
    pub org: Uuid, // org id
    pub role: String,
    pub exp: i64,
}

/// The authenticated principal for a request, derived from a valid session cookie.
#[derive(Clone, Debug)]
pub struct AuthContext {
    pub user_id: Uuid,
    pub org_id: Uuid,
    pub role: Role,
}

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

pub fn issue_jwt(user_id: Uuid, org_id: Uuid, role: Role, secret: &str) -> Result<String, String> {
    let claims = Claims {
        sub: user_id,
        org: org_id,
        role: role.as_str().to_string(),
        exp: (Utc::now() + Duration::days(SESSION_DAYS)).timestamp(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| e.to_string())
}

pub fn decode_jwt(token: &str, secret: &str) -> Option<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|data| data.claims)
}

pub fn auth_context_from_token(token: &str, secret: &str) -> Option<AuthContext> {
    let claims = decode_jwt(token, secret)?;
    Some(AuthContext {
        user_id: claims.sub,
        org_id: claims.org,
        role: Role::parse(&claims.role)?,
    })
}

/// Builds the `Set-Cookie` value that establishes a session.
pub fn build_session_cookie(token: &str, secure: bool) -> String {
    let mut parts = vec![
        format!("{SESSION_COOKIE}={token}"),
        "HttpOnly".to_string(),
        "SameSite=Lax".to_string(),
        "Path=/".to_string(),
        format!("Max-Age={}", SESSION_DAYS * 24 * 3600),
    ];
    if secure {
        parts.push("Secure".to_string());
    }
    parts.join("; ")
}

/// Builds the `Set-Cookie` value that clears the session.
pub fn build_clearing_cookie(secure: bool) -> String {
    let mut parts = vec![
        format!("{SESSION_COOKIE}="),
        "HttpOnly".to_string(),
        "SameSite=Lax".to_string(),
        "Path=/".to_string(),
        "Max-Age=0".to_string(),
    ];
    if secure {
        parts.push("Secure".to_string());
    }
    parts.join("; ")
}

/// Extracts the session token from a `Cookie` header value, if present.
pub fn session_token_from_cookie_header(cookie_header: &str) -> Option<String> {
    for pair in cookie_header.split(';') {
        let pair = pair.trim();
        if let Some(value) = pair.strip_prefix(&format!("{SESSION_COOKIE}=")) {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_verifies() {
        let hash = hash_password("correct horse battery staple").unwrap();
        assert!(verify_password("correct horse battery staple", &hash));
        assert!(!verify_password("wrong password", &hash));
    }

    #[test]
    fn jwt_roundtrip_carries_identity() {
        let uid = Uuid::new_v4();
        let oid = Uuid::new_v4();
        let token = issue_jwt(uid, oid, Role::Surveyor, "secret").unwrap();
        let ctx = auth_context_from_token(&token, "secret").unwrap();
        assert_eq!(ctx.user_id, uid);
        assert_eq!(ctx.org_id, oid);
        assert_eq!(ctx.role, Role::Surveyor);
    }

    #[test]
    fn jwt_rejects_wrong_secret() {
        let token = issue_jwt(Uuid::new_v4(), Uuid::new_v4(), Role::Admin, "secret").unwrap();
        assert!(auth_context_from_token(&token, "different").is_none());
    }

    #[test]
    fn cookie_parsing_finds_session() {
        let header = format!("other=1; {SESSION_COOKIE}=abc.def.ghi; foo=bar");
        assert_eq!(
            session_token_from_cookie_header(&header),
            Some("abc.def.ghi".to_string())
        );
        assert_eq!(session_token_from_cookie_header("nope=1"), None);
    }

    #[test]
    fn role_string_roundtrip() {
        for role in [Role::Admin, Role::Surveyor, Role::Viewer] {
            assert_eq!(Role::parse(role.as_str()), Some(role));
        }
        assert_eq!(Role::parse("nope"), None);
    }
}
