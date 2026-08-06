export const SOURCE_GROUPS = [
    'federal',
    'punjab',
    'sindh',
    'khyber_pakhtunkhwa',
    'balochistan',
    'gilgit_baltistan',
    'ajk',
];

export const SOURCE_DEFINITIONS = {
    federal: [
        {
            key: 'federal_epads_v2',
            group: 'federal',
            jurisdiction: 'Federal',
            name: 'Federal EPADS 2.0 Open Opportunities',
            startUrl: 'https://epads.gov.pk/',
            parser: 'epadsV2',
        },
        {
            key: 'federal_ppra_epms',
            group: 'federal',
            jurisdiction: 'Federal',
            name: 'Federal PPRA EPMS',
            startUrl: 'https://epms.ppra.gov.pk/public/tenders/active-tenders',
            parser: 'federalPpra',
        },
    ],
    punjab: [
        {
            key: 'punjab_ppra',
            group: 'punjab',
            jurisdiction: 'Punjab',
            name: 'Punjab PPRA Active Procurement',
            startUrl: 'https://eproc.punjab.gov.pk/ActiveTenders.aspx',
            parser: 'genericTable',
        },
    ],
    sindh: [
        {
            key: 'sindh_ppms',
            group: 'sindh',
            jurisdiction: 'Sindh',
            name: 'Sindh PPRA PPMS',
            startUrl: 'https://ppms.pprasindh.gov.pk/PPMS/public/portal/notice-inviting-tender',
            parser: 'genericTable',
        },
    ],
    khyber_pakhtunkhwa: [
        {
            key: 'khyber_pakhtunkhwa_ppra',
            group: 'khyber_pakhtunkhwa',
            jurisdiction: 'Khyber Pakhtunkhwa',
            name: 'Khyber Pakhtunkhwa PPRA',
            startUrl: 'https://www.kppra.gov.pk/kppra/activetenders',
            parser: 'genericTable',
        },
    ],
    balochistan: [
        {
            key: 'balochistan_bppra',
            group: 'balochistan',
            jurisdiction: 'Balochistan',
            name: 'Balochistan BPPRA Tender Search',
            startUrl: 'https://bppthree.vdc.services/tenderssearch/',
            parser: 'genericTable',
        },
        {
            key: 'balochistan_bppra_legacy',
            group: 'balochistan',
            jurisdiction: 'Balochistan',
            name: 'Balochistan PPRA / EPPS (legacy)',
            startUrl: 'http://www.bppra.gob.pk/',
            parser: 'genericTable',
            fallback: true,
        },
        {
            key: 'balochistan_government_tenders',
            group: 'balochistan',
            jurisdiction: 'Balochistan',
            name: 'Government of Balochistan Tenders',
            startUrl: 'https://balochistan.gov.pk/tenders/',
            parser: 'genericTable',
            fallback: true,
        },
    ],
    gilgit_baltistan: [
        {
            key: 'gilgit_baltistan_ppra',
            group: 'gilgit_baltistan',
            jurisdiction: 'Gilgit-Baltistan',
            name: 'Gilgit-Baltistan PPRA',
            startUrl: 'https://www.gbppra.gov.pk/viewall',
            parser: 'gbPpra',
        },
    ],
    ajk: [
        {
            key: 'ajk_ppra',
            group: 'ajk',
            jurisdiction: 'Azad Jammu and Kashmir',
            name: 'AJK PPRA',
            startUrl: 'https://www.ajkppra.gov.pk/advertisements.php',
            parser: 'genericTable',
        },
    ],
};

export function getSelectedSourceDefinitions(groups) {
    return groups.flatMap((group) => SOURCE_DEFINITIONS[group] ?? []);
}

export function getSourceDefinition(key) {
    for (const definitions of Object.values(SOURCE_DEFINITIONS)) {
        const definition = definitions.find((item) => item.key === key);
        if (definition) return definition;
    }
    return null;
}

export function buildListingRequests(definitions) {
    return definitions.map((source) => ({
        url: source.startUrl,
        uniqueKey: `LIST:${source.key}:1:${source.startUrl}`,
        userData: {
            label: 'LIST',
            sourceKey: source.key,
            pageNumber: 1,
        },
    }));
}
