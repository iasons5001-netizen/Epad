import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    extractDetail,
    extractEpadsV2Listing,
    extractFederalPpraListing,
    extractGbPpraListing,
    extractGenericTableListing,
} from '../src/extractors.js';
import { getSourceDefinition } from '../src/sources.js';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('extracts Federal EPADS 2.0 listing fields', async () => {
    const result = extractEpadsV2Listing(await fixture('epads-v2.html'), 'https://epads.gov.pk/', getSourceDefinition('federal_epads_v2'));
    assert.equal(result.notices.length, 1);
    const item = result.notices[0];
    assert.equal(item.noticeId, 'P77777');
    assert.equal(item.title, 'Supply of Tool Kits and NFI');
    assert.equal(item.buyer, 'National Disaster Management Authority (NDMA)');
    assert.equal(item.category, 'Goods');
    assert.equal(item.procedure, 'Single Stage-Two Envelope');
    assert.equal(item.deadline, 'Thursday, August 20, 2026 11:00 AM');
    assert.equal(item.detailUrl, 'https://epads.gov.pk/opportunities/federal/procurements/abc-123');
});

test('extracts Federal PPRA and detects pagination', async () => {
    const result = extractFederalPpraListing(await fixture('federal-ppra.html'), 'https://epms.ppra.gov.pk/public/tenders/active-tenders', getSourceDefinition('federal_ppra_epms'));
    assert.equal(result.notices.length, 1);
    assert.equal(result.notices[0].noticeId, 'TS0000010847E');
    assert.equal(result.notices[0].title, 'Procurement of Tools and Store Items for MTI');
    assert.equal(result.notices[0].category, 'Equipments');
    assert.equal(result.notices[0].city, 'Taxila');
    assert.match(result.notices[0].detailUrl, /tender-details\/TS0000010847E$/);
    assert.deepEqual(result.nextPages, ['https://epms.ppra.gov.pk/public/tenders/active-tenders?page=2']);
});

test('extracts GB PPRA procurement cards and public documents', async () => {
    const result = extractGbPpraListing(await fixture('gb-ppra.html'), 'https://www.gbppra.gov.pk/viewall', getSourceDefinition('gilgit_baltistan_ppra'));
    assert.equal(result.notices.length, 2);
    assert.equal(result.notices[0].reference, 'TSE-202608032906');
    assert.equal(result.notices[0].title, 'Procurement of Consumable Items');
    assert.equal(result.notices[0].buyer, 'Project Director, Economic Transformation Initiatives, (ETI GB)');
    assert.equal(result.notices[0].documentLinks[0].url, 'https://www.gbppra.gov.pk/storage/proc_files/notice-2906.pdf');
    assert.equal(result.notices[0].deadline, '18 Aug, 2026');
    assert.equal(result.nextPages[0], 'https://www.gbppra.gov.pk/viewall?page=2');
});

test('maps changing provincial table columns by header names', async () => {
    const result = extractGenericTableListing(await fixture('generic-kp.html'), 'https://www.kppra.gov.pk/kppra/activetenders', getSourceDefinition('khyber_pakhtunkhwa_ppra'));
    assert.equal(result.notices.length, 1);
    const item = result.notices[0];
    assert.equal(item.reference, 'KP-2026-0042');
    assert.equal(item.title, 'Supply of school furniture');
    assert.equal(item.buyer, 'Elementary and Secondary Education Department');
    assert.equal(item.deadline, '25/08/2026 11:00 AM');
    assert.equal(item.documentLinks[0].type, 'bidding-document');
});

test('maps government tables whose header row uses td cells', async () => {
    const result = extractGenericTableListing(await fixture('generic-no-thead.html'), 'https://balochistan.gov.pk/tenders/', getSourceDefinition('balochistan_government_tenders'));
    assert.equal(result.notices.length, 1);
    assert.match(result.notices[0].title, /GWADAR SAFE CITY PROJECT/);
    assert.equal(result.notices[0].documentLinks[0].url, 'https://balochistan.gov.pk/wp-content/uploads/2026/05/police-open-tenders.pdf');
});

test('extracts normalized commercial fields from detail pages', async () => {
    const item = extractDetail(await fixture('detail.html'), 'https://epads.gov.pk/opportunities/federal/procurements/abc-123', getSourceDefinition('federal_epads_v2'), [
        { name: 'Direct SBD PDF', url: 'https://pa.epads.gov.pk/procurement/SBD/p77777/bidding-document.pdf?download=true' },
    ]);
    assert.equal(item.title, 'Supply of Livelihood Tool Kits');
    assert.equal(item.reference, 'NDMA/GDS/2026/17');
    assert.equal(item.bidSecurity, 'PKR 500,000');
    assert.equal(item.bidValidity, '120 days');
    assert.equal(item.contactEmail, 'procurement@example.gov.pk');
    assert.ok(item.documentLinks.some((link) => /bidding-document\.pdf/.test(link.url)));
});
