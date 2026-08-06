# Pakistan EPADS & PPRA Tender Notices Scraper

An Apify Actor for collecting public procurement opportunities across Pakistan into one normalized dataset. It covers Federal EPADS/PPRA, all four provinces, Gilgit-Baltistan, and Azad Jammu and Kashmir, while isolating portal failures so one unavailable authority does not stop the run.

This project is independent and is not affiliated with PPRA, EPADS, or any government authority. It reads public pages only; it does not log in, save notices, express interest, or submit bids.

## Coverage

| Jurisdiction | Public source | Adapter |
|---|---|---|
| Federal | [EPADS 2.0 open opportunities](https://epads.gov.pk/) | Dedicated EPADS table and embedded SBD-document extraction |
| Federal | [PPRA EPMS active tenders](https://epms.ppra.gov.pk/public/tenders/active-tenders) | Dedicated paginated table extractor |
| Punjab | [Punjab active tenders](https://eproc.punjab.gov.pk/ActiveTenders.aspx) | Header-mapped legacy portal extractor |
| Sindh | [Sindh PPMS notices](https://ppms.pprasindh.gov.pk/PPMS/public/portal/notice-inviting-tender) | Header-mapped PPMS extractor |
| Khyber Pakhtunkhwa | [KP PPRA active tenders](https://www.kppra.gov.pk/kppra/activetenders) | Header-mapped active-tender extractor |
| Balochistan | [BPPRA tender search linked by the provincial gateway](https://bppthree.vdc.services/tenderssearch/), [legacy BPPRA](http://www.bppra.gob.pk/), and [Government tender fallback](https://balochistan.gov.pk/tenders/) | Primary/fallback generic adapters |
| Gilgit-Baltistan | [GB PPRA procurements](https://www.gbppra.gov.pk/viewall) | Dedicated card and document extractor |
| Azad Jammu and Kashmir | [AJK PPRA advertisements](https://www.ajkppra.gov.pk/advertisements.php) | Header-mapped advertisement extractor |

Punjab, Sindh, and KP also have newer EPADS sign-in frontends. The Actor deliberately uses their public tender listings because authenticated pages are outside its scope. Provincial sites are sometimes slow or return 5xx/406 responses to cloud traffic; retries, optional Apify proxy configuration, and per-source status reporting are built in.

## What it extracts

- Tender ID and buyer reference
- Title, description, buyer, jurisdiction, source, and city
- Notice type, procurement category, sector, procedure, and status
- Publication date, deadline, normalized ISO timestamps, and remaining hours/days
- Bid security and bid validity when shown
- Public contact name, email, and phone
- Public advertisements, bidding documents, corrigenda, PDFs, and embedded EPADS SBD links
- Detail and supplier/submission portal links
- Matched keywords, relevance score, and `new`/`updated` state for monitoring runs

## Example input

```json
{
  "sources": ["federal", "punjab", "sindh", "khyber_pakhtunkhwa", "balochistan", "gilgit_baltistan", "ajk"],
  "keywords": ["tool kit", "livelihood kit", "NFI", "furniture", "printing", "stationery", "Pakistan Army", "Ministry of Defence"],
  "reference": "",
  "description": "",
  "cities": ["Lahore", "Rawalpindi", "Islamabad", "Peshawar", "Karachi", "Quetta"],
  "activeOnly": true,
  "minimumRemainingHours": 48,
  "includeDetails": true,
  "includeDocumentLinks": true,
  "onlyNew": true,
  "stateStoreName": "pakistan-daily-bid-monitor",
  "maxItems": 200,
  "maxPagesPerSource": 50,
  "maxDetailPages": 300,
  "sortField": "Relevance",
  "sortAscending": false
}
```

`minimumRemainingHours: 48` implements an automatic no-bid screen for opportunities with less than two days left, when a deadline is available. Unknown deadlines are retained rather than silently discarded.

## Example output

```json
{
  "noticeId": "TS0000010847E",
  "reference": "4615/IT-7860/26-27/MTI/FOR-B/SCM",
  "title": "Procurement of Tools and Store Items for MTI",
  "buyer": "Ministry of Defence Production",
  "jurisdiction": "Federal",
  "source": "federal_ppra_epms",
  "sources": ["federal_ppra_epms"],
  "noticeType": "Tender Notice",
  "category": "Equipments",
  "status": "Published",
  "publishedDateIso": "2026-08-04T00:00:00.000+05:00",
  "deadlineIso": "2026-09-01T10:30:00.000+05:00",
  "remainingHours": 645.5,
  "remainingDays": 26.9,
  "documentLinks": [],
  "detailUrl": "https://epms.ppra.gov.pk/public/tenders/tender-details/TS0000010847E",
  "matchedKeywords": ["tool kit"],
  "matchScore": 31,
  "changeType": "new",
  "scrapedAt": "2026-08-05T07:00:00.000Z"
}
```

## How the crawl works

1. Listing pages are read first across every selected jurisdiction.
2. Dates are normalized in `Asia/Karachi`; obviously inactive or out-of-window notices are removed.
3. Records are deduplicated within a portal and across overlapping Federal sources.
4. The best candidates are opened for public documents and detail fields, within `maxDetailPages`.
5. Full text/buyer/type/category filters are applied, records are scored, and `maxItems` is enforced.
6. With `onlyNew: true`, a named key-value store emits a record again only if it is new or its title, deadline, status, publication date, or document set changed.

The two-stage design avoids opening hundreds of detail pages that cannot pass date or status rules. When a keyword exists only in a long detail description, set a sufficiently high `maxDetailPages` to search it.

## Input reference

| Option | Purpose |
|---|---|
| `sources` | Any of `federal`, `punjab`, `sindh`, `khyber_pakhtunkhwa`, `balochistan`, `gilgit_baltistan`, `ajk` |
| `keywords` / `matchAllKeywords` | Phrase matching across normalized tender text |
| `reference` | Partial or exact portal ID, tender number, inquiry number, or buyer reference |
| `description` | Required phrase in the long description; use with `includeDetails: true` |
| `excludeKeywords` | Reject notices containing any excluded phrase |
| `organizations` | Partial buyer/organization names |
| `cities` | Partial city or location names |
| `noticeTypes` / `categories` | Partial normalized type/category filters |
| `activeOnly` | Remove explicit closed/cancelled/archived/withdrawn notices and past deadlines |
| `publishedWithinHours` | Relative new-notice window; `24` is useful for daily runs |
| `publishedFrom`, `publishedTo` | Inclusive `YYYY-MM-DD` publication window |
| `deadlineFrom`, `deadlineTo` | Inclusive `YYYY-MM-DD` deadline window |
| `minimumRemainingHours` | Deadline feasibility guardrail; use `48` for a two-day cutoff |
| `includeDetails` | Extract long descriptions, contacts, security, validity, and procedure |
| `includeDocumentLinks` | Collect public documents and embedded SBD links |
| `maxItems` | Maximum records saved after filtering |
| `maxPagesPerSource` | Listing pagination safety limit per portal |
| `maxDetailPages` | Cross-portal detail request/cost guardrail |
| `sortField` / `sortAscending` | Sort by relevance, deadline, publication date, title, or reference |
| `onlyNew` / `stateStoreName` | Stateful scheduled monitoring and independent monitor identity |
| `proxyConfiguration` | Optional Apify proxy configuration for difficult provincial portals |

## Deploy to Apify

From the project directory:

```bash
npm install
npm test
apify login
apify push
```

The Actor uses the official Playwright/Chrome base image declared in `.actor/Dockerfile`. The input, dataset views, and output summary are defined under `.actor/` and appear automatically in the Apify Console.

For local fixture verification:

```bash
npm test
```

For a non-browser check against the stable, publicly reachable Federal, GB, and Balochistan-fallback layouts:

```bash
npm run smoke
```

## API usage

### Node.js

```js
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
const run = await client.actor('YOUR_USERNAME/pakistan-epad-tender-notices-scraper').call({
    keywords: ['tool kit', 'furniture', 'printing'],
    activeOnly: true,
    minimumRemainingHours: 48,
    includeDetails: true,
    includeDocumentLinks: true,
    maxItems: 100,
});

const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.log(items);
```

### Python

```python
from apify_client import ApifyClient

client = ApifyClient('YOUR_APIFY_TOKEN')
run = client.actor('YOUR_USERNAME/pakistan-epad-tender-notices-scraper').call(run_input={
    'keywords': ['tool kit', 'furniture', 'printing'],
    'activeOnly': True,
    'minimumRemainingHours': 48,
    'includeDetails': True,
    'maxItems': 100,
})
items = client.dataset(run['defaultDatasetId']).list_items().items
print(items)
```

### cURL

```bash
curl -X POST 'https://api.apify.com/v2/acts/YOUR_USERNAME~pakistan-epad-tender-notices-scraper/runs?token=YOUR_APIFY_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"keywords":["tool kit","furniture"],"activeOnly":true,"minimumRemainingHours":48,"maxItems":100}'
```

## Scheduling and integrations

Create a daily Apify schedule with `onlyNew: true`, a stable `stateStoreName`, and a focused keyword list. Dataset items can then feed Google Sheets, Airtable, Notion, email/Slack alerts, a CRM, a bid-triage dashboard, or a webhook. Keep separate state-store names for independent teams or search profiles.

## Data quality and maintenance

- Dates are retained in their original portal text and also normalized. Relative EPADS deadlines are resolved at run time in Pakistan Standard Time.
- A missing public field is returned as `null`; the Actor does not invent bid requirements.
- Some authorities publish only a scanned PDF. The Actor returns the document link but does not OCR the document in version 0.1.0.
- Legacy portals occasionally reject data-center traffic or go offline. Review the `OUTPUT` summary: each source is marked `ok`, `empty`, `partial`, or `failed`, with warnings and counts.
- Government portals can change without notice. Run `npm run smoke` after deployment updates and keep the fixture suite when adjusting selectors.

## Responsible use

Use a modest schedule, narrow searches where possible, and respect portal terms, robots instructions, copyright, and applicable procurement rules. Download public document batches only when needed. This Actor does not bypass authentication, CAPTCHA, or access controls.
