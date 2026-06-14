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

// Helper to retry Gemini calls on 429 Rate Limits and 5xx Server Errors
async function generateContentWithRetry(model, prompt, retries = 5, delay = 10000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await model.generateContent(prompt);
    } catch (error) {
      const status = error.status;
      const isRetryable = status === 429 || status === 500 || status === 503 || status === 504 ||
                          (error.message && (
                            error.message.includes('429') ||
                            error.message.includes('500') ||
                            error.message.includes('503') ||
                            error.message.includes('504') ||
                            error.message.includes('Quota exceeded') ||
                            error.message.includes('Service Unavailable') ||
                            error.message.includes('high demand') ||
                            error.message.includes('temporary')
                          ));
      if (isRetryable && i < retries - 1) {
        const waitTime = delay * Math.pow(2, i);
        console.warn(`[Gemini Error] API failed with status ${status || 'unknown'}. Retrying in ${(waitTime/1000).toFixed(0)}s... (Attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
}

export async function generateScriptAndMetadata(topicInfo) {
  console.log(`Generating script and storyboard for: "${topicInfo.topic}"...`);
  const model = getGeminiModel();

  const isShort = topicInfo.type === 'short';
  const lengthConstraint = isShort
    ? 'Short duration (strictly 45-60 seconds). NARRATION SCRIPT MUST BE EXACTLY 110 TO 130 WORDS. Keep it extremely punchy, fast, and dense. The narration must take between 45 and 60 seconds to read.'
    : 'Long-form duration (5-10 minutes minimum). NARRATION SCRIPT MUST BE AT LEAST 800 TO 1200 WORDS. Structure: Hook (0-15s) -> Problem -> Explanation -> Code examples -> Real-world use cases -> Implementation -> Summary & CTA.';

  const prompt = `
You are an expert tech content production team (Strategist, Writer, SEO Expert). You need to write a fully unique, highly engaging, and SEO-optimized video script and storyboard package for a **${topicInfo.type.toUpperCase()}** video.

TOPIC DETAILS:
- Topic: ${topicInfo.topic}
- Category: ${topicInfo.category}
- Suggested Title: ${topicInfo.suggestedTitle}

SCRIPT AND RETENTION GUIDELINES:
- **Hook**: First 3-5 seconds must start with an intense, high-impact rhetorical question or a bold, high-stakes claim that creates immediate curiosity (e.g., "Stop wasting hours writing boilerplate code!", "Why is everyone using next.js when this framework is 10 times faster?"). The viewer must feel like they cannot afford to miss even a single second. Do NOT start with greetings or introductions.
- **Voiceover Delivery & Inflection Coaching**: Write in a style that translates to a highly dynamic, dramatic, and expressive voiceover:
  * Use question marks (?) to create rising vocal inflection on key queries.
  * Use exclamation points (!) and double hyphens (--) to mark high-impact points and build verbal momentum.
  * Insert commas (,) and periods (.) strategically to create short, dramatic pauses for critical insights.
  * Keep sentences punchy, short, and extremely direct.
- **Structure**: Hook -> Relatable Problem Statement (clearly detail the pain point, tool bottleneck, or error message) -> Actionable, Step-by-Step Solution (a clear coding or tool guide that demonstrates exactly how to fix the problem) -> Summary of results (time saved, bugs avoided) -> Clear call-to-action (Subscribe, Like, Comment).
- **Tone**: Conversational, highly energetic, confident, and professional.
- **Length Constraint**: ${lengthConstraint}
- **Value Density & Visual Focus**: Eliminate all filler words. Teach concepts with maximum clarity. The explanation must be immediately useful. If showing code or configurations, ensure the slides or code highlight tags target the exact lines that resolve the issue so the viewer can replicate the solution effortlessly.

STORYBOARD & SCENE GUIDELINES:
- Break the narration script down into contiguous segments (scenes):
  *   For Shorts: The storyboard must contain EXACTLY 6 to 9 scenes. To keep retention high, NO SCENE OR VISUAL STATE CAN EXCEED 4 SECONDS (aim for 2-3 seconds per scene). Each scene narration text must be a complete sentence of 12-18 words.
  *   For Long-form: The storyboard must contain 25 to 40 scenes. Each scene visual state and narration should last between 8 and 18 seconds (typically 25 to 55 words per scene) so viewers have ample time to read the slides or code blocks.
- For each scene, define the spoken text and specify the visual layout:
  *   **code**: Show a mock code editor (VS Code) with syntax highlighting.
  *   **slide**: A clean, modern slide card deck with a title and 1-2 bullet points.
  *   **stock_media**: Stock B-roll video. Define a highly relevant, concrete, and visually descriptive search keyword (1-3 words) for Pexels. Avoid generic words like "technology", "development", "programming", "testing". Instead, use highly specific visual terms like "cybersecurity hacker matrix", "robot hand typing", "server rack blinking", "iphone scrolling app", "brain glowing digital", "hud interface screen", "close up coding hands".
- In each scene, specify an estimate of the duration (in seconds) that it would take a narrator to read that scene's narration text.
- Every scene MUST specify an editing zoom effect:
  *   **zoomState**: 'normal' | 'zoom_in_center' | 'zoom_in_left' | 'zoom_in_right' | 'pan_left' | 'pan_right'
- For **code** layouts, you can optionally define a cursor action:
  *   **cursor**: { "action": "click" | "hover" | "none", "line": 3 } (simulates a mouse moving to and clicking/hovering a specific code line index).
- For **slide** and **code** layouts, you can optionally define a spotlight target:
  *   **highlight**: A keyword, phrase, or line index to highlight in a yellow spotlight glow.

THUMBNAIL GUIDELINES (Critical for CTR):
- Recommend 5-7 large, readable, high-CTR words for the thumbnail.
- Propose a layout style: 'dark-gradient', 'neon-purple', 'cyberpunk-green', or 'ocean-blue'.
- Propose a brand logo element: 'playwright', 'selenium', 'cypress', 'javascript', 'chatgpt', or 'vscode'.

You MUST respond in JSON format matching this schema:
{
  "title": "SEO optimized title (under 70 chars, primary keyword near front, CTR-phrased)",
  "description": "Compelling video description, first 2 lines must hook the viewer. Include timestamps for long videos.",
  "tags": ["tag1", "tag2"], // 20-30 tags
  "hashtags": ["hashtag1", "hashtag2"], // 15-20 hashtags
  "thumbnail": {
    "text": "5-7 high CTR bold words",
    "theme": "layout style (e.g., neon-purple)",
    "logo": "brand logo element"
  },
  "storyboard": [
    {
      "sceneIndex": 1,
      "narration": "Text to be spoken aloud in this scene (keep under 10 words for fast pacing if needed, typically 2-4 seconds of speech).",
      "visualType": "code | slide | stock_media",
      "zoomState": "zoom_in_center | zoom_in_left | zoom_in_right | pan_left | pan_right | normal",
      "visualParams": {
        // if code:
        "language": "javascript | python | bash | typescript",
        "code": "Actual code string to show on screen",
        
        // if slide:
        "title": "Slide Title text",
        "bullets": ["Bullet 1", "Bullet 2"],
        "highlight": "keyword to spotlight highlight",
 
        // if stock_media:
        "keyword": "Pexels search terms",
        "overlayText": "Optional overlay text on B-roll"
      },
      "cursor": {
        "action": "click | hover | none",
        "line": 1 // 1-indexed code line
      },
      "duration": 3 // Estimated duration in seconds (MUST be between 2 and 4 seconds for Shorts, or 8 and 18 seconds for Long-form!)
    }
  ]
}
`;

  try {
    const result = await generateContentWithRetry(model, prompt);
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
