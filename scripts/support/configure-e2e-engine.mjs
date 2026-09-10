export async function configureInternalValidationDisplay(page) {
  await page.evaluate(async () => {
    const token = localStorage.getItem('hummer.auth.session');
    if (!token || !window.hummerEngineCredentials) throw new Error('Encrypted credential bridge or session is missing');
    await window.hummerEngineCredentials.configure({
      token,
      engineProfileId: 'openai-flagship',
      credential: 'local-internal-validation-placeholder',
    });
  });
  await page.reload();
}

export async function ensureE2eIdentity(page, suffix) {
  const gate = page.getByRole('heading', { name: '\u8fdb\u5165 HUMMER' });
  const workbench = page.getByRole('heading', { name: '\u5de5\u4f5c\u53f0' });
  await Promise.race([
    gate.waitFor({ state: 'visible', timeout: 30_000 }),
    workbench.waitFor({ state: 'visible', timeout: 30_000 }),
  ]);
  if (!(await gate.isVisible())) return;
  await page.getByLabel('\u516c\u53f8\u540d\u79f0').fill(`HUMMER ${suffix}`);
  await page.getByLabel('\u4f60\u7684\u59d3\u540d').fill('\u8fd0\u884c\u65f6\u9a8c\u6536\u4eba');
  await page.getByLabel('\u90ae\u7bb1\u6216\u624b\u673a').fill(`${suffix.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@example.test`);
  await page.getByRole('button', { name: '\u521b\u5efa\u5e76\u8fdb\u5165' }).click();
  await gate.waitFor({ state: 'hidden', timeout: 15_000 });
}
