/**
 * Playwright script to connect to running Electron app via CDP
 * Usage: node scripts/electron-test.js
 */

const { chromium } = require('playwright');

async function main() {
  console.log('Connecting to Electron app on port 9222...');
  
  try {
    // Connect to the running Electron app via Chrome DevTools Protocol
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    console.log('Connected to Electron app!');
    
    // Get all browser contexts (Electron usually has one)
    const contexts = browser.contexts();
    console.log(`Found ${contexts.length} context(s)`);
    
    if (contexts.length === 0) {
      console.log('No contexts found, creating default context...');
      const context = await browser.newContext();
      contexts.push(context);
    }
    
    // Get the first page (the main Electron window)
    const pages = contexts[0].pages();
    console.log(`Found ${pages.length} page(s)`);
    
    if (pages.length === 0) {
      console.log('No pages found!');
      await browser.close();
      return;
    }
    
    const page = pages[0];
    
    // Get page info
    const title = await page.title();
    const url = page.url();
    console.log(`\nPage Title: ${title}`);
    console.log(`Page URL: ${url}`);
    
    // Take a screenshot
    const screenshotPath = 'scripts/electron-screenshot.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\nScreenshot saved to: ${screenshotPath}`);
    
    // Get a snapshot of visible text content
    const bodyText = await page.evaluate(() => {
      // Get all visible text elements
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      
      const texts = [];
      let node;
      while (node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (text && text.length > 0) {
          texts.push(text);
        }
      }
      return texts.slice(0, 50).join('\n'); // First 50 text nodes
    });
    
    console.log('\n=== Page Content Preview ===');
    console.log(bodyText);
    console.log('============================\n');
    
    // Don't close - keep connection alive for further commands
    // await browser.close();
    
    console.log('Connection successful! Electron app is ready for testing.');
    console.log('Press Ctrl+C to exit.\n');
    
    // Script completed - disconnect cleanly
    await browser.close();
    console.log('Test complete!');
    
  } catch (error) {
    console.error('Failed to connect:', error.message);
    console.log('\nMake sure:');
    console.log('1. Electron app is running with --remote-debugging-port=9222');
    console.log('2. No other debugger is connected to port 9222');
    process.exit(1);
  }
}

main();
