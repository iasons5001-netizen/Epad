import * as cheerio from 'cheerio';
import {
    absoluteUrl,
    cleanText,
    extractEmails,
    extractPhones,
    inferDocumentType,
    inferNoticeType,
    normalizeForMatch,
    truncate,
    uniqueLinks,
} from './utils.js';

const DATE_PATTERN = /\b\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?|\b\d{1,2}[-/]\d{1,2}[-/]\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/gi;
const DOCUMENT_HINT = /\.(?:pdf|docx?|xlsx?|zip|rar)(?:$|[?#])|download|document|bidding|tender[-_ ]?doc|advertisement|corrigendum|notice|\/sbd\b/i;
const STRONG_DOCUMENT_URL = /\.(?:pdf|docx?|xlsx?|zip|rar)(?:$|[?#])|\/pdf(?:[/?#]|$)|[?&]file=|\/uploads?\/|\/storage\/|DownloadDocument|\/procurement\/SBD\//i;
const DETAIL_HINT = /detail|view|procurementdetails|tender-details|opportunit(?:y|ies)|notice\/[A-Za-z0-9-]+/i;

function textOf($, element) {
    return cleanText($(element).text());
}

function directBlockTexts($, element) {
    const values = [];
    $(element).children().each((_, child) => {
        const value = cleanText($(child).text());
        if (value && !values.includes(value)) values.push(value);
    });
    return values;
}

function extractAnchors($, scope, pageUrl) {
    const links = [];
    $(scope).find('a[href], iframe[src]').each((_, element) => {
        const raw = $(element).attr('href') ?? $(element).attr('src');
        const url = absoluteUrl(raw, pageUrl);
        if (!url) return;
        links.push({ name: cleanText($(element).text() || $(element).attr('title') || $(element).attr('aria-label')) || 'Link', url });
    });
    return links;
}

function classifyLinks(links) {
    const documents = [];
    let detailUrl = null;
    let submissionUrl = null;

    for (const link of links) {
        const value = `${link.name} ${link.url}`;
        if (/submit|apply|vendor portal|e-?submission|supplier portal/i.test(value)) submissionUrl ??= link.url;
        if (/procurementdetails|tender-details|\/opportunities\/[^/]+\/procurements\//i.test(link.url)) {
            detailUrl ??= link.url;
        } else if (DOCUMENT_HINT.test(value)) {
            documents.push({ ...link, type: inferDocumentType(link.name, link.url) });
        } else if (DETAIL_HINT.test(value)) {
            detailUrl ??= link.url;
        }
    }

    return { documentLinks: uniqueLinks(documents), detailUrl, submissionUrl };
}

function nextPageUrls($, pageUrl) {
    const output = new Set();
    $('a[href]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        const label = cleanText($(anchor).text());
        const rel = cleanText($(anchor).attr('rel'));
        if (/javascript:/i.test(href ?? '')) return;
        if (/^(?:next|›|»|next\s*[›»])$/i.test(label) || /\bnext\b/i.test(rel)) {
            const url = absoluteUrl(href, pageUrl);
            if (url) output.add(url);
        }
    });

    const pageMatch = cleanText($('body').text()).match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if (pageMatch && Number(pageMatch[1]) < Number(pageMatch[2])) {
        const url = new URL(pageUrl);
        url.searchParams.set('page', String(Number(pageMatch[1]) + 1));
        output.add(url.href);
    }
    return [...output];
}

function baseNotice(source) {
    return {
        jurisdiction: source.jurisdiction,
        source: source.key,
        sourceName: source.name,
        sourceGroup: source.group,
        sources: [source.key],
        sourceUrls: [source.startUrl],
        documentLinks: [],
    };
}

function extractLabel(text, label, nextLabels = []) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stop = nextLabels.length
        ? `(?=${nextLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|$)`
        : '$';
    return cleanText(text.match(new RegExp(`${escaped}\\s*:?\\s*(.*?)${stop}`, 'i'))?.[1]);
}

export function extractEpadsV2Listing(html, pageUrl, source) {
    const $ = cheerio.load(html);
    const notices = [];

    $('table tbody tr').each((_, row) => {
        const cells = $(row).find('td').toArray();
        if (cells.length < 5) return;
        const reference = textOf($, cells[1]);
        if (!/^P?\d+/i.test(reference)) return;

        const titleCell = $(cells[2]);
        const statusCellText = textOf($, cells[3]);
        const typeCellText = directBlockTexts($, cells[4]).join(' ') || textOf($, cells[4]);
        const links = extractAnchors($, row, pageUrl);
        const classified = classifyLinks(links);
        const titleAnchor = titleCell.find('a').first();
        const title = cleanText(titleAnchor.text()) || directBlockTexts($, cells[2])[0] || textOf($, cells[2]);
        const buyer = cleanText(textOf($, cells[2]).replace(title, '')) || null;
        const publishedDate = extractLabel(statusCellText, 'Published On', ['Closing On']);
        const deadline = extractLabel(statusCellText, 'Closing On');
        const categoryMatch = typeCellText.match(/^(Consultancy Services|Non-Consultancy Services|Goods|Works)\b/i);
        const category = cleanText(categoryMatch?.[1]) || null;
        const procedure = cleanText(category ? typeCellText.slice(category.length) : typeCellText) || null;
        const detailUrl = classified.detailUrl
            ?? absoluteUrl(titleAnchor.attr('href'), pageUrl)
            ?? links.find((link) => /\/opportunities\//i.test(link.url))?.url
            ?? null;

        notices.push({
            ...baseNotice(source),
            noticeId: reference,
            reference,
            title,
            buyer,
            status: /corrigendum/i.test(`${statusCellText} ${textOf($, cells[2])}`) ? 'Under Corrigendum' : 'Published',
            publishedDate: publishedDate || null,
            deadline: deadline || null,
            category,
            procedure,
            noticeType: inferNoticeType(title, statusCellText, procedure),
            detailUrl,
            documentLinks: classified.documentLinks,
            submissionUrl: classified.submissionUrl,
        });
    });

    return { notices, nextPages: nextPageUrls($, pageUrl) };
}

function firstUsefulBlock($, cell, rejected = []) {
    const selectors = 'h1,h2,h3,h4,h5,h6,strong,b,.fw-bold,.font-weight-bold,.title';
    const options = $(cell).find(selectors).toArray().map((item) => textOf($, item));
    options.push(...directBlockTexts($, cell), textOf($, cell));
    return options.find((value) => value.length >= 4 && !rejected.some((item) => normalizeForMatch(value) === normalizeForMatch(item))) ?? null;
}

export function extractFederalPpraListing(html, pageUrl, source) {
    const $ = cheerio.load(html);
    const notices = [];

    $('table tbody tr').each((_, row) => {
        const cells = $(row).find('td').toArray();
        if (cells.length < 7) return;
        const tenderNo = textOf($, cells[1]);
        if (!/^TS[A-Z0-9-]+/i.test(tenderNo)) return;

        const detailText = textOf($, cells[2]);
        const organizationText = textOf($, cells[3]);
        const title = firstUsefulBlock($, cells[2], [tenderNo]) ?? detailText;
        const links = extractAnchors($, row, pageUrl);
        const classified = classifyLinks(links);
        const explicitReference = $(cells[2]).find('small.text-muted.d-block').toArray().map((item) => textOf($, item))
            .find((item) => /[/_-]|\b(?:ref|tender|inquiry|dated)\b/i.test(item));
        const referenceMatches = detailText.match(/(?:[A-Z0-9][A-Z0-9()./_-]{3,}(?:\s+dated\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4})?)/g) ?? [];
        const reference = explicitReference ?? referenceMatches.find((item) => /[/_-]|dated/i.test(item) && item !== tenderNo) ?? tenderNo;
        const badgeTexts = $(cells[2]).find('.badge,[class*="badge"]').toArray().map((item) => textOf($, item));
        const category = badgeTexts.find((item) => item.length > 2 && item.length < 80 && item !== reference && !/ministry|division|department|organization/i.test(item)) ?? null;
        const locationText = $(cells[3]).find('small,p,span,div').toArray().map((item) => textOf($, item))
            .filter((item) => /-\s*Pakistan\b/i.test(item))
            .sort((left, right) => left.length - right.length)[0] ?? '';
        const city = locationText.match(/^(.+?)\s*-\s*Pakistan\b/i)?.[1] ?? null;

        notices.push({
            ...baseNotice(source),
            noticeId: tenderNo,
            reference: cleanText(reference),
            title,
            description: truncate(detailText),
            buyer: firstUsefulBlock($, cells[3]) ?? organizationText,
            status: textOf($, cells[4]) || null,
            publishedDate: textOf($, cells[5]) || null,
            deadline: textOf($, cells[6]) || null,
            noticeType: inferNoticeType(title, detailText),
            category,
            city: cleanText(city) || null,
            detailUrl: classified.detailUrl ?? links.find((link) => /tender-details/i.test(link.url))?.url ?? null,
            documentLinks: classified.documentLinks,
            submissionUrl: classified.submissionUrl,
        });
    });

    return { notices, nextPages: nextPageUrls($, pageUrl) };
}

function nearestSingleDetailContainer($, anchor) {
    let current = $(anchor).parent();
    let best = current;
    for (let depth = 0; depth < 8 && current.length; depth += 1) {
        const count = current.find('a[href*="procurementdetails"]').length;
        if (count > 1) break;
        if (count === 1 && textOf($, current).length < 8000) best = current;
        current = current.parent();
    }
    return best;
}

export function extractGbPpraListing(html, pageUrl, source) {
    const $ = cheerio.load(html);
    const notices = [];
    const seen = new Set();

    $('a[href*="procurementdetails"]').each((_, anchor) => {
        const detailUrl = absoluteUrl($(anchor).attr('href'), pageUrl);
        if (!detailUrl || seen.has(detailUrl)) return;
        seen.add(detailUrl);
        const container = nearestSingleDetailContainer($, anchor);
        const text = textOf($, container);
        const reference = cleanText(text.match(/TSE-\d+/i)?.[0]);
        if (!reference) return;
        const elementDates = container.find('time,span,p,div').toArray()
            .map((item) => textOf($, item))
            .filter((item) => item.length < 80 && (item.match(DATE_PATTERN) ?? []).length === 1);
        const dates = elementDates.length >= 2 ? elementDates : (text.match(DATE_PATTERN) ?? []);
        const headings = container.find('h1,h2,h3,h4,h5,h6').toArray().map((item) => textOf($, item));
        const title = headings
            .filter((item) => item && !/TSE-\d+/i.test(item) && !/^all procurements$/i.test(item))
            .sort((a, b) => b.length - a.length)[0]
            ?? cleanText(text.replace(reference, '').split(/Tender Notice|Invitation to Bids|Request for Proposal|Expression of Interest/i)[0]);
        const links = extractAnchors($, container, pageUrl);
        const classified = classifyLinks(links);
        const buyer = container.find('a').toArray()
            .map((item) => textOf($, item))
            .find((name) => !/^(notice|document|view details|download)$/i.test(name) && name !== title && !/TSE-/i.test(name))
            ?? null;
        const knownType = text.match(/Tender Notice|Invitation to Bids|Request for Proposal|Expression of Interest|Prequalification Notice|Corrigendum|Quotations Invited|Auction/i)?.[0];

        notices.push({
            ...baseNotice(source),
            noticeId: reference,
            reference,
            title,
            buyer: cleanText(buyer) || null,
            noticeType: cleanText(knownType) || inferNoticeType(title, text),
            publishedDate: cleanText(dates[0]) || null,
            deadline: cleanText(dates[1]) || null,
            status: /cancelled/i.test(text) ? 'Cancelled' : /postponed/i.test(text) ? 'Postponed' : 'Published',
            detailUrl,
            documentLinks: classified.documentLinks,
            submissionUrl: classified.submissionUrl,
        });
    });

    return { notices, nextPages: nextPageUrls($, pageUrl) };
}

function normalizedHeaders($, table) {
    let headers = $(table).find('thead tr').last().find('th,td').toArray().map((item) => normalizeForMatch(textOf($, item)));
    if (!headers.length) headers = $(table).find('tr').first().children('th,td').toArray().map((item) => normalizeForMatch(textOf($, item)));
    return headers;
}

function valueByHeader(headers, values, patterns) {
    const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
    return index >= 0 ? values[index] : null;
}

function cellByHeader(headers, cells, patterns) {
    const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
    return index >= 0 ? cells[index] : null;
}

function tableScore(headers) {
    const joined = headers.join(' | ');
    return [/(tender|notice|procurement|nit|title|description|work)/, /(closing|deadline|submission|opening)/, /(department|organization|entity|agency|procur)/]
        .reduce((score, pattern) => score + (pattern.test(joined) ? 1 : 0), 0);
}

export function extractGenericTableListing(html, pageUrl, source) {
    const $ = cheerio.load(html);
    const notices = [];
    const tables = $('table').toArray()
        .map((table) => ({ table, headers: normalizedHeaders($, table) }))
        .filter(({ headers }) => headers.length >= 2 && tableScore(headers) >= 1);

    for (const { table, headers } of tables) {
        $(table).find('tbody tr, > tr').each((_, row) => {
            if ($(row).closest('thead').length) return;
            const cells = $(row).find('td').toArray();
            if (cells.length < 2) return;
            const values = cells.map((cell) => textOf($, cell));
            if (values.every((value) => !value)) return;
            if (values.map(normalizeForMatch).every((value, index) => value === headers[index])) return;

            const links = extractAnchors($, row, pageUrl);
            const classified = classifyLinks(links);
            const titleCell = cellByHeader(headers, cells, [/description/, /title/, /name of work/, /particular/, /tender.*detail/, /procurement/]);
            const title = (titleCell ? firstUsefulBlock($, titleCell) : null)
                ?? valueByHeader(headers, values, [/description/, /title/, /name of work/, /particular/, /tender.*detail/, /procurement/])
                ?? values.filter((value) => value.length >= 8).sort((a, b) => b.length - a.length)[0];
            const noticeId = valueByHeader(headers, values, [/tender no/, /notice no/, /tse/, /serial/, /^no\.?$/, /reference/]);
            const buyer = valueByHeader(headers, values, [/procurement entity/, /procuring/, /organization/, /department/, /agency/, /office/]);
            const deadline = valueByHeader(headers, values, [/closing/, /deadline/, /submission/, /last date/, /opening/]);
            const publishedDate = valueByHeader(headers, values, [/advertisement/, /advertised/, /published/, /upload/, /issue date/, /^date$/]);
            const status = valueByHeader(headers, values, [/status/]);
            const category = valueByHeader(headers, values, [/category/, /nature/, /sector/]);
            const noticeType = valueByHeader(headers, values, [/notice type/, /tender type/, /^type$/]);
            const detailUrl = classified.detailUrl
                ?? links.find((link) => !DOCUMENT_HINT.test(`${link.name} ${link.url}`))?.url
                ?? null;

            if (!title || normalizeForMatch(title).includes('no record found')) return;
            notices.push({
                ...baseNotice(source),
                noticeId: cleanText(noticeId) || null,
                reference: cleanText(noticeId) || null,
                title: cleanText(title),
                buyer: cleanText(buyer) || null,
                noticeType: cleanText(noticeType) || inferNoticeType(title),
                category: cleanText(category) || null,
                status: cleanText(status) || 'Published',
                publishedDate: cleanText(publishedDate) || null,
                deadline: cleanText(deadline) || null,
                detailUrl,
                documentLinks: classified.documentLinks,
                submissionUrl: classified.submissionUrl,
            });
        });
    }

    return { notices, nextPages: nextPageUrls($, pageUrl) };
}

export function extractListing(parser, html, pageUrl, source) {
    if (parser === 'epadsV2') return extractEpadsV2Listing(html, pageUrl, source);
    if (parser === 'federalPpra') return extractFederalPpraListing(html, pageUrl, source);
    if (parser === 'gbPpra') return extractGbPpraListing(html, pageUrl, source);
    return extractGenericTableListing(html, pageUrl, source);
}

function collectKeyValues($, scope) {
    const values = new Map();
    const add = (label, value) => {
        const key = normalizeForMatch(label).replace(/:$/, '');
        const cleaned = cleanText(value);
        if (key && cleaned && key.length < 100 && !values.has(key)) values.set(key, cleaned);
    };

    scope.find('tr').each((_, row) => {
        const cells = $(row).children('th,td').toArray();
        if (cells.length >= 2) add(textOf($, cells[0]), cells.slice(1).map((cell) => textOf($, cell)).join(' '));
    });
    scope.find('dt').each((_, item) => add(textOf($, item), cleanText($(item).next('dd').text())));
    scope.find('[class*="label"], label, .col-form-label').each((_, item) => {
        const label = textOf($, item);
        const parent = $(item).parent();
        const siblings = parent.children().toArray().filter((child) => child !== item).map((child) => textOf($, child)).join(' ');
        if (siblings) add(label, siblings);
    });
    return values;
}

function lookup(values, patterns) {
    for (const [key, value] of values.entries()) {
        if (patterns.some((pattern) => pattern.test(key))) return value;
    }
    return null;
}

export function extractDetail(html, pageUrl, source, extraLinks = []) {
    const $ = cheerio.load(html);
    const scope = $('main').first().length
        ? $('main').first()
        : $('[role="main"],.main-content,.page-content,#content,.content').first().length
            ? $('[role="main"],.main-content,.page-content,#content,.content').first()
            : $('body');
    const bodyText = cleanText(scope.text());
    const values = collectKeyValues($, scope);
    const globalDocuments = extractAnchors($, 'body', pageUrl).filter((link) => (
        STRONG_DOCUMENT_URL.test(link.url)
        || /^download\s+(?:tender|bidding|advertisement|document)/i.test(link.name)
    ));
    const links = [...extractAnchors($, scope, pageUrl), ...globalDocuments, ...extraLinks]
        .map((link) => ({ ...link, url: absoluteUrl(link.url, pageUrl) }))
        .filter((link) => link.url);
    const classified = classifyLinks(links);
    const headings = scope.find('h1,h2,h3')
        .toArray().map((item) => textOf($, item))
        .filter((item) => item.length >= 5 && !/active tenders|tender details|procurement details|public procurement/i.test(item));
    const title = headings.sort((a, b) => b.length - a.length)[0] ?? null;
    const description = lookup(values, [/description/, /scope of work/, /tender detail/, /procurement detail/, /specification/]);
    const email = extractEmails(bodyText)[0] ?? null;
    const phone = extractPhones(bodyText)[0] ?? null;
    const iframeUrl = links.find((link) => /\/procurement\/.*\/sbd/i.test(link.url))?.url ?? null;

    return {
        ...baseNotice(source),
        title,
        noticeId: lookup(values, [/notice id/, /tender no/, /procurement ref/, /tse no/, /^reference/]),
        reference: lookup(values, [/reference/, /tender no/, /procurement ref/, /nit no/, /inquiry no/]),
        buyer: lookup(values, [/procuring agency/, /procurement entity/, /organization/, /department/, /buyer/]),
        noticeType: lookup(values, [/notice type/, /tender type/, /procurement type/]),
        category: lookup(values, [/category/, /nature/]),
        sector: lookup(values, [/sector/]),
        procedure: lookup(values, [/procedure/, /bidding method/, /procurement method/]),
        status: lookup(values, [/status/]),
        publishedDate: lookup(values, [/published/, /advertised/, /advertisement date/, /issue date/]),
        deadline: lookup(values, [/closing/, /deadline/, /last date/, /submission date/]),
        city: lookup(values, [/city/, /location/, /district/]),
        description: truncate(description),
        bidSecurity: lookup(values, [/bid security/, /earnest money/, /security amount/]),
        bidValidity: lookup(values, [/bid validity/, /validity period/]),
        contactName: lookup(values, [/contact person/, /contact name/, /focal person/]),
        contactEmail: lookup(values, [/email/]) ?? email,
        contactPhone: lookup(values, [/phone/, /telephone/, /contact no/, /mobile/]) ?? phone,
        documentLinks: classified.documentLinks,
        submissionUrl: classified.submissionUrl ?? iframeUrl,
        detailUrl: pageUrl,
    };
}

export function looksLikePortalError(html) {
    const text = normalizeForMatch(cheerio.load(html)('body').text());
    return /bad gateway|service unavailable|gateway timeout|access denied|not acceptable|http error 406|request rejected|temporarily unavailable|error 5\d\d/.test(text.slice(0, 5000));
}
