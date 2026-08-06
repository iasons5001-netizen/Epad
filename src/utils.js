import crypto from 'node:crypto';
import { DateTime } from 'luxon';

export const PAKISTAN_TIME_ZONE = 'Asia/Karachi';

export function cleanText(value) {
    return String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/[\t\r\n]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function normalizeForMatch(value) {
    return cleanText(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('en-PK');
}

export function absoluteUrl(href, baseUrl) {
    if (!href) return null;
    const candidate = cleanText(href);
    if (!candidate || /^(?:javascript:|mailto:|tel:|#)/i.test(candidate)) return null;
    try {
        return new URL(candidate, baseUrl).href;
    } catch {
        return null;
    }
}

export function sha1(value) {
    return crypto.createHash('sha1').update(String(value)).digest('hex');
}

export function parsePortalDate(value, now = DateTime.now().setZone(PAKISTAN_TIME_ZONE)) {
    const original = cleanText(value);
    if (!original) return { text: null, iso: null, precision: null };

    const relative = original.match(/(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:left|remaining)/i);
    if (relative && relative.slice(1).some(Boolean)) {
        const days = Number(relative[1] ?? 0);
        const hours = Number(relative[2] ?? 0);
        const minutes = Number(relative[3] ?? 0);
        const date = now.plus({ days, hours, minutes });
        return { text: original, iso: date.toISO(), precision: 'relative' };
    }

    const normalized = original
        .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1')
        .replace(/\s+at\s+/i, ' ')
        .replace(/\s*\(.*?GMT.*?\)\s*$/i, '')
        .trim();

    const formats = [
        'cccc, LLLL d, yyyy hh:mm a',
        'cccc, LLLL d, yyyy h:mm a',
        'LLLL d, yyyy hh:mm a',
        'LLLL d, yyyy h:mm a',
        'LLL d, yyyy hh:mm a',
        'LLL d, yyyy h:mm a',
        'd LLL, yyyy hh:mm a',
        'd LLL, yyyy h:mm a',
        'dd LLL, yyyy hh:mm a',
        'dd LLL, yyyy h:mm a',
        'd-LLL-yyyy hh:mm a',
        'd-LLL-yyyy h:mm a',
        'dd-MM-yyyy hh:mm a',
        'dd-MM-yyyy h:mm a',
        'dd/MM/yyyy hh:mm a',
        'dd/MM/yyyy h:mm a',
        'yyyy-MM-dd HH:mm',
        'yyyy-MM-dd',
        'LLLL d, yyyy',
        'LLL d, yyyy',
        'd LLL, yyyy',
        'dd LLL, yyyy',
        'd-LLL-yyyy',
        'dd-MM-yyyy',
        'd-M-yyyy',
        'dd/MM/yyyy',
        'd/M/yyyy',
    ];

    let parsed = DateTime.fromISO(normalized, { zone: PAKISTAN_TIME_ZONE });
    if (!parsed.isValid) {
        for (const format of formats) {
            parsed = DateTime.fromFormat(normalized, format, {
                zone: PAKISTAN_TIME_ZONE,
                locale: 'en',
            });
            if (parsed.isValid) break;
        }
    }

    if (!parsed.isValid) {
        const jsDate = new Date(normalized);
        if (!Number.isNaN(jsDate.getTime())) {
            parsed = DateTime.fromJSDate(jsDate).setZone(PAKISTAN_TIME_ZONE);
        }
    }

    return {
        text: original,
        iso: parsed.isValid ? parsed.toISO() : null,
        precision: parsed.isValid ? (/\d:\d/.test(normalized) ? 'minute' : 'day') : null,
    };
}

export function inferNoticeType(...values) {
    const text = normalizeForMatch(values.filter(Boolean).join(' '));
    if (/\bcorrigendum\b|\baddendum\b|\bextension notice\b/.test(text)) return 'Corrigendum';
    if (/\bauction\b|\bdisposal\b|\bscrap\b/.test(text)) return 'Auction / Disposal';
    if (/\bpre[- ]?qualification\b|\bprequalification\b|\bpq\b/.test(text)) return 'Prequalification';
    if (/\bexpression of interest\b|\beoi\b/.test(text)) return 'Expression of Interest (EOI)';
    if (/\brequest for proposal\b|\brfp\b/.test(text)) return 'Request for Proposal (RFP)';
    if (/\brequest for quotation\b|\brfq\b|\bquotation(?:s)? invited\b/.test(text)) return 'Request for Quotation (RFQ)';
    if (/\binvitation to bid\b|\binvitation for bid\b|\bitb\b/.test(text)) return 'Invitation to Bid (ITB)';
    return 'Tender Notice';
}

export function uniqueLinks(links = []) {
    const byUrl = new Map();
    for (const link of links) {
        if (!link?.url) continue;
        const current = byUrl.get(link.url);
        if (!current || cleanText(link.name).length > cleanText(current.name).length) {
            byUrl.set(link.url, {
                name: cleanText(link.name) || 'Document',
                url: link.url,
                type: cleanText(link.type) || inferDocumentType(link.name, link.url),
            });
        }
    }
    return [...byUrl.values()];
}

export function inferDocumentType(name, url = '') {
    const value = normalizeForMatch(`${name} ${url}`);
    if (value.includes('corrig')) return 'corrigendum';
    if (value.includes('advert') || value.includes('notice') || value.includes(' nit ')) return 'advertisement';
    if (value.includes('bidding') || value.includes('tender document') || value.includes('/sbd')) return 'bidding-document';
    if (value.includes('evaluation')) return 'evaluation';
    if (value.includes('.pdf')) return 'pdf';
    return 'document';
}

export function extractEmails(text) {
    return [...new Set(String(text ?? '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])];
}

export function extractPhones(text) {
    const candidates = String(text ?? '').match(/(?:\+?92[-\s]?)?(?:0?\d{2,4}[-\s]?)?\d{6,8}/g) ?? [];
    return [...new Set(candidates.map(cleanText).filter((item) => item.replace(/\D/g, '').length >= 9))];
}

export function truncate(value, maxLength = 20_000) {
    const text = cleanText(value);
    if (text.length <= maxLength) return text || null;
    return `${text.slice(0, maxLength - 1)}…`;
}

export function enrichDates(notice, now = DateTime.now().setZone(PAKISTAN_TIME_ZONE)) {
    const published = parsePortalDate(notice.publishedDate ?? notice.publishedDateIso, now);
    const deadline = parsePortalDate(notice.deadline ?? notice.deadlineIso, now);
    // Preserve Pakistan's timezone when applying an end-of-day deadline.
    // Without setZone, Luxon converts the parsed ISO value into the Actor
    // container's local timezone first, which can move a date-only deadline
    // to the previous calendar day before endOf('day') is applied.
    let deadlineDate = deadline.iso
        ? DateTime.fromISO(deadline.iso, { setZone: true }).setZone(PAKISTAN_TIME_ZONE)
        : null;
    if (deadlineDate?.isValid && deadline.precision === 'day') deadlineDate = deadlineDate.endOf('day');
    const remainingHours = deadlineDate?.isValid ? deadlineDate.diff(now, 'hours').hours : null;

    return {
        ...notice,
        publishedDate: notice.publishedDate ?? published.text,
        publishedDateIso: notice.publishedDateIso ?? published.iso,
        deadline: notice.deadline ?? deadline.text,
        deadlineIso: notice.deadlineIso ?? (deadlineDate?.isValid ? deadlineDate.toISO() : deadline.iso),
        deadlinePrecision: notice.deadlinePrecision ?? deadline.precision,
        remainingHours: Number.isFinite(remainingHours) ? Math.round(remainingHours * 10) / 10 : null,
        remainingDays: Number.isFinite(remainingHours) ? Math.round((remainingHours / 24) * 10) / 10 : null,
    };
}

export function searchableNoticeText(notice) {
    return normalizeForMatch([
        notice.noticeId,
        notice.reference,
        notice.title,
        notice.description,
        notice.buyer,
        notice.organization,
        notice.office,
        notice.noticeType,
        notice.category,
        notice.sector,
        notice.procedure,
        notice.city,
        notice.jurisdiction,
    ].filter(Boolean).join(' '));
}

export function stableNoticeKey(notice) {
    const jurisdiction = normalizeForMatch(notice.jurisdiction || notice.sourceGroup || 'pakistan');
    const noticeId = normalizeForMatch(notice.noticeId || '');
    if (noticeId) return sha1(`${normalizeForMatch(notice.source)}|${noticeId}`);

    const reference = normalizeForMatch(notice.reference || '');
    if (reference) return sha1(`${jurisdiction}|${normalizeForMatch(notice.buyer)}|${reference}`);

    return sha1([
        jurisdiction,
        normalizeForMatch(notice.title),
        normalizeForMatch(notice.buyer),
        String(notice.deadlineIso ?? notice.deadline ?? '').slice(0, 10),
    ].join('|'));
}

export function crossSourceSignature(notice) {
    return sha1([
        normalizeForMatch(notice.jurisdiction),
        normalizeForMatch(notice.title),
        normalizeForMatch(notice.buyer),
        String(notice.deadlineIso ?? notice.deadline ?? '').slice(0, 16),
    ].join('|'));
}

export function noticeContentHash(notice) {
    return sha1(JSON.stringify({
        title: cleanText(notice.title),
        status: cleanText(notice.status),
        deadline: notice.deadlineIso ?? cleanText(notice.deadline),
        published: notice.publishedDateIso ?? cleanText(notice.publishedDate),
        documents: uniqueLinks(notice.documentLinks).map((link) => link.url).sort(),
    }));
}

export function mergeNotices(base, addition) {
    if (!base) return { ...addition, documentLinks: uniqueLinks(addition.documentLinks), sources: [...new Set(addition.sources ?? [addition.source].filter(Boolean))] };
    if (!addition) return base;

    const merged = { ...base };
    for (const [key, value] of Object.entries(addition)) {
        if (value === null || value === undefined || value === '') continue;
        const existing = merged[key];
        if (key === 'description') {
            if (cleanText(value).length > cleanText(existing).length) merged[key] = value;
        } else if (key === 'documentLinks') {
            merged[key] = uniqueLinks([...(existing ?? []), ...(value ?? [])]);
        } else if (key === 'sourceUrls') {
            merged[key] = [...new Set([...(existing ?? []), ...(value ?? [])].filter(Boolean))];
        } else if (key === 'sources') {
            merged[key] = [...new Set([...(existing ?? []), ...(value ?? [])])];
        } else if (Array.isArray(value)) {
            merged[key] = [...new Set([...(existing ?? []), ...value])];
        } else if (existing === null || existing === undefined || existing === '') {
            merged[key] = value;
        }
    }

    merged.sources = [...new Set([
        ...(merged.sources ?? []),
        base.source,
        addition.source,
    ].filter(Boolean))];
    merged.documentLinks = uniqueLinks([...(base.documentLinks ?? []), ...(addition.documentLinks ?? [])]);
    return merged;
}
