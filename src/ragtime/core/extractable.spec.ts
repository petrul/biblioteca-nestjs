/// <reference types="jest" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The core must stay liftable into its own package: its files import only
 * each other and node: built-ins - never Nest, an adapter, a client library
 * or the application.
 */
describe('ragtime core', () => {
  const files = readdirSync(__dirname).filter((name) => name.endsWith('.ts'));

  it.each(files)('%s imports only the core and node: built-ins', (name) => {
    const source = readFileSync(join(__dirname, name), 'utf8');
    const imports = [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    const foreign = [...imports, ...requires].filter((spec) => !/^\.\/[\w.-]+$/.test(spec) && !spec.startsWith('node:'));
    expect(foreign).toEqual([]);
  });

  it('exports every implementation file from its index', () => {
    const index = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    const modules = files.filter((name) => !name.endsWith('.spec.ts') && !['index.ts', 'test-doubles.ts'].includes(name));
    for (const name of modules) expect(index).toContain(`'./${name.replace(/\.ts$/, '')}'`);
  });
});
