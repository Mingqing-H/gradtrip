import { build } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const workspace = process.cwd();
const directory = path.resolve('.cache/domain-benchmark');
if (!directory.startsWith(workspace + path.sep) || !directory.startsWith(path.resolve('.cache') + path.sep)) throw new Error('Invalid benchmark output directory');
await mkdir(directory, { recursive: true });
await build({ configFile: false, publicDir: false, logLevel: 'error', build: { outDir: directory, emptyOutDir: true, minify: 'esbuild', lib: { entry: path.resolve('tests/helpers/performanceHarness.ts'), formats: ['iife'], name: 'GradtripBenchmark', fileName: () => 'benchmark.js' } } });
const bundle = await readFile(path.join(directory, 'benchmark.js'), 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(() => globalThis.GradtripBenchmark.runMeasurements());
  const report = { browser: browser.version(), cpuSlowdown: 4, ...result };
  await writeFile('.cache/domain-performance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (result.maxMs > 50) process.exitCode = 1;
} finally { await browser.close(); }
