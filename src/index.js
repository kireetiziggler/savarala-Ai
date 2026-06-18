import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { scrapeDailyTrends } from './researcher/trendScraper.js';
import { selectDailyTopic } from './researcher/topicSelector.js';
import { generateScriptAndMetadata } from './generator/scriptBuilder.js';
import { renderVideo } from './renderer/videoRenderer.js';
import { generateThumbnail } from './renderer/thumbnailGenerator.js';
import { runQualityControl } from './publisher/qc.js';
import { uploadVideo } from './publisher/youtube.js';
import { db } from './db/db.js';
import { runAuthSetup } from './publisher/youtubeAuth.js';

dotenv.config();

// Create required folders
const dirs = ['scratch', 'output'];
dirs.forEach(d => {
  const p = path.join(process.cwd(), d);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
});

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printHelp();
    return;
  }

  try {
    switch (command) {
      case 'setup-auth':
        await runAuthSetup();
        break;

      case 'scrape':
        console.log('Testing daily trend scraper...');
        const trends = await scrapeDailyTrends();
        console.log(JSON.stringify(trends, null, 2));
        break;

      case 'select-topic': {
        const type = args[1] || 'short';
        if (type !== 'short' && type !== 'long') {
          console.error('Error: type must be "short" or "long"');
          return;
        }
        console.log(`Running topic selection for: ${type}...`);
        const scraped = await scrapeDailyTrends();
        const selected = await selectDailyTopic(scraped, type);
        console.log('Selected Topic Package:', selected);
        break;
      }

      case 'test-render':
        await runTestRender();
        break;

      case 'run-workflow': {
        const type = args[1] || 'short';
        const subType = args[2] || '';
        if (type !== 'short' && type !== 'long') {
          console.error('Error: type must be "short" or "long"');
          return;
        }
        await runWorkflow(type, subType);
        break;
      }

      case 'generate-video': {
        const type = args[1] || 'short';
        const subType = args[2] || '';
        if (type !== 'short' && type !== 'long') {
          console.error('Error: type must be "short" or "long"');
          return;
        }
        await runGenerationOnly(type, subType);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
    }
  } catch (err) {
    console.error('Execution encountered an error:', err);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
=== YouTube Growth AI Agent CLI ===
Usage: node src/index.js [command] [args]

Commands:
  setup-auth          Guides you to authenticate with your YouTube channel.
  scrape              Runs the web scraper to fetch latest trends from Reddit, GitHub, Google.
  select-topic [type] Simulates trend scraping and runs Gemini to pick a topic (short/long).
  test-render         Generates a fast 5-second video to verify Puppeteer & FFmpeg works.
  generate-video [type] Runs the full production loop (Select -> Script -> Voice -> Render -> QC)
                      without uploading. Saves output to output/ for your manual review.
  run-workflow [type] Executes the entire loop including automated YouTube upload.
                      Type is either 'short' (default) or 'long'.
  `);
}

async function runWorkflow(type, subType = '') {
  console.log(`\n=================== STARTING ${type.toUpperCase()} WORKFLOW ===================`);
  
  // 1. Scrape Trends
  const trendData = await scrapeDailyTrends();
  
  // 2. Select Topic
  const topicInfo = await selectDailyTopic(trendData, type, subType);
  topicInfo.subType = subType;
  
  // 3. Generate Script, Storyboard and Metadata
  const scriptPkg = await generateScriptAndMetadata(topicInfo);
  
  // 4. Save to Database
  const videoEntry = db.addVideo({
    topic: topicInfo.topic,
    type: type,
    title: scriptPkg.title,
    script: scriptPkg.fullScript,
    description: scriptPkg.description,
    tags: scriptPkg.tags,
    hashtags: scriptPkg.hashtags,
    status: 'generating'
  });

  const outputDir = path.join(process.cwd(), 'output');
  const videoPath = path.join(outputDir, `${videoEntry.id}_video.mp4`);
  const thumbnailPath = type === 'long' ? path.join(outputDir, `${videoEntry.id}_thumbnail.jpg`) : null;

  try {
    // 5. Render Video (Voiceovers, Puppeteer captures, FFmpeg stitch)
    db.updateVideo(videoEntry.id, { status: 'rendering' });
    await renderVideo(scriptPkg, type, videoPath);

    // 6. Generate Thumbnail (if long-form)
    if (type === 'long') {
      db.updateVideo(videoEntry.id, { status: 'generating_thumbnail' });
      const thumbData = {
        ...scriptPkg.thumbnail,
        badge: topicInfo.category
      };
      await generateThumbnail(thumbData, thumbnailPath);
    }

    // 7. Quality Control
    db.updateVideo(videoEntry.id, { status: 'running_qc' });
    scriptPkg.type = type; // Fix: Ensure type is passed to QC
    const qc = await runQualityControl(scriptPkg, videoPath, thumbnailPath);
    if (!qc.passed) {
      db.updateVideo(videoEntry.id, { 
        status: 'qc_failed', 
        errorLog: `QC errors: ${qc.errors.join(', ')}` 
      });
      console.error('❌ Quality Control checks failed. Stopping upload.');
      return;
    }

    db.updateVideo(videoEntry.id, { status: 'qc_passed' });

    // 8. Upload to YouTube
    console.log('QC Passed! Initiating YouTube Upload...');
    const ytId = await uploadVideo(videoEntry, videoPath, thumbnailPath);
    console.log(`\n=================== WORKFLOW COMPLETED SUCCESSFULLY ===================`);
    console.log(`Video Live ID: ${ytId}`);

  } catch (workflowError) {
    console.error(`\n❌ Workflow failed for video DB ID ${videoEntry.id}:`, workflowError.message);
    db.updateVideo(videoEntry.id, { 
      status: 'failed', 
      errorLog: workflowError.message 
    });
    throw workflowError;
  }
}

async function runGenerationOnly(type, subType = '') {
  console.log(`\n=================== STARTING ${type.toUpperCase()} GENERATION (REVIEW MODE) ===================`);
  
  // 1. Scrape Trends
  const trendData = await scrapeDailyTrends();
  
  // 2. Select Topic
  const topicInfo = await selectDailyTopic(trendData, type, subType);
  topicInfo.subType = subType;
  
  // 3. Generate Script, Storyboard and Metadata
  const scriptPkg = await generateScriptAndMetadata(topicInfo);
  
  // 4. Save to Database
  const videoEntry = db.addVideo({
    topic: topicInfo.topic,
    type: type,
    title: scriptPkg.title,
    script: scriptPkg.fullScript,
    description: scriptPkg.description,
    tags: scriptPkg.tags,
    hashtags: scriptPkg.hashtags,
    status: 'generating'
  });

  const outputDir = path.join(process.cwd(), 'output');
  const videoPath = path.join(outputDir, `${videoEntry.id}_video.mp4`);
  const thumbnailPath = type === 'long' ? path.join(outputDir, `${videoEntry.id}_thumbnail.jpg`) : null;

  try {
    // 5. Render Video (Voiceovers, Puppeteer captures, FFmpeg stitch)
    db.updateVideo(videoEntry.id, { status: 'rendering' });
    await renderVideo(scriptPkg, type, videoPath);

    // 6. Generate Thumbnail (if long-form)
    if (type === 'long') {
      db.updateVideo(videoEntry.id, { status: 'generating_thumbnail' });
      const thumbData = {
        ...scriptPkg.thumbnail,
        badge: topicInfo.category
      };
      await generateThumbnail(thumbData, thumbnailPath);
    }

    // 7. Quality Control
    db.updateVideo(videoEntry.id, { status: 'running_qc' });
    scriptPkg.type = type; // Fix: Ensure type is passed to QC
    const qc = await runQualityControl(scriptPkg, videoPath, thumbnailPath);
    if (!qc.passed) {
      db.updateVideo(videoEntry.id, { 
        status: 'qc_failed', 
        errorLog: `QC errors: ${qc.errors.join(', ')}` 
      });
      console.error('❌ Quality Control checks failed. Review video logs.');
      return;
    }

    db.updateVideo(videoEntry.id, { status: 'ready_for_review' });

    console.log(`\n=================== GENERATION COMPLETED (REVIEW MODE) ===================`);
    console.log(`✅ Video package ready for your review:`);
    console.log(`- Video File: file:///${videoPath.replace(/\\/g, '/')}`);
    if (thumbnailPath) {
      console.log(`- Thumbnail File: file:///${thumbnailPath.replace(/\\/g, '/')}`);
    }
    console.log(`- Title: ${scriptPkg.title}`);
    console.log(`- Description & Tags saved to database.json under ID: ${videoEntry.id}`);
    console.log(`Once you are satisfied with this output, you can push code to GitHub to authorize daily uploads.`);

  } catch (generationError) {
    console.error(`\n❌ Generation failed for video DB ID ${videoEntry.id}:`, generationError.message);
    db.updateVideo(videoEntry.id, { 
      status: 'failed', 
      errorLog: generationError.message 
    });
    throw generationError;
  }
}

// Generate a fast 5-second test video with mock data to test local browser and ffmpeg rendering
async function runTestRender() {
  console.log('\nRunning test-render pipeline check (5 seconds, no API credentials required)...');
  
  const testPkg = {
    title: "Test Video Build",
    description: "Testing Puppeteer and FFmpeg pipeline",
    storyboard: [
      {
        sceneIndex: 1,
        narration: "Welcome to this fast automation test rendering. We are checking the code layout now.",
        visualType: "code",
        zoomState: "zoom_in_center",
        visualParams: {
          language: "javascript",
          code: "const playwright = require('playwright');\n(async () => {\n  const browser = await playwright.chromium.launch();\n  console.log('Renderer works!');\n  await browser.close();\n})();",
          highlight: "3" // Spotlight line 3
        },
        cursor: {
          action: "click",
          line: 3
        }
      },
      {
        sceneIndex: 2,
        narration: "And here is the slide container layout showing customized bullets and animated captions.",
        visualType: "slide",
        zoomState: "pan_right",
        visualParams: {
          title: "Rendering pipeline is OK!",
          bullets: ["Frame captures working", "Audio text syncing okay", "FFmpeg stitch running"],
          highlight: "pipeline"
        }
      },
      {
        sceneIndex: 3,
        narration: "Finally, let's verify our brand new AI-generated stock image background rendering.",
        visualType: "stock_media",
        zoomState: "zoom_in_left",
        visualParams: {
          keyword: "artificial intelligence"
        }
      }
    ]
  };

  const testOutPath = path.join(process.cwd(), 'output', 'test_render_output.mp4');
  
  console.log('Compiling test video...');
  // Force edge provider temporarily for test-render so it works keyless
  const prevProvider = process.env.TTS_PROVIDER;
  process.env.TTS_PROVIDER = 'edge';
  
  try {
    await renderVideo(testPkg, 'short', testOutPath);
    console.log(`\n✅ PIPELINE CHECK PASSED! Test video created at: ${testOutPath}`);
  } catch (err) {
    console.error('\n❌ PIPELINE CHECK FAILED:', err);
    throw err;
  } finally {
    process.env.TTS_PROVIDER = prevProvider;
  }
}

// Execute main
main();
