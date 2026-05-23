import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  headless: 'new'
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

// Mock geolocation
await page.setGeolocation({ latitude: 41.38, longitude: 2.17 });

await page.goto('http://localhost:4201', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));
await page.screenshot({ path: '/tmp/app-initial.png', fullPage: false });
console.log('Screenshot taken: /tmp/app-initial.png');

// Try to open passes panel
const passesBtn = await page.$('[class*="passes"]');
console.log('Passes button:', passesBtn);

await browser.close();
