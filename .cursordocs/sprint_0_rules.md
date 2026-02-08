# CollMind TPM – Sprint 0 Cursor Rules

## Purpose
This is Sprint 0.
Sprint 0 is NOT for feature development.
Sprint 0 is for architectural validation and risk elimination.

## Hard Constraints
- Do NOT implement UI screens
- Do NOT implement APIs for production use
- Do NOT add CSV/Excel import logic
- Do NOT add KPI engine
- Do NOT add Planning-First logic
- Do NOT introduce SKU-level data

## Product Scope Lock
This product is an Actuals-First TPM system.

Core principles:
- Data granularity is CPL × FU × Period
- Agreements are STA or LTA
- No baseline, no planned volume
- Budget is reservation-based
- Approval is required for all spend-affecting actions

## Allowed Outputs in Sprint 0
- Domain models (entities, relationships)
- Data schemas (draft-level)
- State machines
- Sequence diagrams (textual)
- Pseudocode for critical flows
- Mock or placeholder services

## Forbidden Behavior
- Do not invent future features
- Do not expand scope beyond Sprint 0
- Do not optimize prematurely
- Do not assume requirements not explicitly stated

Always confirm understanding before producing outputs.
