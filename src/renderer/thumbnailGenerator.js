import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

export async function generateThumbnail(thumbnailData, outputPath) {
  console.log('Generating high-CTR YouTube thumbnail...');

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    // YouTube standard thumbnail resolution
    await page.setViewport({ width: 1280, height: 720 });

    const templatePath = path.join(process.cwd(), 'templates', 'thumbnail.html');
    await page.goto(`file:///${templatePath.replace(/\\/g, '/')}`);

    // Map script package data to the thumbnail parameters
    const state = {
      badge: thumbnailData.badge || 'QA Automation',
      headline: formatHeadline(thumbnailData.text),
      theme: thumbnailData.theme || 'neon-purple',
      logo: thumbnailData.logo || 'vscode'
    };

    console.log('Thumbnail settings:', state);

    await page.evaluate((stateStr) => {
      window.updateThumbnail(stateStr);
    }, JSON.stringify(state));

    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await page.screenshot({
      path: outputPath,
      type: 'jpeg',
      quality: 90
    });

    console.log(`Thumbnail generated successfully at: ${outputPath}`);

  } catch (error) {
    console.error('Failed to generate thumbnail:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Helper to format 5-7 words into a 2-line title with highlight spans
function formatHeadline(text) {
  if (!text) return 'You\'re Doing <br><span class="highlight-yellow">This WRONG!</span>';
  
  const words = text.split(/\s+/);
  if (words.length <= 3) {
    return `<span class="highlight-yellow">${text.toUpperCase()}</span>`;
  }
  
  // Split words roughly in half
  const mid = Math.ceil(words.length / 2);
  const line1 = words.slice(0, mid).join(' ').toUpperCase();
  const line2 = words.slice(mid).join(' ').toUpperCase();

  // Pick highlighting based on some common tech triggers or just the second line
  const highlights = ['WRONG', 'FREE', 'NEW', 'KILL', 'BUG', 'PLAYWRIGHT', 'AI', 'TOOL', 'FAST'];
  let hasHighlight = false;

  for (const trigger of highlights) {
    if (line2.includes(trigger)) {
      hasHighlight = true;
      break;
    }
  }

  if (hasHighlight || Math.random() > 0.3) {
    return `${line1} <br><span class="highlight-yellow">${line2}</span>`;
  } else {
    return `${line1} <br><span class="highlight-cyan">${line2}</span>`;
  }
}
