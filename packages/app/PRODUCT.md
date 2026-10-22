# App B20

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The B20 software engineering student group at CESUN, using phones and computers to coordinate assignments, find classmates' notes, and collaborate.

## Product Purpose

Keep shared academic work, learning materials, conversations, and personal progress in one student-owned space.

## Capabilities and Constraints

Existing React/TypeScript interface shared by web/PWA, Chrome extension and Capacitor Android. SpacetimeAuth OIDC identifies users; SpacetimeDB enforces invitations, membership, ownership and privacy. Preserve those checks. Demo data is synthetic and isolated. Keep work local and uncommitted.

Confirmed development brief: persistent login with options beyond magic links; first-use tutorial and profile setup; bounded profile customization; a royal gold admin banner titled «lamerapoya» for Luis Flores Bojorquez, Gamaliel Seefoo, Christian (surname unknown), and Kevin Alcaraz; due-date calendar; subjects with assignments and linked class notes; typing presence; better profile spacing and contribution navigation; purposeful panel and route animation.

The decorative admin title must not grant permissions. Exact immutable member identities are not supplied. Never grant roles by name. Supported login methods depend on SpacetimeAuth project configuration; do not invent a local password service.

## Brand Commitments

The user requested two comparable builds: CESUN-inspired with reference influences, and a reference-led alternative. References: Learnora brand identity (Behance 253307289), especially type, palette and graphics; Kids’ Language School (Behance 236474801), especially login composition. Preserve Spanish product language and B20 identity. These are student app variants, not claims of official university ownership.

## Evidence on Hand

Existing source, tests, demo fixtures, README and product definition. Both supplied Behance projects and cesun.edu.mx were visually inspected. No production member records were read for this work.

## Product Principles

- Shared academic instructions, author-owned submissions, and private personal material remain distinct.
- New functions work through both demo and persistent adapters.
- Motion supports navigation and respects reduced-motion preferences.
- Real access controls remain on the server.
