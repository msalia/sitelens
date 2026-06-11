//! Operator CLI: directly set a user's password from the server, bypassing email.
//!
//! Use when an admin is locked out and no mailer is configured (e.g. a fresh
//! self-hosted install). Connects with `DATABASE_URL`, hashes the new password,
//! marks the email verified, and clears any pending reset/invite tokens.
//!
//! Usage:
//!   reset_password <email> <new-password>
//!   reset_password <email>            # prompts for the password on stdin

use std::io::Write;

use sitelens_api::auth::hash_password;
use sitelens_api::db;

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let email = match args.next() {
        Some(e) => e,
        None => {
            eprintln!("usage: reset_password <email> [new-password]");
            std::process::exit(2);
        }
    };
    let password = match args.next() {
        Some(p) => p,
        None => {
            print!("New password for {email}: ");
            std::io::stdout().flush().ok();
            let mut line = String::new();
            std::io::stdin()
                .read_line(&mut line)
                .expect("failed to read password");
            line.trim().to_string()
        }
    };

    if password.len() < 8 {
        eprintln!("error: password must be at least 8 characters");
        std::process::exit(1);
    }

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = db::connect(&database_url)
        .await
        .expect("could not connect to database");

    let hash = hash_password(&password).expect("failed to hash password");

    let rows = sqlx::query(
        "UPDATE users
            SET password_hash = $1,
                email_verified = true,
                reset_token = NULL,
                reset_token_expires = NULL,
                invite_token = NULL,
                invite_token_expires = NULL
          WHERE lower(email) = lower($2)",
    )
    .bind(&hash)
    .bind(&email)
    .execute(&pool)
    .await
    .expect("update failed")
    .rows_affected();

    if rows == 0 {
        eprintln!("error: no user found with email {email}");
        std::process::exit(1);
    }

    println!("Password updated for {email}.");
}
