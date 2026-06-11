-- Expiry for email-verification tokens (single-use links emailed on signup /
-- resend). NULL = no expiry (legacy rows). New tokens get a 7-day window set by
-- the signup / resendVerification resolvers.
ALTER TABLE users
    ADD COLUMN verification_token_expires TIMESTAMPTZ;
