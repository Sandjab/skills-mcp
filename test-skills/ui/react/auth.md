---
keywords:
  - react
  - auth
  - authentication
  - login
  - provider
  - guard
description: "React authentication components and patterns"
priority: 10
assets:
  - file: assets/AuthProvider.tsx.template
    description: "Template for AuthProvider React component"
    type: template
  - file: assets/auth-config.example.ts
    description: "Example auth configuration"
    type: example
scripts:
  - file: scripts/scaffold-auth.sh
    description: "Generate auth project structure"
    execution: claude
    args:
      - name: project_dir
        description: "Project root directory"
        required: true
      - name: provider
        description: "Auth provider type (firebase|auth0|custom)"
        required: false
        default: "custom"
  - file: scripts/validate-auth-config.ts
    description: "Validate auth configuration"
    execution: server
    args:
      - name: config_path
        description: "Path to auth config file"
        required: true
---

# React Auth Components

## AuthProvider

Always wrap the app root with AuthProvider.

## Route Guards

Use `useAuth()` hook to protect routes.

## Token Management

- Store tokens in httpOnly cookies
- Refresh automatically before expiry
