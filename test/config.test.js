import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SOURCE_GROUPS } from '../src/sources.js';

const readJson = async (relativePath) => JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));

test('Actor metadata and schemas are internally consistent', async () => {
    const [actor, input, dataset, packageJson, dockerfile] = await Promise.all([
        readJson('.actor/actor.json'),
        readJson('.actor/input_schema.json'),
        readJson('.actor/dataset_schema.json'),
        readJson('package.json'),
        readFile(new URL('../.actor/Dockerfile', import.meta.url), 'utf8'),
    ]);

    assert.equal(actor.actorSpecification, 1);
    assert.match(actor.version, /^\d+\.\d+$/);
    assert.deepEqual(input.properties.sources.items.enum, SOURCE_GROUPS);
    assert.equal(input.properties.maxPagesPerSource.default, 50);
    assert.match(dockerfile, new RegExp(`playwright-chrome:22-${packageJson.dependencies.playwright.replaceAll('.', '\\.')}`));

    for (const view of Object.values(dataset.views)) {
        for (const field of view.transformation.fields) {
            assert.ok(dataset.fields.properties[field], `Dataset view references missing field: ${field}`);
        }
    }
});
