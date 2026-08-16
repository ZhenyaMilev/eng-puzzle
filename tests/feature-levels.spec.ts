import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Progressive Levels', () => {
  test('xpForLevel function returns increasing XP requirements', async ({ page }) => {
    await loadApp(page);
    const xpValues = await page.evaluate(() => {
      const values = [];
      for (let i = 1; i <= 5; i++) {
        values.push((window as any).xpForLevel(i));
      }
      return values;
    });
    // Level 1: 200, Level 2: 350, Level 3: 500, etc.
    expect(xpValues[0]).toBe(200);
    // Each level requires more XP than previous
    for (let i = 1; i < xpValues.length; i++) {
      expect(xpValues[i]).toBeGreaterThan(xpValues[i - 1]);
    }
  });

  test('xpForLevel formula: 200 + (n-1) * 150', async ({ page }) => {
    await loadApp(page);
    const results = await page.evaluate(() => {
      return [1, 2, 3, 5, 10].map(n => ({
        level: n,
        xp: (window as any).xpForLevel(n),
        expected: 200 + (n - 1) * 150,
      }));
    });
    for (const r of results) {
      expect(r.xp).toBe(r.expected);
    }
  });

  test('getLevelFromXP returns correct level', async ({ page }) => {
    await loadApp(page);
    const tests = await page.evaluate(() => {
      const fn = (window as any).getLevelFromXP;
      return [
        { xp: 0, level: fn(0) },
        { xp: 100, level: fn(100) },
        { xp: 200, level: fn(200) },
        { xp: 550, level: fn(550) },
      ];
    });
    expect(tests[0].level).toBe(1); // 0 XP = level 1
    expect(tests[1].level).toBe(1); // 100 XP = still level 1
    expect(tests[2].level).toBe(2); // 200 XP = level 2
    expect(tests[3].level).toBe(3); // 550 XP = level 3
  });

  test('getXPInCurrentLevel works correctly', async ({ page }) => {
    await loadApp(page);
    const xpInLevel = await page.evaluate(() => {
      return (window as any).getXPInCurrentLevel(250);
    });
    // 250 total XP, level 2 starts at 200, so 50 XP into level 2
    expect(xpInLevel).toBe(50);
  });

  test('level display updates on account screen', async ({ page }) => {
    await loadApp(page);
    const levelText = await page.locator('#acc-level').textContent();
    expect(levelText).toContain('Рівень');
  });
});
