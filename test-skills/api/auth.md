---
keywords:
  - api
  - auth
  - authentication
  - jwt
  - token
  - middleware
description: "API authentication with JWT middleware"
priority: 5
---

# API Authentication

## JWT Strategy

- Sign with RS256
- Short-lived access tokens (15 min)
- Long-lived refresh tokens (7 days)

## Middleware

- Verify token on every protected route
- Extract user from token payload
- Return 401 on invalid/expired token
