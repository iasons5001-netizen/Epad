import assert from 'node:assert/strict';
import test from 'node:test';
import { DateTime } from 'luxon';
import { evaluateNotice, normalizeInput } from '../src/filters.js';
import { enrichDates, parsePortalDate, PAKISTAN_TIME_ZONE } from '../src/utils.js';

const now = DateTime.fromISO('2026-08-05T12:00:00', { zone: PAKISTAN_TIME_ZONE });

test('parses portal dates and relative EPADS deadlines in Pakistan time', () => {
    assert.match(parsePortalDate('Thursday, August 20, 2026 11:00 AM', now).iso, /^2026-08-20T11:00:00/);
    assert.match(parsePortalDate('2h 25m Left', now).iso, /^2026-08-05T14:25:00/);
    assert.match(parsePortalDate('04/08/2026', now).iso, /^2026-08-04T00:00:00/);
});

test('treats a date-only deadline as end of day', () => {
    const item = enrichDates({ title: 'Printing', deadline: '18 Aug, 2026' }, now);
    assert.match(item.deadlineIso, /^2026-08-18T23:59:59/);
    assert.ok(item.remainingHours > 300);
});

test('applies category, keyword, active and 48-hour filters', () => {
    const input = normalizeInput({
        keywords: ['tool kit', 'furniture'],
        categories: ['goods'],
        minimumRemainingHours: 48,
        activeOnly: true,
    });
    const item = enrichDates({
        title: 'Supply of livelihood tool kits',
        buyer: 'Relief Department',
        category: 'Goods',
        status: 'Published',
        deadline: '20 Aug, 2026',
    }, now);
    const result = evaluateNotice(item, input, now);
    assert.equal(result.accepted, true);
    assert.deepEqual(result.matchedKeywords, ['tool kit']);
    assert.ok(result.matchScore >= 30);
});

test('supports true zero values for retries and detail-page limits', () => {
    const input = normalizeInput({ maxRequestRetries: 0, maxDetailPages: 0 });
    assert.equal(input.maxRequestRetries, 0);
    assert.equal(input.maxDetailPages, 0);
});

test('supports UNGM-style reference, description, city, and sorting controls', () => {
    const input = normalizeInput({
        reference: '6018/121',
        description: 'general order supplier',
        cities: ['Karachi', 'Rawalpindi'],
        sortField: 'Deadline',
        sortAscending: true,
    });
    const item = enrichDates({
        noticeId: 'TS0000010916E',
        reference: '6018/121/E6',
        title: 'Prequalification of firms',
        description: 'Registration of a general order supplier for the financial year.',
        city: 'Rawalpindi',
        status: 'Published',
        deadline: '20 Aug, 2026',
    }, now);
    assert.equal(evaluateNotice(item, input, now).accepted, true);
    assert.equal(input.sortField, 'Deadline');
    assert.equal(input.sortAscending, true);
});
