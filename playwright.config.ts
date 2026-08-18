import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3333',
    headless: true,
    screenshot: 'only-on-failure',
    // Вправи промовляють слово, щойно його показали, а без AI-ключа озвучка
    // йде через speechSynthesis — тобто через системний голос Mac. Headless не
    // означає беззвучно: прогін вголос читав «hello» на весь кабінет.
    launchOptions: { args: ['--mute-audio'] },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npx serve eng-puzzle -l 3333',
    port: 3333,
    reuseExistingServer: true,
  },
});
