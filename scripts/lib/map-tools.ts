/** Open the disclosure through its public accessible control. */
export async function openMapTools(page: any) {
  const trigger = page.getByRole('button', { name: '展开地图工具', exact: true });
  if (await trigger.count()) { await trigger.click(); await page.waitForTimeout(220); }
}
export async function waitForMapCenter(page: any) {
  await page.waitForFunction(() => !document.querySelector('[data-camera-moving="true"]'));
}
