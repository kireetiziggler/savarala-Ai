import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' }
  });
}

export async function runQualityControl(videoData, videoPath, thumbnailPath) {
  console.log('Running Quality Control (QC) checks...');
  const errors = [];

  // 1. Basic File System checks
  if (!fs.existsSync(videoPath)) {
    errors.push(`Video file does not exist at: ${videoPath}`);
  } else {
    const videoStats = fs.statSync(videoPath);
    if (videoStats.size < 1024 * 50) { // Check if less than 50KB
      errors.push(`Video file is too small (${(videoStats.size / 1024).toFixed(2)} KB), compilation might have failed.`);
    }
  }

  if (videoData.type === 'long' && (!thumbnailPath || !fs.existsSync(thumbnailPath))) {
    errors.push('Thumbnail file is missing for long-form video.');
  } else if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    const thumbStats = fs.statSync(thumbnailPath);
    if (thumbStats.size < 1024 * 5) {
      errors.push(`Thumbnail file is too small (${(thumbStats.size / 1024).toFixed(2)} KB).`);
    }
  }

  // 2. Metadata length checks
  if (!videoData.title || videoData.title.length === 0) {
    errors.push('Video title is missing.');
  } else if (videoData.title.length > 70) {
    errors.push(`Video title is too long (${videoData.title.length} characters). YouTube recommends under 70.`);
  }

  if (!videoData.description || videoData.description.length === 0) {
    errors.push('Video description is missing.');
  }

  // 3. Automated safety & monetization check via Gemini
  const model = getGeminiModel();
  if (model) {
    console.log('Running Gemini Safety & Monetization Audit...');
    const prompt = `
You are a YouTube Content Policy Audit Bot.
You need to inspect the following video metadata and narration script to ensure it is 100% compliant with YouTube Advertiser-Friendly Guidelines and is ready for monetization.

VIDEO DETAILS:
- Title: ${videoData.title}
- Description: ${videoData.description}
- Script Snippet: ${videoData.fullScript ? videoData.fullScript.substring(0, 1000) : 'No script provided'}

ADVERTISER-FRIENDLY POLICY GUIDELINES:
- No violence, hate speech, harassment, or self-harm content.
- No sexually suggestive content or adult themes.
- No dangerous or harmful acts.
- No controversial topics, misinformation, or sensitive events.
- No excessive profanity or inappropriate language.
- No misleading titles or clickbait that violates spam policies.

Evaluate the content and respond in JSON format matching this schema:
{
  "monetizationSafe": true | false,
  "flagReason": "Explain reasons if not safe, otherwise keep empty string",
  "containsProfanity": true | false,
  "misleadingMetadata": true | false
}
    `;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const audit = JSON.parse(text);

      if (!audit.monetizationSafe) {
        errors.push(`Gemini Safety Audit Failed: ${audit.flagReason}`);
      }
      if (audit.containsProfanity) {
        errors.push('Gemini Audit detected potential profanity/inappropriate language.');
      }
      if (audit.misleadingMetadata) {
        errors.push('Gemini Audit flagged the metadata as potentially misleading or clickbait.');
      }
    } catch (auditError) {
      console.warn('Gemini safety audit failed to complete. Defaulting to local keyword scan...', auditError.message);
      runLocalSafetyScan(videoData, errors);
    }
  } else {
    console.warn('Gemini API key is not configured. Running local keyword policy scan...');
    runLocalSafetyScan(videoData, errors);
  }

  const passed = errors.length === 0;
  if (passed) {
    console.log('✅ QC checks PASSED successfully!');
  } else {
    console.error('❌ QC checks FAILED with errors:');
    errors.forEach(e => console.error(`  - ${e}`));
  }

  return {
    passed,
    errors
  };
}

function runLocalSafetyScan(videoData, errors) {
  const restrictedKeywords = [
    'hack', 'crack', 'bypass', 'torrent', 'pirate', 'free steam', 'cheat code',
    'violence', 'abuse', 'kill', 'suicide', 'murder', 'bomb', 'terrorist'
  ];
  
  const textToScan = `${videoData.title} ${videoData.description} ${videoData.fullScript || ''}`.toLowerCase();
  
  for (const word of restrictedKeywords) {
    if (textToScan.includes(word)) {
      errors.push(`Local safety scan: Restricted keyword detected: "${word}"`);
    }
  }
}
