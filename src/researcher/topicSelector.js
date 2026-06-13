import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from '../db/db.js';
import dotenv from 'dotenv';

dotenv.config();

const PRIORITIZED_CATEGORIES = [
  'AI Tools For Testers',
  'Playwright Tutorials',
  'Selenium Tutorials',
  'ChatGPT For Developers',
  'Free AI Tools',
  'QA Interview Questions',
  'Automation Framework Tips',
  'Web Development Tips',
  'API Testing',
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

// Select topic using Gemini
export async function selectDailyTopic(trendData, videoType) {
  console.log(`Selecting daily topic for type: ${videoType}...`);
  
  const model = getGeminiModel();
  
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

TODAY'S SCRAIPED TRENDING DATA:
${trendSummary}

INSTRUCTIONS:
1. Analyze today's trending tech topics, Reddit discussions, and popular GitHub repos.
2. Select a topic that matches one of our Prioritized Categories (preferred) OR fits perfectly within our Software Testing, QA Automation, AI Developer tools, and Web Development niches.
3. Keep the target audience in mind: Software Developers, QA Engineers, and Automation Specialists.
4. Recommend THREE (3) ranked topic options in order of strength so we can avoid duplication.
5. Each option must be a concrete, specific concept, NOT a broad category. (For example, instead of just "Playwright", propose "How to use Playwright UI Mode for interactive debugging").

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
    const result = await model.generateContent(prompt);
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
