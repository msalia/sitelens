-- Phase 3 (self-service password reset) + Phase 4 (invite expiry).
-- reset_token: single-use, 1-hour password-reset token (request/admin reset).
-- invite_token_expires: 7-day window for invite links.
ALTER TABLE users
    ADD COLUMN reset_token TEXT,
    ADD COLUMN reset_token_expires TIMESTAMPTZ,
    ADD COLUMN invite_token_expires TIMESTAMPTZ;
