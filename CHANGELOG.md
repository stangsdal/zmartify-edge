# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog and this project follows semantic versioning goals as it matures.

## [Unreleased]

### Added
- Administrator-initiated password reset: admins can email users a one-time,
  24-hour password reset link (`POST /api/v2/users/{user_id}/send-password-reset`),
  and users complete the reset through public
  `GET /api/v2/auth/password-reset/validate` and
  `POST /api/v2/auth/password-reset/complete` endpoints plus a reset form on the
  app login page. Completing a reset revokes all existing sessions for the user.
- Reset password dialog in the admin Users page with both "email reset link"
  and "set a new password directly" options, replacing the old browser prompt.

## [0.1.0] - 2026-07-01

### Added
- Initial repository extracted from hvac-gateway edge subtree with preserved history.
- Top-level project README with setup, operations, and API endpoint overview.
- Edge setup guide maintained in docs/hvac-edge-setup.md.

### Scope
- FastAPI edge backend, admin UI apps, MQTT broker config, and compose deployment assets.

[0.1.0]: https://github.com/stangsdal/zmartify-edge/releases/tag/v0.1.0
