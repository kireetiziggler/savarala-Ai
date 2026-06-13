import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: 'application/json' }
  });
}

export async function generateScriptAndMetadata(topicInfo) {
  console.log(`Generating script and storyboard for: "${topicInfo.topic}"...`);
  const model = getGeminiModel();

  const isShort = topicInfo.type === 'short';
  const lengthConstraint = isShort
    ? 'Short duration (30-60 seconds). NARRATION SCRIPT MUST BE EXACTLY 100 TO 130 WORDS. Keep it extremely punchy, fast, and dense.'
    : 'Long-form duration (5-10 minutes). NARRATION SCRIPT MUST BE AT LEAST 700 TO 1000 WORDS. Detail-rich, step-by-step, including code explanations.';

  const prompt = `
You are an expert tech educator and content creator. You need to write a fully unique, highly engaging, and SEO-optimized video script and storyboard package for a **${topicInfo.type.toUpperCase()}** video.

TOPIC DETAILS:
- Topic: ${topicInfo.topic}
- Category: ${topicInfo.category}
- Suggested Title: ${topicInfo.suggestedTitle}

SCRIPT AND RETENTION GUIDELINES:
- **Hook**: First 5 seconds must start with a compelling question, bold claim, or shocking developer fact. Do NOT start with "Welcome to my channel" or "Hey guys".
- **Structure**: Hook $\rightarrow$ Problem statement $\rightarrow$ Solution/Actionable tutorial $\rightarrow$ Summary $\rightarrow$ Clear call-to-action (Subscribe, Like, Comment).
- **Tone**: Conversational, confident, professional, and technical but easy to follow.
- **Length Constraint**: ${lengthConstraint}
- **Value Density**: Eliminate filler words. Get straight to the point.

STORYBOARD GUIDELINES:
- Break the narration script down into contiguous, logical segments (scenes).
- For each segment, define the spoken text and specify the visual layout:
  *   **code**: Visualizing a code snippet with clean syntax highlighting (e.g., writing/editing a test script in Playwright or Cypress).
  *   **slide**: A clean, modern slide layout with a central title and 2-3 bullet points.
  *   **stock_media**: Copyright-free stock video B-roll fetched from stock sites. Define a search keyword (e.g., "typing on keyboard", "confused programmer", "server server room").
- In each scene, specify an estimate of the duration (in seconds) that it would take a narrator to read that scene's narration text.

THUMBNAIL GUIDELINES (Only critical for Long videos, but provide anyway):
- Recommend 5-7 large, readable, high-CTR words for the thumbnail.
- Propose a layout style: 'dark-gradient', 'neon-purple', 'cyberpunk-green', or 'ocean-blue'.
- Propose a brand logo element: 'playwright', 'selenium', 'cypress', 'javascript', 'chatgpt', or 'vscode'.

You MUST respond in JSON format matching this schema:
{
  "title": "SEO optimized title (under 70 chars, primary keyword near front, CTR-phrased)",
  "description": "Compelling video description, first 2 lines must hook the viewer. For long videos, include mock timestamps like: 0:00 - Introduction, 1:15 - The Problem, etc.",
  "tags": ["tag1", "tag2", "tag3"], // 20-30 tags
  "hashtags": ["hashtag1", "hashtag2"], // 15-20 hashtags
  "thumbnail": {
    "text": "5-7 high CTR bold words",
    "theme": "layout style (e.g., neon-purple)",
    "logo": "brand logo element"
  },
  "storyboard": [
    {
      "sceneIndex": 1,
      "narration": "Text to be spoken aloud in this scene.",
      "visualType": "code | slide | stock_media",
      "visualParams": {
        // if code:
        "language": "javascript | python | bash | typescript",
        "code": "Actual code string to show on screen",
        
        // if slide:
        "title": "Slide Title text",
        "bullets": ["Bullet 1", "Bullet 2"],
        "highlight": "key word to highlight in yellow",

        // if stock_media:
        "keyword": "Pexels search terms",
        "overlayText": "Optional overlay text on B-roll"
      },
      "duration": 5 // Estimated duration in seconds for this scene's speech
    }
  ]
}
`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    // Double check that storyboard has narration script
    if (!parsed.storyboard || parsed.storyboard.length === 0) {
      throw new Error('Script generation failed: Storyboard is empty.');
    }

    // Combine all narrations to verify word count and form the full script
    const fullScript = parsed.storyboard.map(s => s.narration).join(' ');
    parsed.fullScript = fullScript;
    
    const wordCount = fullScript.split(/\s+/).length;
    console.log(`Script generated successfully! (${wordCount} words)`);
    
    return parsed;
  } catch (error) {
    console.error('Failed to generate script package via Gemini:', error);
    throw error;
  }
}
