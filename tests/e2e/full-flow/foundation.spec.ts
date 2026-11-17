import { test, expect, type Page } from '@playwright/test';
async function createTrip(page: Page, name = '自动验收旅行') {
  await page.goto('./');
  await page.getByRole('button', { name: '创建旅行', exact: true }).first().click();
  await page.getByLabel('旅行名称', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: '创建旅行', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存到此设备');
}
async function menu(page: Page, name: string) {
  await page.locator('summary').click(); await page.getByRole('button', { name, exact: true }).click();
}
test('create, rename, refresh, restore last workspace, keyboard dialog and delete last trip', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await createTrip(page);
  await expect(page).toHaveTitle('同路 · 毕业旅行');
  await expect(page.getByRole('combobox', { name: '选择旅行' })).toContainText('自动验收旅行');
  await menu(page, '重命名');
  await page.getByLabel('旅行名称').fill('一起去海边');
  await page.getByRole('button', { name: '保存名称' }).click();
  await expect(page.getByRole('combobox', { name: '选择旅行' })).toContainText('一起去海边');
  await page.getByRole('link', { name: '账本', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: '账本', exact: true })).toBeVisible();
  await page.goto('./');
  await expect(page).toHaveURL(/\/ledger$/);
  await menu(page, '重命名');
  await page.getByRole('dialog').press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await menu(page, '删除旅行');
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('heading', { name: '出发，从一支小队开始' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '出发，从一支小队开始' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('no horizontal overflow and meaningful navigation at target viewport', async ({ page }) => {
  await createTrip(page);
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.viewport);
  const nav = page.getByRole('navigation', { name: '工作区' });
  await expect(nav.getByRole('link')).toHaveCount(4);
  await page.getByRole('link', { name: '日程', exact: true }).click();
  await expect(page.getByRole('heading', { name: '日程', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: '日程', exact: true })).toHaveAttribute('aria-current', 'page');
});
test('a stale tab keeps a form draft and cannot overwrite the updated trip', async ({ page, context }) => {
  await createTrip(page);
  const second = await context.newPage(); await second.goto(page.url());
  await expect(second.getByRole('status')).toContainText('已保存到此设备');
  await menu(second, '重命名'); await second.getByLabel('旅行名称').fill('旧标签草稿');
  await menu(page, '重命名'); await page.getByLabel('旅行名称').fill('先保存的版本'); await page.getByRole('button', { name: '保存名称' }).click();
  await expect(second.getByLabel('旅行名称')).toHaveValue('旧标签草稿');
  await second.getByRole('button', { name: '保存名称' }).click();
  await expect(second.getByRole('dialog')).toContainText('重新载入');
  await page.reload(); await expect(page.getByRole('combobox')).toContainText('先保存的版本');
});
test('quota failure keeps the current draft and retries the same command once', async ({ page }) => {
  await createTrip(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { originalPut: typeof original }).originalPut = original;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'trips') throw new DOMException('test quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await menu(page, '重命名'); await page.getByLabel('旅行名称').fill('需要重试的草稿');
  await page.getByRole('button', { name: '保存名称' }).click();
  await expect(page.getByRole('dialog')).toContainText('存储空间不足');
  await expect(page.getByLabel('旅行名称')).toHaveValue('需要重试的草稿');
  await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('status')).toContainText('尚未保存');
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { originalPut: typeof IDBObjectStore.prototype.put }).originalPut; });
  await page.getByRole('button', { name: '重试保存' }).click();
  await expect(page.getByRole('status')).toContainText('已保存到此设备');
  await page.reload(); await expect(page.getByRole('combobox')).toContainText('需要重试的草稿');
});
test('unknown routes and trip IDs preserve existing content', async ({ page }) => {
  await createTrip(page); const originalUrl = page.url();
  await page.goto('./#/trip/missing/squad');
  await expect(page.getByRole('heading', { name: '暂时无法打开此旅行' })).toBeVisible();
  await expect(page).toHaveURL(/missing/);
  await page.goto('./#/no-such-page');
  await expect(page.getByRole('heading', { name: '没有找到这个页面' })).toBeVisible();
  await page.goto(originalUrl); await expect(page.getByRole('combobox')).toContainText('自动验收旅行');
});
test('unavailable IndexedDB enables explicit temporary mode with export', async ({ page, context }) => {
  await context.addInitScript(() => { IDBFactory.prototype.open = () => { throw new DOMException('test blocked', 'SecurityError'); }; });
  await page.goto('./'); await expect(page.getByText(/临时体验模式：/)).toBeVisible();
  await page.getByRole('button', { name: '创建旅行', exact: true }).first().click();
  await page.getByLabel('旅行名称').fill('临时旅行');
  await page.getByRole('dialog').getByRole('button', { name: '创建旅行', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '临时体验 · 刷新后丢失' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前内容', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^tonglu-raw-/);
});
