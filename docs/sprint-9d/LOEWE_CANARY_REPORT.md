# Sprint 9D Loewe baseline canary — live result

**Execution:** 25 October 2026, one owner-approved isolated local run. The canonical scan is `13901a1d-ddda-4c3d-99f5-0a0dd63c716f` (`ce-brand-baseline/0.2`, template `ce-brand-baseline/v2`). The complete stored normalized [research snapshot](evidence/loewe-canary-20261025.live.json), [database preflight](evidence/loewe-database-preflight.json), and [independent integrity audit](evidence/loewe-integrity-audit.json) are preserved. The snapshot SHA-256 is `655843a056841d7f7ee4334beda065a5017f38ffde8328a8a829dde4e25a0da0`.

## Isolation, migration, and verification

A new PostgreSQL 16.14 cluster was initialized locally with a private Unix socket and **no TCP listener**. The regression database and the canary database were separate. Before migration, the canary database's actual name (`ce9d_loewe_canary`), role (`ce9d_operator`), cluster system identifier, data directory, socket-only connection, and zero user tables were checked. A deliberate wrong-identifier run refused before migration or provider dispatch. The canary then applied only `001_brand_baseline.sql` to its fresh database. Production Railway, its database, and admission flags were untouched. `pnpm test:db` passed **16/16** against the separate local regression database, including contract-drift immediate stop, persistence after reconnect, and idempotency. Lint, typecheck, unit tests, build, methodology, agent, query, baseline evaluations, offline smoke, and secrets scan passed before dispatch.

The live scan was `COMPLETE`, read back after a new connection pool, with an idempotent repeat causing **zero new calls**. The budget account ended at **6/7** reservations. All six calls were `COMPLETE`, `ok`, attempt 1, with no unknown outcomes; there were **zero retries** and **zero Anthropic calls**. Total live dispatches: one `describe`, one `entity_tags`, and four `recommend`. The five scan-stage calls took about 33.5 seconds after brand resolution. No optional entity enrichment or agent evaluation ran. Monetary Qloo cost was not measured.

| Stage | Correlation ID | Result |
| --- | --- | --- |
| Brand identity | `mcp-16e32ca2-e4f3-4219-89b5-6c563219f8e5` | `ok` |
| 20 brand tags | `mcp-02f77107-dafd-4f75-97c4-e840724d8f22` | `ok` |
| 10 artists | `mcp-4023915a-1906-4a92-ab56-5b16c0581d4c` | `ok` |
| 10 places | `mcp-a2156a85-34b2-453a-b35f-001be528862d` | `ok` |
| 10 films | `mcp-dbc88a44-0971-4b21-ba7c-eda61f60fc6c` | `ok` |
| 10 books | `mcp-ed3f4e5c-12ad-4bdc-84f3-ec827bc4b877` | `ok` |

The canary process initially exited nonzero **after** producing and persisting the complete scan because its optional JSON exporter selected a nonexistent scan column. This did not affect provider dispatch or the database result. The exporter query was corrected; a separate **read-only** recovery produced the full snapshot above. No second canary or Qloo call was made. The independent audit verified all source links, request types, six artifacts, budget arithmetic, and the absence of unknown calls.

## Provider type and request evidence

Every `recommend` observation recorded its actual request filter: `urn:entity:artist`, `urn:entity:place`, `urn:entity:movie`, and `urn:entity:book` respectively. Every one of the 40 returned entities had generic `type: urn:entity` **and a specific Qloo `subtype` matching that domain**. The result therefore records **40 `PROVIDER_CONFIRMED_TYPE`**, zero `QUERY_SCOPED`, zero generic unresolved, and zero conflicting types. This confirms entity type for these returned members; it does not independently validate each association's cultural relevance. The stored normalized observation preserves each subtype, request type, source correlation, name, and ID. The existing repository does not persist raw provider envelopes.

## Brand tags at returned positions 11–20

All ten rows came from the single live `entity_tags` call above, in Qloo's returned order. Order is **not** a strength or opportunity ranking.

| Position | Returned tag | Interpretation boundary |
| --- | --- | --- |
| 11 | High Culture (`urn:tag:lifestyle:qloo:high_culture`) | Lifestyle association |
| 12 | Spanish (`urn:tag:keyword:qloo:spanish`) | Curated keyword association |
| 13 | live action manga adaptation (`urn:tag:keyword:media:live_action_manga_adaptation`) | Descriptive media keyword |
| 14 | Artistic Exploration (`urn:tag:lifestyle:qloo:artistic_exploration`) | Lifestyle association |
| 15 | Artistic Patterns (`urn:tag:aesthetic_property:qloo:artistic_patterns`) | Aesthetic property association |
| 16 | chinese drama (`urn:tag:keyword:media:chinese_drama`) | Descriptive media keyword |
| 17 | Ready To Wear (`urn:tag:product_service:qloo:ready_to_wear`) | Brand category tag |
| 18 | based on manga (`urn:tag:keyword:media:based_on_manga`) | Descriptive media keyword |
| 19 | High-Income Individuals (`urn:tag:customer_segment:qloo:high_income_individuals`) | Customer segment association |
| 20 | Leather Goods (`urn:tag:product_service:qloo:leather_goods`) | Brand category tag |

The two product-service tags at 17 and 20 provide the first recorded Qloo category basis for Loewe's **brand core** in this baseline method: ready-to-wear and leather goods. They do not establish an adjacent opportunity.

## Observations, themes, and hypotheses

The profile retained **14 cultural/category tags and 40 related entities**, excluding six operational place-listing tags. The four related lists each contained ten members. Examples of observed, brand-conditioned associations are Red Velvet and BLACKPINK (artists), Les Ombres and Café de la Paix (places), *Call Me by Your Name* and *Phantom Thread* (films), and *More Than Enough* and *The Meaning of Mariah Carey* (books). The canary did not fetch those members' individual profiles or prove they share a scene, audience, or genre.

Three deterministic **tag-facet groups** were formed: Media keywords (five tags), Lifestyle (High Culture and Artistic Exploration), and Product service (Ready To Wear and Leather Goods). These are grouping by taxonomy facet, not independently confirmed entity themes. Five single-tag territory hypotheses were retained: **Fashion**, **Model**, **High Culture**, **Spanish**, and **Artistic Exploration**. Every hypothesis is `UNVALIDATED` and supported by the one tag call only. None is a FULL relative analysis or commercial recommendation.

## Usefulness judgment and remaining limits

The canary answers the narrow contract questions positively: Qloo populated `subtype` for all 40 related members; recorded request types are present; positions 11–20 contain additional cultural and brand-category information; and source integrity passed. It improves the cultural fingerprint and identifies research questions. **It does not yet produce a defensible adjacent expansion direction for Loewe.** Fashion and Model may describe the existing fashion context; High Culture and Artistic Exploration are broad; Spanish is descriptive. The related artists, places, films, and books remain separate associations, not a corroborated cross-domain theme. More returned hypotheses are not proof of stronger research value.

For Sprint 9E, methodology usefulness remains **INSUFFICIENT for prioritizing a new territory**, though the brand-core evidence is materially better. Human blind usefulness review, the LLM-only benchmark arm, and the agent competence gate remain outstanding. No further Qloo or Anthropic execution, public admission, deployment, or release is authorized by this report.
