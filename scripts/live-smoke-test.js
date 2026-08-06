import {
    extractEpadsV2Listing,
    extractFederalPpraListing,
    extractGbPpraListing,
    extractGenericTableListing,
} from '../src/extractors.js';
import { getSourceDefinition } from '../src/sources.js';

const targets = [
    {
        key: 'federal_epads_v2',
        url: 'https://epads.gov.pk/',
        extract: extractEpadsV2Listing,
    },
    {
        key: 'federal_ppra_epms',
        url: 'https://epms.ppra.gov.pk/public/tenders/active-tenders',
        extract: extractFederalPpraListing,
    },
    {
        key: 'gilgit_baltistan_ppra',
        url: 'https://www.gbppra.gov.pk/viewall',
        extract: extractGbPpraListing,
    },
    {
        key: 'balochistan_government_tenders',
        url: 'https://balochistan.gov.pk/tenders/',
        extract: extractGenericTableListing,
    },
];

const results = await Promise.all(targets.map(async (target) => {
    try {
        const response = await fetch(target.url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(30_000),
            headers: {
                'user-agent': 'Mozilla/5.0 (compatible; PakistanTenderActorSmokeTest/0.1; +https://apify.com/)',
                'accept-language': 'en-PK,en;q=0.9',
            },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const parsed = target.extract(html, response.url, getSourceDefinition(target.key));
        return {
            source: target.key,
            status: parsed.notices.length ? 'ok' : 'layout-warning',
            notices: parsed.notices.length,
            sample: parsed.notices[0]?.title ?? null,
        };
    } catch (error) {
        return { source: target.key, status: 'unreachable', notices: 0, error: error.message };
    }
}));

console.table(results);
const reachable = results.filter((result) => result.status !== 'unreachable');
if (!reachable.length || reachable.some((result) => result.notices === 0)) process.exitCode = 1;
