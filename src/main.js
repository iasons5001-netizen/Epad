import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { DateTime } from 'luxon';
import { extractDetail, extractListing, looksLikePortalError } from './extractors.js';
import { evaluateNotice, normalizeInput } from './filters.js';
import {
    crossSourceSignature,
    enrichDates,
    inferNoticeType,
    mergeNotices,
    noticeContentHash,
    PAKISTAN_TIME_ZONE,
    stableNoticeKey,
    uniqueLinks,
} from './utils.js';
import {
    buildListingRequests,
    getSelectedSourceDefinitions,
    getSourceDefinition,
    SOURCE_GROUPS,
} from './sources.js';

const runStartedAt = DateTime.now().setZone(PAKISTAN_TIME_ZONE);

function cleanRecord(record, now) {
    const enriched = enrichDates({
        ...record,
        title: String(record.title ?? '').trim(),
        noticeType: record.noticeType || inferNoticeType(record.title, record.description),
        documentLinks: uniqueLinks(record.documentLinks),
        sources: [...new Set(record.sources ?? [record.source].filter(Boolean))],
        sourceUrls: [...new Set(record.sourceUrls ?? [])],
    }, now);
    return {
        ...enriched,
        noticeId: enriched.noticeId || null,
        reference: enriched.reference || enriched.noticeId || null,
        buyer: enriched.buyer || null,
        category: enriched.category || null,
        sector: enriched.sector || null,
        procedure: enriched.procedure || null,
        status: enriched.status || null,
        city: enriched.city || null,
        description: enriched.description || null,
        bidSecurity: enriched.bidSecurity || null,
        bidValidity: enriched.bidValidity || null,
        contactName: enriched.contactName || null,
        contactEmail: enriched.contactEmail || null,
        contactPhone: enriched.contactPhone || null,
        detailUrl: enriched.detailUrl || null,
        submissionUrl: enriched.submissionUrl || null,
    };
}

function deduplicate(records, now) {
    const byStableKey = new Map();
    for (const rawRecord of records) {
        if (!rawRecord?.title) continue;
        const record = cleanRecord(rawRecord, now);
        const key = stableNoticeKey(record);
        byStableKey.set(key, mergeNotices(byStableKey.get(key), record));
    }

    const bySignature = new Map();
    for (const record of byStableKey.values()) {
        const signature = crossSourceSignature(record);
        bySignature.set(signature, mergeNotices(bySignature.get(signature), record));
    }
    return [...bySignature.values()].map((record) => cleanRecord(record, now));
}

function sortCandidates(records, input, now) {
    return [...records].sort((left, right) => {
        const leftEval = evaluateNotice(left, input, now);
        const rightEval = evaluateNotice(right, input, now);
        if (leftEval.accepted !== rightEval.accepted) return Number(rightEval.accepted) - Number(leftEval.accepted);
        if (leftEval.matchScore !== rightEval.matchScore) return rightEval.matchScore - leftEval.matchScore;
        const leftPublished = left.publishedDateIso ? Date.parse(left.publishedDateIso) : 0;
        const rightPublished = right.publishedDateIso ? Date.parse(right.publishedDateIso) : 0;
        if (leftPublished !== rightPublished) return rightPublished - leftPublished;
        const leftDeadline = left.deadlineIso ? Date.parse(left.deadlineIso) : Number.POSITIVE_INFINITY;
        const rightDeadline = right.deadlineIso ? Date.parse(right.deadlineIso) : Number.POSITIVE_INFINITY;
        return leftDeadline - rightDeadline;
    });
}

function compareNullable(left, right, ascending) {
    const leftMissing = left === null || left === undefined || left === '' || (typeof left === 'number' && !Number.isFinite(left));
    const rightMissing = right === null || right === undefined || right === '' || (typeof right === 'number' && !Number.isFinite(right));
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    if (leftMissing) return 0;
    const comparison = typeof left === 'number'
        ? left - right
        : String(left).localeCompare(String(right), 'en-PK', { sensitivity: 'base', numeric: true });
    return ascending ? comparison : -comparison;
}

function sortOutput(records, input) {
    const valueFor = (record) => {
        if (input.sortField === 'Deadline') return record.deadlineIso ? Date.parse(record.deadlineIso) : null;
        if (input.sortField === 'DatePublished') return record.publishedDateIso ? Date.parse(record.publishedDateIso) : null;
        if (input.sortField === 'Title') return record.title;
        if (input.sortField === 'Reference') return record.reference ?? record.noticeId;
        return record.matchScore;
    };

    return [...records].sort((left, right) => {
        const primary = compareNullable(valueFor(left), valueFor(right), input.sortAscending);
        if (primary) return primary;
        const deadline = compareNullable(
            left.deadlineIso ? Date.parse(left.deadlineIso) : null,
            right.deadlineIso ? Date.parse(right.deadlineIso) : null,
            true,
        );
        if (deadline) return deadline;
        return String(right.publishedDateIso ?? '').localeCompare(String(left.publishedDateIso ?? ''));
    });
}

async function frameLinks(page) {
    const links = [];
    for (const frame of page.frames()) {
        try {
            const frameUrl = frame.url();
            if (frame !== page.mainFrame() && /^https?:/i.test(frameUrl)) {
                links.push({ name: 'Embedded bidding-document page', url: frameUrl });
            }
            const found = await frame.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => ({
                name: anchor.textContent?.trim() || anchor.getAttribute('title') || anchor.getAttribute('download') || 'Document',
                url: anchor.href,
            })));
            links.push(...found);
        } catch {
            // A cross-origin or not-yet-loaded frame is optional; the iframe URL is still retained.
        }
    }
    return links;
}

function crawlerOptions(input, proxyConfiguration, requestHandler, failedRequestHandler) {
    return {
        proxyConfiguration,
        maxConcurrency: input.maxConcurrency,
        maxRequestRetries: input.maxRequestRetries,
        requestHandlerTimeoutSecs: input.requestTimeoutSecs,
        navigationTimeoutSecs: input.requestTimeoutSecs,
        launchContext: {
            launchOptions: {
                args: ['--disable-dev-shm-usage', '--no-sandbox'],
            },
        },
        browserPoolOptions: {
            retireBrowserAfterPageCount: 80,
        },
        preNavigationHooks: [async ({ page }, gotoOptions) => {
            await page.setExtraHTTPHeaders({
                'accept-language': 'en-PK,en;q=0.9',
            });
            await page.route('**/*', async (route) => {
                const blocked = ['image', 'media', 'font', 'stylesheet'].includes(route.request().resourceType());
                if (blocked) await route.abort();
                else await route.continue();
            });
            gotoOptions.waitUntil = 'domcontentloaded';
            gotoOptions.timeout = input.requestTimeoutSecs * 1000;
        }],
        requestHandler,
        failedRequestHandler,
    };
}

async function runActor() {
    const input = normalizeInput(await Actor.getInput() ?? {});
    const invalidSources = input.sources.filter((source) => !SOURCE_GROUPS.includes(source));
    if (invalidSources.length) throw new Error(`Unknown source group(s): ${invalidSources.join(', ')}`);

    const sources = getSelectedSourceDefinitions(input.sources);
    const sourceStats = Object.fromEntries(sources.map((source) => [source.key, {
        name: source.name,
        jurisdiction: source.jurisdiction,
        startUrl: source.startUrl,
        pagesRead: 0,
        noticesFound: 0,
        detailPagesRead: 0,
        errors: 0,
        status: 'pending',
    }]));
    const warnings = [];
    const rawListings = [];
    const proxyConfiguration = input.proxyConfiguration
        ? await Actor.createProxyConfiguration(input.proxyConfiguration)
        : undefined;

    let listingCrawler;
    const listingHandler = async ({ page, request }) => {
        const source = getSourceDefinition(request.userData.sourceKey);
        if (!source) throw new Error(`Missing source definition for ${request.userData.sourceKey}`);
        await page.waitForSelector('table, main, article, .card, body', { timeout: 15_000 }).catch(() => {});
        const html = await page.content();
        if (looksLikePortalError(html)) throw new Error(`${source.name} returned an upstream error page`);
        const result = extractListing(source.parser, html, request.loadedUrl ?? request.url, source);
        const stat = sourceStats[source.key];
        const recordListingPage = (pageResult, pageNumber) => {
            rawListings.push(...pageResult.notices);
            stat.pagesRead += 1;
            stat.noticesFound += pageResult.notices.length;
            stat.status = pageResult.notices.length || stat.noticesFound ? 'ok' : 'empty';
            log.info(`${source.name}: page ${pageNumber}, ${pageResult.notices.length} notices`);
        };

        const pageNumber = Number(request.userData.pageNumber) || 1;
        recordListingPage(result, pageNumber);
        if (pageNumber < input.maxPagesPerSource) {
            const remaining = result.nextPages.slice(0, 1).map((url) => ({
                url,
                uniqueKey: `LIST:${source.key}:${pageNumber + 1}:${url}`,
                userData: { label: 'LIST', sourceKey: source.key, pageNumber: pageNumber + 1 },
            }));
            if (remaining.length) await listingCrawler.addRequests(remaining);
        }

        // Older Punjab/other government portals paginate through ASP.NET postbacks,
        // so there is no real URL to enqueue. Advance those pages in the same tab.
        if (source.parser === 'genericTable' && !result.nextPages.length && pageNumber === 1) {
            let previousHtml = html;
            for (let aspPage = 2; aspPage <= input.maxPagesPerSource; aspPage += 1) {
                try {
                    const postbackLinks = page.locator('a[href*="__doPostBack"]');
                    let nextLink = postbackLinks.filter({ hasText: new RegExp(`^\\s*${aspPage}\\s*$`) }).first();
                    if (!await nextLink.count()) nextLink = postbackLinks.filter({ hasText: /^\s*(?:next|›|»)\s*$/i }).first();
                    if (!await nextLink.count()) break;

                    const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12_000 }).catch(() => null);
                    await nextLink.click({ timeout: 12_000 });
                    await Promise.race([navigation, page.waitForTimeout(1_500)]);
                    await page.waitForTimeout(400);
                    const nextHtml = await page.content();
                    if (nextHtml === previousHtml || looksLikePortalError(nextHtml)) break;
                    previousHtml = nextHtml;
                    const nextResult = extractListing(source.parser, nextHtml, page.url(), source);
                    if (!nextResult.notices.length) break;
                    recordListingPage(nextResult, aspPage);
                } catch (error) {
                    stat.errors += 1;
                    stat.status = stat.noticesFound ? 'partial' : 'failed';
                    warnings.push(`${source.name} ASP.NET pagination stopped early: ${error.message}`);
                    break;
                }
            }
        }
    };

    const listingFailed = async ({ request }, error) => {
        const source = getSourceDefinition(request.userData.sourceKey);
        if (!source) return;
        const stat = sourceStats[source.key];
        stat.errors += 1;
        stat.status = stat.pagesRead ? 'partial' : 'failed';
        const message = `${source.name} could not be read: ${error?.message ?? 'unknown error'}`;
        warnings.push(message);
        log.warning(message);
    };

    listingCrawler = new PlaywrightCrawler(crawlerOptions(input, proxyConfiguration, listingHandler, listingFailed));
    await listingCrawler.run(buildListingRequests(sources));

    let records = deduplicate(rawListings, runStartedAt);
    const listingUniqueCount = records.length;
    records = records.filter((record) => evaluateNotice(record, input, runStartedAt, { ignoreTextFilters: true }).accepted);
    records = sortCandidates(records, input, runStartedAt);

    const requiresDetailFiltering = Boolean(input.description)
        || [input.keywords, input.excludeKeywords, input.organizations, input.cities, input.noticeTypes, input.categories]
            .some((values) => values.length > 0);
    const desiredDetailPages = requiresDetailFiltering ? input.maxItems * 3 : input.maxItems;
    const detailBudget = Math.min(input.maxDetailPages, desiredDetailPages);
    const shouldReadDetails = input.includeDetails || input.includeDocumentLinks;
    const detailCandidates = shouldReadDetails
        ? records.filter((record) => record.detailUrl).slice(0, detailBudget)
        : [];
    const recordsByKey = new Map(detailCandidates.map((record) => [stableNoticeKey(record), record]));

    if (detailCandidates.length) {
        const detailRequests = detailCandidates.map((record) => ({
            url: record.detailUrl,
            uniqueKey: `DETAIL:${stableNoticeKey(record)}:${record.detailUrl}`,
            userData: {
                label: 'DETAIL',
                recordKey: stableNoticeKey(record),
                sourceKey: record.source,
            },
        }));

        const detailHandler = async ({ page, request }) => {
            const source = getSourceDefinition(request.userData.sourceKey);
            const current = recordsByKey.get(request.userData.recordKey);
            if (!source || !current) return;
            await page.waitForSelector('main, table, article, body', { timeout: 15_000 }).catch(() => {});
            await page.waitForTimeout(300);
            const html = await page.content();
            if (looksLikePortalError(html)) throw new Error(`${source.name} returned an upstream error page`);
            const extraLinks = input.includeDocumentLinks ? await frameLinks(page) : [];
            const extracted = extractDetail(html, request.loadedUrl ?? request.url, source, extraLinks);
            const addition = input.includeDetails ? extracted : {
                source: extracted.source,
                sources: extracted.sources,
                sourceUrls: extracted.sourceUrls,
                detailUrl: extracted.detailUrl,
                submissionUrl: extracted.submissionUrl,
                documentLinks: extracted.documentLinks,
            };
            const merged = cleanRecord(mergeNotices(current, addition), runStartedAt);
            Object.assign(current, merged);
            sourceStats[source.key].detailPagesRead += 1;
        };

        const detailFailed = async ({ request }, error) => {
            const source = getSourceDefinition(request.userData.sourceKey);
            if (!source) return;
            sourceStats[source.key].errors += 1;
            if (sourceStats[source.key].status === 'ok') sourceStats[source.key].status = 'partial';
            const message = `${source.name} detail page failed: ${request.url} (${error?.message ?? 'unknown error'})`;
            warnings.push(message);
            log.warning(message);
        };

        const detailCrawler = new PlaywrightCrawler(crawlerOptions(input, proxyConfiguration, detailHandler, detailFailed));
        await detailCrawler.run(detailRequests);
    }

    const rejectedReasons = {};
    const accepted = [];
    for (const record of records) {
        const evaluation = evaluateNotice(record, input, runStartedAt);
        if (!evaluation.accepted) {
            for (const reason of evaluation.reasons) rejectedReasons[reason] = (rejectedReasons[reason] ?? 0) + 1;
            continue;
        }
        accepted.push({
            ...record,
            matchedKeywords: evaluation.matchedKeywords,
            matchScore: evaluation.matchScore,
        });
    }

    const selected = sortOutput(accepted, input).slice(0, input.maxItems);
    let output = selected.map((record) => ({
        ...record,
        changeType: null,
        scrapedAt: runStartedAt.toUTC().toISO(),
        documentLinks: input.includeDocumentLinks ? record.documentLinks : [],
    }));

    if (input.onlyNew) {
        const stateStore = await Actor.openKeyValueStore(input.stateStoreName);
        const state = await stateStore.getValue('STATE') ?? { version: 1, notices: {} };
        const cutoff = runStartedAt.minus({ days: input.seenRetentionDays }).toMillis();
        for (const [key, value] of Object.entries(state.notices ?? {})) {
            if (Date.parse(value.lastSeenAt) < cutoff) delete state.notices[key];
        }

        const changed = [];
        for (const record of output) {
            const key = stableNoticeKey(record);
            const hash = noticeContentHash(record);
            const previous = state.notices[key];
            state.notices[key] = {
                hash,
                lastSeenAt: runStartedAt.toUTC().toISO(),
                detailUrl: record.detailUrl,
            };
            if (!previous) changed.push({ ...record, changeType: 'new' });
            else if (previous.hash !== hash) changed.push({ ...record, changeType: 'updated' });
        }
        state.updatedAt = runStartedAt.toUTC().toISO();
        await stateStore.setValue('STATE', state);
        output = changed;
    }

    if (output.length) await Actor.pushData(output);
    const finishedAt = DateTime.now().setZone(PAKISTAN_TIME_ZONE);
    const summary = {
        status: 'completed',
        runStartedAt: runStartedAt.toUTC().toISO(),
        finishedAt: finishedAt.toUTC().toISO(),
        durationSeconds: Math.round(finishedAt.diff(runStartedAt, 'seconds').seconds * 10) / 10,
        requestedJurisdictions: input.sources,
        filters: {
            keywords: input.keywords,
            reference: input.reference,
            description: input.description,
            excludeKeywords: input.excludeKeywords,
            organizations: input.organizations,
            cities: input.cities,
            noticeTypes: input.noticeTypes,
            categories: input.categories,
            activeOnly: input.activeOnly,
            publishedWithinHours: input.publishedWithinHours,
            minimumRemainingHours: input.minimumRemainingHours,
            onlyNew: input.onlyNew,
            sortField: input.sortField,
            sortAscending: input.sortAscending,
        },
        totals: {
            listingRecords: rawListings.length,
            uniqueListingRecords: listingUniqueCount,
            detailPagesRead: Object.values(sourceStats).reduce((sum, item) => sum + item.detailPagesRead, 0),
            acceptedBeforeLimit: accepted.length,
            selectedBeforeChangeDetection: selected.length,
            saved: output.length,
        },
        rejectedReasons,
        detailPagesSkippedByLimit: shouldReadDetails
            ? Math.max(0, records.filter((record) => record.detailUrl).length - detailCandidates.length)
            : 0,
        sources: sourceStats,
        warnings: [...new Set(warnings)],
    };
    await Actor.setValue('OUTPUT', summary);
    log.info(`Saved ${output.length} normalized tender notice(s).`);
}

await Actor.init();
let exitCode = 0;
let terminalMessage;
try {
    await runActor();
} catch (error) {
    exitCode = 1;
    terminalMessage = `Actor failed: ${error.message}`;
    log.exception(error, 'Actor failed');
    await Actor.setValue('OUTPUT', {
        status: 'failed',
        runStartedAt: runStartedAt.toUTC().toISO(),
        failedAt: DateTime.now().toUTC().toISO(),
        error: error.message,
    });
}
await Actor.exit({ exitCode, statusMessage: terminalMessage });
