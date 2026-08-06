# Changelog

## 0.2.0 — 2026-08-05

- Added direct tender/reference-number, long-description, and city/location filters.
- Added selectable relevance, deadline, publication-date, title, and reference sorting.
- Aligned the dataset validation declaration with Apify's supported JSON Schema draft.
- Revalidated current Federal EPADS, Federal PPRA EPMS, GB PPRA, and Balochistan fallback layouts.

## 0.1.0 — 2026-08-05

- Added Federal EPADS 2.0 and Federal PPRA EPMS dedicated extractors.
- Added Punjab, Sindh, Khyber Pakhtunkhwa, Balochistan, Gilgit-Baltistan, and AJK source groups.
- Added dedicated GB PPRA card extraction and a header-mapped provincial table extractor.
- Added normalized dates in Pakistan time, public documents, contacts, bid security, bid validity, buyer, type, category, sector, procedure, and submission links.
- Added keyword, buyer, type, category, publication, deadline, active-status, and minimum-hours filters.
- Added cross-source deduplication and stateful new/updated-only monitoring.
- Added per-source fault isolation, retry/proxy controls, run summary, fixture tests, and a live layout smoke test.
