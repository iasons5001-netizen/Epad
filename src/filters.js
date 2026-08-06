import { DateTime } from 'luxon';
import { normalizeForMatch, PAKISTAN_TIME_ZONE, searchableNoticeText } from './utils.js';

function phrases(values) {
    return (values ?? []).map(normalizeForMatch).filter(Boolean);
}

function includesPhrase(text, phrase) {
    return text.includes(phrase);
}

function parseBoundary(value, endOfDay = false) {
    if (!value) return null;
    let date = DateTime.fromISO(value, { zone: PAKISTAN_TIME_ZONE });
    if (!date.isValid) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) date = endOfDay ? date.endOf('day') : date.startOf('day');
    return date;
}

export function normalizeInput(input = {}) {
    const stringArray = (value) => Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
    const numberOr = (value, fallback) => value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? fallback : Number(value);
    return {
        sources: stringArray(input.sources).length ? stringArray(input.sources) : ['federal', 'punjab', 'sindh', 'khyber_pakhtunkhwa', 'balochistan', 'gilgit_baltistan', 'ajk'],
        keywords: stringArray(input.keywords),
        reference: String(input.reference ?? '').trim(),
        description: String(input.description ?? '').trim(),
        matchAllKeywords: Boolean(input.matchAllKeywords),
        excludeKeywords: stringArray(input.excludeKeywords),
        organizations: stringArray(input.organizations),
        cities: stringArray(input.cities),
        noticeTypes: stringArray(input.noticeTypes),
        categories: stringArray(input.categories),
        activeOnly: input.activeOnly !== false,
        publishedWithinHours: Math.max(0, numberOr(input.publishedWithinHours, 0)),
        publishedFrom: String(input.publishedFrom ?? '').trim(),
        publishedTo: String(input.publishedTo ?? '').trim(),
        deadlineFrom: String(input.deadlineFrom ?? '').trim(),
        deadlineTo: String(input.deadlineTo ?? '').trim(),
        minimumRemainingHours: Math.max(0, numberOr(input.minimumRemainingHours, 0)),
        onlyNew: Boolean(input.onlyNew),
        stateStoreName: String(input.stateStoreName || 'pakistan-epad-tender-monitor-state'),
        seenRetentionDays: Math.min(730, Math.max(7, numberOr(input.seenRetentionDays, 120))),
        includeDetails: input.includeDetails !== false,
        includeDocumentLinks: input.includeDocumentLinks !== false,
        maxItems: Math.min(5000, Math.max(1, numberOr(input.maxItems, 100))),
        maxPagesPerSource: Math.min(100, Math.max(1, numberOr(input.maxPagesPerSource, 50))),
        maxDetailPages: Math.min(5000, Math.max(0, numberOr(input.maxDetailPages, 250))),
        maxConcurrency: Math.min(20, Math.max(1, numberOr(input.maxConcurrency, 5))),
        maxRequestRetries: Math.min(10, Math.max(0, numberOr(input.maxRequestRetries, 3))),
        requestTimeoutSecs: Math.min(180, Math.max(15, numberOr(input.requestTimeoutSecs, 75))),
        sortField: ['Relevance', 'Deadline', 'DatePublished', 'Title', 'Reference'].includes(input.sortField) ? input.sortField : 'Relevance',
        sortAscending: Boolean(input.sortAscending),
        proxyConfiguration: input.proxyConfiguration ?? { useApifyProxy: false },
    };
}

export function evaluateNotice(notice, input, now = DateTime.now().setZone(PAKISTAN_TIME_ZONE), options = {}) {
    const reasons = [];
    const text = searchableNoticeText(notice);
    const title = normalizeForMatch(notice.title);
    const buyer = normalizeForMatch(notice.buyer);
    const description = normalizeForMatch(notice.description);
    const reference = normalizeForMatch(`${notice.noticeId ?? ''} ${notice.reference ?? ''}`);
    const city = normalizeForMatch(notice.city);
    const keywords = phrases(input.keywords);
    const referenceFilter = normalizeForMatch(input.reference);
    const descriptionFilter = normalizeForMatch(input.description);
    const excludes = phrases(input.excludeKeywords);
    const organizations = phrases(input.organizations);
    const cities = phrases(input.cities);
    const noticeTypes = phrases(input.noticeTypes);
    const categories = phrases(input.categories);
    const matchedKeywords = keywords.filter((keyword) => includesPhrase(text, keyword));

    if (excludes.some((phrase) => includesPhrase(text, phrase))) reasons.push('excludeKeyword');
    if (!options.ignoreTextFilters) {
        if (keywords.length && (input.matchAllKeywords ? matchedKeywords.length !== keywords.length : matchedKeywords.length === 0)) reasons.push('keywords');
        if (referenceFilter && !includesPhrase(reference, referenceFilter)) reasons.push('reference');
        if (descriptionFilter && !includesPhrase(description, descriptionFilter)) reasons.push('description');
        if (organizations.length && !organizations.some((phrase) => includesPhrase(buyer, phrase))) reasons.push('organization');
        if (cities.length && !cities.some((phrase) => includesPhrase(city, phrase))) reasons.push('city');
        const normalizedType = normalizeForMatch(notice.noticeType);
        if (noticeTypes.length && !noticeTypes.some((phrase) => includesPhrase(normalizedType, phrase))) reasons.push('noticeType');
        const normalizedCategory = normalizeForMatch(`${notice.category ?? ''} ${notice.sector ?? ''}`);
        if (categories.length && !categories.some((phrase) => includesPhrase(normalizedCategory, phrase))) reasons.push('category');
    }

    const status = normalizeForMatch(notice.status);
    const deadline = notice.deadlineIso ? DateTime.fromISO(notice.deadlineIso) : null;
    const published = notice.publishedDateIso ? DateTime.fromISO(notice.publishedDateIso) : null;
    if (input.activeOnly) {
        if (/closed|cancelled|canceled|archived|withdrawn|postponed|awarded/.test(status)) reasons.push('inactiveStatus');
        if (deadline?.isValid && deadline < now) reasons.push('pastDeadline');
    }
    if (input.minimumRemainingHours > 0 && Number.isFinite(notice.remainingHours) && notice.remainingHours < input.minimumRemainingHours) reasons.push('minimumRemainingHours');

    const publishedFrom = input.publishedWithinHours > 0 ? now.minus({ hours: input.publishedWithinHours }) : parseBoundary(input.publishedFrom);
    const publishedTo = parseBoundary(input.publishedTo, true);
    const deadlineFrom = parseBoundary(input.deadlineFrom);
    const deadlineTo = parseBoundary(input.deadlineTo, true);
    if (publishedFrom?.isValid && published?.isValid && published < publishedFrom) reasons.push('publishedFrom');
    if (publishedTo?.isValid && published?.isValid && published > publishedTo) reasons.push('publishedTo');
    if (deadlineFrom?.isValid && deadline?.isValid && deadline < deadlineFrom) reasons.push('deadlineFrom');
    if (deadlineTo?.isValid && deadline?.isValid && deadline > deadlineTo) reasons.push('deadlineTo');

    let matchScore = 0;
    for (const keyword of matchedKeywords) {
        if (title.includes(keyword)) matchScore += 30;
        else if (buyer.includes(keyword)) matchScore += 15;
        else if (description.includes(keyword)) matchScore += 8;
        else matchScore += 5;
    }
    if (notice.documentLinks?.length) matchScore += 2;
    if (Number.isFinite(notice.remainingHours) && notice.remainingHours >= 48) matchScore += 1;

    return {
        accepted: reasons.length === 0,
        reasons,
        matchedKeywords: input.keywords.filter((_, index) => matchedKeywords.includes(keywords[index])),
        matchScore,
    };
}
