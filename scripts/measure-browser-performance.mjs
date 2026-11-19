import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.PERFORMANCE_URL || 'http://127.0.0.1:4173' + (process.env.VITE_BASE_PATH || '/gradtrip/');
await mkdir('.cache', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const runs = [];
try {
  for (let run = 0; run < 3; run++) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage(); const session = await context.newCDPSession(page);
      await session.send('Network.enable');
      await session.send('Network.setCacheDisabled', { cacheDisabled: true });
      await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await session.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
      await page.addInitScript(() => {
        window.__performanceReport = { lcp: 0, cls: 0 };
        new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__performanceReport.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__performanceReport.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { level: 1, name: '小队 · Our crew', exact: true }).waitFor();
      runs.push(await page.evaluate(() => ({ ...window.__performanceReport,
        transferBytes: [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')].reduce((sum, entry) => sum + entry.transferSize, 0),
        viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      })));
      if (run === 0) await page.screenshot({ path: '.cache/integrated-mobile.png', fullPage: true });
    } finally { await context.close(); }
  }
  const report = { url: base, browser: browser.version(), cpuSlowdown: 4, downloadMbps: 1.6, uploadKbps: 750, latencyMs: 150,
    environment: 'Cold independent contexts; local production preview unless PERFORMANCE_URL points to deployed site',
    runs, medianLcp: [...runs].sort((a,b) => a.lcp - b.lcp)[1].lcp, maxCls: Math.max(...runs.map(run => run.cls)), maxTransferBytes: Math.max(...runs.map(run => run.transferBytes)) };
  await writeFile('.cache/browser-performance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.medianLcp > 2500 || report.maxCls > 0.1 || report.maxTransferBytes > 700 * 1024 || runs.some(run => run.scrollWidth > run.viewport)) process.exitCode = 1;
} finally { await browser.close(); }
