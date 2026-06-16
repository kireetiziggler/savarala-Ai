import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from '../db/db.js';
import dotenv from 'dotenv';

dotenv.config();

const PRIORITIZED_CATEGORIES = [
  'AI News and Tool Releases',
  'AI Tools for Developers',
  'New Tech Frameworks',
  'Web Development Tutorials',
  'Frontend Coding Hacks',
  'ChatGPT and LLM Integrations',
  'Developer Productivity Tools',
  'Playwright and Selenium Automation',
  'QA Automation Architectures',
  'API and Backend Development',
  'Software Career Growth'
];

// Initialize Gemini
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

// Select topic using Gemini
export async function selectDailyTopic(trendData, videoType) {
  console.log(`Selecting daily topic for type: ${videoType}...`);
  
  const model = getGeminiModel();
  
  // Get last 10 generated videos for category rotation
  const recentHistory = db.getHistory()
    .slice(-10)
    .map(v => `  * Topic: "${v.topic}" | Category: "${v.category || 'Niche Trend'}" | Status: ${v.status}`)
    .join('\n');
  
  // Format trend data for the prompt
  const trendSummary = `
- REDDIT TRENDS:
${trendData.reddit.slice(0, 15).map(r => `  * [Score ${r.score}] ${r.title} (${r.source})`).join('\n')}

- GITHUB TRENDS:
${trendData.github.slice(0, 10).map(g => `  * ${g.title}`).join('\n')}

- GOOGLE DAILY TRENDS:
${trendData.google.slice(0, 15).map(t => `  * ${t.title} (${t.source})`).join('\n')}

- HACKER NEWS TRENDS:
${trendData.news.slice(0, 10).map(n => `  * ${n.title}`).join('\n')}
  `;

  const prompt = `
You are the Head of Research for a rapidly growing tech YouTube channel.
Your task is to select a single, highly engaging, monetization-friendly, and educational topic for a YouTube **${videoType.toUpperCase()}** video.

THE NICHES AND PRIORITIZED CATEGORIES (Priority 1 is highest):
${PRIORITIZED_CATEGORIES.map((cat, idx) => `${idx + 1}. ${cat}`).join('\n')}

RECENTLY GENERATED VIDEOS (Avoid category saturation and duplication):
${recentHistory || '  * None'}

TOD'S SCRAIPED TRENDING DATA:
${trendSummary}

INSTRUCTIONS:
1. Analyze today's trending tech topics, Reddit discussions, and popular GitHub repos.
2. For AI News and Tool Releases, focus on newly announced AI tools, models, libraries, or developer tools (e.g., new releases from Claude, Gemini, GPT, Cursor, local LLM advancements, or open-source AI projects). Explain what the tool is, why it matters, and how developers can use it.
3. For coding tutorials, focus heavily on identifying **real-world problems, troubleshooting issues, performance bottlenecks, or common frustrations** that developers and tech users are actively facing in their daily work (e.g., debugging flaky Playwright tests, solving CSS layout quirks, resolving complex Git merge conflicts, optimizing slow Docker builds, fixing Next.js hydration issues, or mastering AI developer tool integrations).
4. The selected topic must offer a **clear, actionable, and extremely practical step-by-step solution** (or clear walk-through of the news/features) so the video feels immediately useful.
5. Select a topic that matches one of our Prioritized Categories (preferred) OR fits perfectly within our Web Development, AI Tools, New Technologies, and QA Automation niches.
6. CRITICAL: Rotate content niches daily. Do NOT generate consecutive videos on the same sub-topic or niche (e.g. if the last video was about AI testing, pick a Web Development, Frontend Coding, or AI News topic).
7. AI News and new tool releases should be covered regularly (2-3 times a week, especially when new tools are trending). QA/Testing topics (like Playwright, Selenium, Test automation) must be covered AT MOST once or twice a week.
8. Prioritize high-value coding tutorials, frontend/backend developer hacks, new tech framework announcements (like Next.js, Bun, Tailwind, Vite), or AI developer tool walkthroughs.
9. Keep the target audience in mind: Software Developers, QA Engineers, and Automation Specialists.
10. Recommend THREE (3) ranked topic options in order of strength so we can avoid duplication.
11. Each option must be a concrete, specific concept, NOT a broad category. (For example, instead of just "Playwright", propose "How to resolve flaky tests using Playwright's auto-wait and tracing configurations").

You MUST respond in JSON format. Use the following schema:
{
  "options": [
    {
      "rank": 1,
      "topic": "The exact topic name",
      "category": "Matching category name from the priority list, or 'Niche Trend'",
      "rationale": "Why this topic is highly relevant right now based on scraping data",
      "suggestedTitle": "An attention-grabbing click-through-rate friendly title under 70 chars"
    },
    ...
  ]
}
  `;

  try {
    const result = await generateContentWithRetry(model, prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    
    if (!parsed.options || parsed.options.length === 0) {
      throw new Error('Gemini did not return any topic options');
    }

    // Go through options and select the first one that does NOT duplicate history in last 7 days
    for (const option of parsed.options) {
      const isDuplicate = db.hasTopicInLast7Days(option.topic);
      if (!isDuplicate) {
        console.log(`Topic selected: "${option.topic}" (Category: "${option.category}")`);
        return {
          topic: option.topic,
          category: option.category,
          type: videoType,
          suggestedTitle: option.suggestedTitle,
          rationale: option.rationale
        };
      } else {
        console.log(`Topic option skipped due to 7-day duplication rule: "${option.topic}"`);
      }
    }

    // If all options duplicate, fallback to the priority list based on history
    console.log('All scraper-based topics duplicate. falling back to category priority list...');
    return getFallbackCategoryTopic(videoType);

  } catch (error) {
    console.error('Failed to select topic using Gemini. Falling back to category priority list.', error);
    return getFallbackCategoryTopic(videoType);
  }
}

// Fallback logic to iterate priority categories when scraper/LLM fails or duplicates everything
function getFallbackCategoryTopic(videoType) {
  // Find which prioritized categories haven't been used recently, or cycle through them
  for (const category of PRIORITIZED_CATEGORIES) {
    if (!db.hasTopicInLast7Days(category)) {
      const title = videoType === 'short' 
        ? `Fast ${category} Tips You Need!`
        : `Ultimate ${category} Guide for Developers & QA`;
        
      return {
        topic: `${category} Essentials`,
        category: category,
        type: videoType,
        suggestedTitle: title,
        rationale: 'Fallback to content category priority list'
      };
    }
  }

  // Absolute baseline fallback
  return {
    topic: 'Software Testing Career Growth',
    category: 'Software Career Growth',
    type: videoType,
    suggestedTitle: 'How to Scale Your Software QA Career in 2026',
    rationale: 'Absolute baseline fallback'
  };
}
