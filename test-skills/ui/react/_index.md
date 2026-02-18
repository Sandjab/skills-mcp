---
keywords:
  - react
  - jsx
  - tsx
  - hook
  - component
description: "React development rules and patterns"
priority: 5
assets:
  - file: assets/component-base.tsx.template
    description: "Base component template"
    type: template
scripts:
  - file: scripts/lint-component.sh
    description: "Lint a React component"
    execution: claude
---

# React Rules

- Use functional components only
- Hooks for all state management
- One component per file
- Default exports for page components, named exports for shared components
