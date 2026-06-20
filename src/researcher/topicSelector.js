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

// Helper to retry Gemini calls on 429 Rate Limits and 5xx Server Errors with automatic 1.5-flash fallback
async function generateContentWithRetry(model, prompt, retries = 5, delay = 10000) {
  let currentModel = model;
  let fallbackAttempted = false;

  for (let i = 0; i < retries; i++) {
    try {
      return await currentModel.generateContent(prompt);
    } catch (error) {
      const status = error.status;
      const message = error.message || '';

      const isQuotaExceeded = status === 429 || 
                              message.includes('Quota exceeded') || 
                              message.includes('quota') || 
                              message.includes('Too Many Requests') ||
                              message.includes('429');

      if (isQuotaExceeded && !fallbackAttempted) {
        console.warn(`[Gemini Quota Warning] Quota/Rate limit exceeded. Falling back to gemini-2.0-flash...`);
        try {
          const apiKey = process.env.GEMINI_API_KEY;
          const genAI = new GoogleGenerativeAI(apiKey);
          currentModel = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: { responseMimeType: 'application/json' }
          });
          fallbackAttempted = true;
          i--; // Don't consume a retry attempt for switching models
          continue;
        } catch (fbErr) {
          console.error('[Gemini Fallback Error] Failed to initialize fallback model:', fbErr.message);
        }
      }

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
export async function selectDailyTopic(trendData, videoType, subType = '') {
  console.log(`Selecting daily topic for type: ${videoType} (Sub-type: ${subType || 'none'})...`);
  
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

  let subTypeInstructions = '';
  if (subType === 'tutorial') {
    subTypeInstructions = `
CRITICAL CORE CONSTRAINT:
For this video, you MUST select a highly common coding issue, syntax problem, bug, performance bottleneck, or programming puzzle that developers frequently face in their daily work (e.g. JavaScript async/promise errors, React rendering pitfalls, Python performance hacks, Next.js hydration issues, CSS grid/flexbox bugs, or Git merge conflicts). The selected topic MUST offer a clear coding solution that can be shown step-by-step in a code editor. Do NOT pick general AI news, tool releases, or general trends. It MUST be a coding tutorial solving a specific problem.
`;
  } else if (subType === 'single_scene_tech') {
    subTypeInstructions = `
CRITICAL CORE CONSTRAINT:
For this video, you MUST select a highly viral, funny, sarcastic, or informative technology fact, quirk, news, or relatable developer situation regarding any technology, programming language, hardware, space, Linux system, or web platform (e.g. JavaScript comparison quirks, Git commands, Docker hacks, database bugs, tech company news). It must fit a single-scene storyboard. It must be hilarious, sarcastic, and highly clickbait friendly to get millions of views.
`;
  } else if (subType === 'meme_tech_2scene') {
    subTypeInstructions = `
CRITICAL CORE CONSTRAINT:
For this video, you MUST select a highly viral, funny, sarcastic, or comic Expectation vs Reality meme, joke, or relatable developer struggle regarding any technology, coding language, framework, database, or software engineering process (e.g. CSS layout centering, deploying to production on a Friday, merge conflicts, code reviews, docker cache, legacy code). It must focus on general tech (not just AI) and have a clean 2-scene progression. It must be hilarious, sarcastic, and highly clickbait friendly.
`;
  }

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

${subTypeInstructions}

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
    return getFallbackCategoryTopic(videoType, subType);

  } catch (error) {
    console.error('Failed to select topic using Gemini. Falling back to category priority list.', error);
    return getFallbackCategoryTopic(videoType, subType);
  }
}

const TUTORIAL_FALLBACKS = [
  {
    topic: "Fixing React Infinite Re-renders inside useEffect Hook by managing dependencies",
    category: "Frontend Coding Hacks",
    suggestedTitle: "Stop React Infinite Re-renders! Fix useEffect Now",
    rationale: "Extremely common React beginner and intermediate developer mistake"
  },
  {
    topic: "Mastering JS Promise.all vs Promise.allSettled for robust API error handling",
    category: "Web Development Tutorials",
    suggestedTitle: "Promise.all vs allSettled: Stop Silent Crashes!",
    rationale: "Crucial for building resilient network layers in web apps"
  },
  {
    topic: "Solving CSS Flexbox and Grid layout shifting and content overflow issues",
    category: "Frontend Coding Hacks",
    suggestedTitle: "Fix CSS Overflow Hacks: Clean Responsive Layouts",
    rationale: "CSS alignment is a constant daily designer/developer struggle"
  },
  {
    topic: "How to resolve the Next.js Hydration Mismatch error when using window or localStorage",
    category: "New Tech Frameworks",
    suggestedTitle: "Fix Next.js Hydration Mismatch in 60 Seconds!",
    rationale: "Very common Server-Side Rendering issue in modern Next.js apps"
  }
];

const MEME_FALLBACKS = [
  {
    topic: "AI replacing developers but failing to center a simple CSS div layout",
    category: "AI News and Tool Releases",
    suggestedTitle: "AI will replace us... until it tries CSS! 💀",
    rationale: "Highly relatable developer joke about AI struggling with basic CSS alignment"
  },
  {
    topic: "ChatGPT confidently writing buggy code and saying it works perfectly",
    category: "ChatGPT and LLM Integrations",
    suggestedTitle: "When the AI says: 'Trust me, it works' 🤥",
    rationale: "Relatable experience of developers getting hallucinations from LLMs"
  },
  {
    topic: "Writing AI prompts for 4 hours to avoid 5 minutes of actual coding",
    category: "Developer Productivity Tools",
    suggestedTitle: "4 Hours Prompting to Save 5 Mins Coding! 🤡",
    rationale: "Classic developer procrastination and over-reliance on AI helpers"
  }
];

const TOOL_FALLBACKS = [
  {
    topic: "Cursor AI editor review showing why it is replacing VS Code",
    category: "AI Tools for Developers",
    suggestedTitle: "Is Cursor AI actually replacing VS Code?! 🤯",
    rationale: "Cursor is currently the most popular emerging AI developer tool"
  },
  {
    topic: "v0 by Vercel review showing how to generate UI in seconds",
    category: "AI News and Tool Releases",
    suggestedTitle: "Build Entire React UIs with Text Prompts! (v0.dev)",
    rationale: "Vercel's v0 is highly trending for front-end developers"
  },
  {
    topic: "Bolt.new full-stack browser development environment tool review",
    category: "Developer Productivity Tools",
    suggestedTitle: "Build & Deploy Full Stack Apps in Browser! (Bolt.new)",
    rationale: "Bolt.new is viral for instant browser-based app generation"
  }
];

// Fallback logic to iterate priority categories when scraper/LLM fails or duplicates everything
function getFallbackCategoryTopic(videoType, subType = '') {
  if (subType === 'tutorial') {
    console.log('[Topic Selector] Applying tutorial fallback topic list...');
    for (const fallback of TUTORIAL_FALLBACKS) {
      if (!db.hasTopicInLast7Days(fallback.topic)) {
        return {
          topic: fallback.topic,
          category: fallback.category,
          type: videoType,
          suggestedTitle: fallback.suggestedTitle,
          rationale: fallback.rationale
        };
      }
    }
    return {
      topic: TUTORIAL_FALLBACKS[0].topic,
      category: TUTORIAL_FALLBACKS[0].category,
      type: videoType,
      suggestedTitle: TUTORIAL_FALLBACKS[0].suggestedTitle,
      rationale: TUTORIAL_FALLBACKS[0].rationale
    };
  }

  if (subType === 'single_scene_tech') {
    console.log('[Topic Selector] Applying single-scene tech fallback...');
    const fallbacks = [
      {
        topic: "JavaScript comparison array quirks like empty array equals not empty array",
        category: "Web Development Tutorials",
        suggestedTitle: "JavaScript is completely wild! Explain this 🤡",
        rationale: "Classic JS comparison quirk popular on socials"
      },
      {
        topic: "How exit command in vim editor confuses junior developers",
        category: "Frontend Coding Hacks",
        suggestedTitle: "How to exit Vim: The developer struggle! 💀",
        rationale: "Universal developer meme about exiting Vim"
      }
    ];
    for (const fallback of fallbacks) {
      if (!db.hasTopicInLast7Days(fallback.topic)) {
        return {
          topic: fallback.topic,
          category: fallback.category,
          type: videoType,
          suggestedTitle: fallback.suggestedTitle,
          rationale: fallback.rationale
        };
      }
    }
    return {
      topic: fallbacks[0].topic,
      category: fallbacks[0].category,
      type: videoType,
      suggestedTitle: fallbacks[0].suggestedTitle,
      rationale: fallbacks[0].rationale
    };
  }

  if (subType === 'meme_tech_2scene') {
    console.log('[Topic Selector] Applying 2-scene tech meme fallback...');
    const fallbacks = [
      {
        topic: "Centering a simple CSS div layout under pressure",
        category: "Web Development Tutorials",
        suggestedTitle: "AI will replace us... until it tries CSS! 💀",
        rationale: "CSS div alignment struggle"
      },
      {
        topic: "Deploying to production server at 4:59 PM on a Friday afternoon",
        category: "Web Development Tutorials",
        suggestedTitle: "Never deploy to production on a Friday! 😭",
        rationale: "Friday deploy server crash"
      }
    ];
    for (const fallback of fallbacks) {
      if (!db.hasTopicInLast7Days(fallback.topic)) {
        return {
          topic: fallback.topic,
          category: fallback.category,
          type: videoType,
          suggestedTitle: fallback.suggestedTitle,
          rationale: fallback.rationale
        };
      }
    }
    return {
      topic: fallbacks[0].topic,
      category: fallbacks[0].category,
      type: videoType,
      suggestedTitle: fallbacks[0].suggestedTitle,
      rationale: fallbacks[0].rationale
    };
  }

  if (subType === 'tool') {
    console.log('[Topic Selector] Applying tool fallback topic list...');
    for (const fallback of TOOL_FALLBACKS) {
      if (!db.hasTopicInLast7Days(fallback.topic)) {
        return {
          topic: fallback.topic,
          category: fallback.category,
          type: videoType,
          suggestedTitle: fallback.suggestedTitle,
          rationale: fallback.rationale
        };
      }
    }
    return {
      topic: TOOL_FALLBACKS[0].topic,
      category: TOOL_FALLBACKS[0].category,
      type: videoType,
      suggestedTitle: TOOL_FALLBACKS[0].suggestedTitle,
      rationale: TOOL_FALLBACKS[0].rationale
    };
  }

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
