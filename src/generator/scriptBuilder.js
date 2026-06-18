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

  const isTutorial = topicInfo.subType === 'tutorial' || 
                    topicInfo.category === 'Web Development Tutorials' || 
                    topicInfo.category === 'Frontend Coding Hacks' || 
                    topicInfo.category === 'Developer Productivity Tools';
  
  let constraint = '';
  if (isTutorial) {
    constraint = `
- **Coding Tutorial Visual Constraint**: Since this is a coding tutorial, you MUST explain the solution by writing code in a code editor. Therefore:
  * At least 70-80% of all storyboard scenes MUST use the 'code' visual layout (e.g., 5 to 7 scenes in an 8-scene storyboard).
  * Do NOT use slides or B-roll for coding explanations. You can use at most 1 B-roll scene for the very first hook scene, and at most 1 slide scene for the final summary. All other scenes must be 'code' layout.
  * You MUST show the actual code syntax in the editor, starting with the buggy/incorrect code first (labeled with comments), and then show the corrected code (labeled with comments) typing out.
`;
  } else if (topicInfo.subType.startsWith('meme')) {
    constraint = `
- **AI Meme Sarcasm Constraint**: This is a funny, sarcastic AI meme video that functions like a static image/slide.
  * You MUST write a storyboard with EXACTLY ONE (1) scene.
  * Set the duration of this single scene strictly between 12 and 15 seconds.
  * You MUST set "voiceoverDisabled": true at the root of the JSON. There will be no spoken voiceover and no subtitle captions.
  * The visualType MUST be 'comic'.
  * The visualParams for this comic layout must contain:
    - "setup": "Setup text of the sarcastic meme (e.g., WHEN CLAUDE WRITES 500 LINES OF CODE ON THE FIRST TRY)"
    - "punchline": "Punchline text of the sarcastic meme (e.g., BUT NONE OF IT COMPILES AND NOW IT IS APOLOGIZING IN A LOOP)"
    - "keyword": "Detailed prompt for generating a sarcastic comic image/illustration via AI (e.g., A cartoon robot typing frantically on a glowing laptop, digital art, cyberpunk style)"
`;
  } else if (topicInfo.subType === 'tool') {
    constraint = `
- **AI Tool Review Constraint**: This is a review of an emerging AI tool.
  * You MUST explain: What the tool is, What it does, Price, Pros, and Cons.
  * The storyboard MUST contain slide layouts that show this information.
  * In the visualParams of these slide layouts, you MUST specify:
    - "website": "the-tool-website-domain-name" (e.g., "cursor.com")
    - "logo": "the-tool-logo-name" (one of: cursor, v0, bolt, chatgpt, vscode, javascript, python, github, ai_tool)
    - "title" and "bullets" fields.
`;
  }

  const prompt = `
You are an expert tech content production team (Strategist, Writer, SEO Expert). You need to write a fully unique, highly engaging, and SEO-optimized video script and storyboard package for a **${topicInfo.type.toUpperCase()}** video.

TOPIC DETAILS:
- Topic: ${topicInfo.topic}
- Category: ${topicInfo.category}
- Suggested Title: ${topicInfo.suggestedTitle}
${constraint}

SCRIPT AND RETENTION GUIDELINES:
- **Hook**: First 3-5 seconds must start with an intense, high-impact rhetorical question or a bold, high-stakes claim that creates immediate curiosity (e.g., "Stop wasting hours writing boilerplate code!", "Why is everyone using next.js when this framework is 10 times faster?"). The viewer must feel like they cannot afford to miss even a single second. Do NOT start with greetings or introductions.
- **Voiceover Delivery & Inflection Coaching**: Write in a style that translates to a highly dynamic, dramatic, and expressive voiceover:
  * Use question marks (?) to create rising vocal inflection on key queries.
  * Use exclamation points (!) and double hyphens (--) to mark high-impact points and build verbal momentum.
  * Use commas (,) and periods (.) strategically to create short, dramatic pauses for critical insights.
  * Keep sentences punchy, short, and extremely direct.
- **Structure**: Hook -> Relatable Problem Statement (detailing the bad code, pain point, or error) -> Actionable, Step-by-Step Solution (the corrected code or technique) -> Summary of results -> Clear call-to-action.
- **Tone**: Conversational, highly energetic, confident, and professional.
- **Length Constraint**: ${lengthConstraint}
- **Value Density & Visual Focus**: Eliminate all filler words. Teach concepts with maximum clarity.
- **Tutorial-Style Code Progression**: For coding, testing, or development topics, your code scenes MUST show a clear, easy-to-follow tutorial progression:
  * **Bad Code Scene**: Display the buggy, slow, or incorrect code first. Mark it clearly at the top with a comment like \`// ❌ BUGGY\` or \`# ❌ INEFFIENT\`. State the problem clearly in the narration, and use the \`highlight\` field to spotlight the bad line.
  * **Good Code Scene**: Display the fixed, optimized, or clean code next. Mark it clearly with a comment like \`// ✅ FIXED\` or \`# ✅ OPTIMIZED\`. Highlight the specific lines that solve the problem.
  * **Output Indicator**: In the final code scene, add a comment at the bottom showing the execution output (e.g. \`// Output: 4\` or \`# Result: 220x Faster!\`) so the solution feels fully verified and complete.
  * Keep code snippets extremely simple, short, and focused solely on the specific tip being taught. Use real syntax matching the language.

STORYBOARD & SCENE GUIDELINES:
- Break the narration script down into contiguous segments (scenes):
  *   For Shorts: The storyboard must contain EXACTLY 6 to 9 scenes. To keep retention high, NO SCENE OR VISUAL STATE CAN EXCEED 4 SECONDS (aim for 2-3 seconds per scene). Each scene narration text must be a complete sentence of 12-18 words.
  *   For Long-form: The storyboard must contain 25 to 40 scenes. Each scene visual state and narration should last between 8 and 18 seconds (typically 25 to 55 words per scene) so viewers have ample time to read the slides or code blocks.
- For each scene, define the spoken text and specify the visual layout:
  *   **code**: Show a mock code editor (VS Code) with syntax highlighting. Use this for at least 50% of the scenes to show concrete code examples.
  *   **slide**: A clean, modern slide card deck with a title and 1-2 bullet points. Use this for 30-40% of scenes to explain technical concepts.
  *   **stock_media**: Stock B-roll video. CRITICAL: Limit this to at most 1 scene in the entire video (e.g. only for the very first hook scene). Never use stock_media for coding or explanation scenes. The video must feel like a premium, professional programming tutorial, not a generic AI-stock-footage video. Define a highly relevant, concrete, and visually descriptive search keyword (1-3 words) for Pexels. Avoid generic words like "technology", "development", "programming", "testing". Instead, use highly specific visual terms like "cybersecurity hacker matrix", "robot hand typing", "server rack blinking", "iphone scrolling app", "brain glowing digital", "hud interface screen", "close up coding hands".
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
  "hashtags": ["hashtag1", "hashtag2"], // 15-20 hashtags, MUST include highly trending viral hashtags like: #Shorts, #TechMemes, #CodingHumor, #DeveloperLife, #Claude, #CursorAI, #ChatGPT, #WebDev, #SoftwareEngineering, #AIagents, #Automation, #FunnyTech, #OfficeHumor, #ProgrammerLife, #CodingMemes
  "voiceoverDisabled": false, // Set to true for music-only videos (only background music plays, no spoken narration)
  "thumbnail": {
    "text": "5-7 high CTR bold words",
    "theme": "layout style (e.g., neon-purple)",
    "logo": "brand logo element"
  },
  "storyboard": [
    {
      "sceneIndex": 1,
      "narration": "Text to be spoken aloud in this scene (keep under 10 words for fast pacing if needed, typically 2-4 seconds of speech).",
      "visualType": "code | slide | stock_media | comic",
      "zoomState": "zoom_in_center | zoom_in_left | zoom_in_right | pan_left | pan_right | normal",
      "visualParams": {
        // if comic:
        "setup": "Setup text of the sarcastic meme (large bold text at top)",
        "punchline": "Punchline text of the sarcastic meme (large bold text at bottom)",
        "keyword": "A detailed prompt to generate a sarcastic comic image/illustration via AI in the middle",

        // if code:
        "language": "javascript | python | bash | typescript",
        "code": "Actual code string to show on screen",
        
        // if slide:
        "title": "Slide Title text",
        "bullets": ["Bullet 1", "Bullet 2"],
        "highlight": "keyword to spotlight highlight",
        "website": "website link if tool review (e.g. cursor.com)",
        "logo": "logo name if tool review (e.g. cursor, v0, bolt, ai_tool, chatgpt, vscode, github)",
 
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
    
    if (topicInfo.subType.startsWith('meme')) {
      parsed.voiceoverDisabled = true;
    }
    
    const wordCount = fullScript.split(/\s+/).length;
    console.log(`Script generated successfully! (${wordCount} words)`);
    
    return parsed;
  } catch (error) {
    console.error('Failed to generate script package via Gemini:', error.message || error);
    
    if (topicInfo.subType.startsWith('meme')) {
      console.log('[Script Builder] Falling back to pre-written static AI Meme script...');
      const fallbackStoryboard = STATIC_MEME_SCRIPT.storyboard;
      const fallbackFullScript = fallbackStoryboard.map(s => s.narration).join(' ');
      return {
        ...STATIC_MEME_SCRIPT,
        fullScript: fallbackFullScript
      };
    } else if (topicInfo.subType === 'tool') {
      console.log('[Script Builder] Falling back to pre-written static AI Tool script...');
      const fallbackStoryboard = STATIC_TOOL_SCRIPT.storyboard;
      const fallbackFullScript = fallbackStoryboard.map(s => s.narration).join(' ');
      return {
        ...STATIC_TOOL_SCRIPT,
        fullScript: fallbackFullScript
      };
    } else if (topicInfo.subType === 'tutorial' || isTutorial) {
      console.log('[Script Builder] Falling back to pre-written static React useEffect tutorial script...');
      const fallbackStoryboard = STATIC_REACT_TUTORIAL_SCRIPT.storyboard;
      const fallbackFullScript = fallbackStoryboard.map(s => s.narration).join(' ');
      return {
        ...STATIC_REACT_TUTORIAL_SCRIPT,
        fullScript: fallbackFullScript
      };
    }
    
    console.log('[Script Builder] Falling back to default static React useEffect tutorial script...');
    const fallbackStoryboard = STATIC_REACT_TUTORIAL_SCRIPT.storyboard;
    const fallbackFullScript = fallbackStoryboard.map(s => s.narration).join(' ');
    return {
      ...STATIC_REACT_TUTORIAL_SCRIPT,
      fullScript: fallbackFullScript
    };
  }
}

const STATIC_REACT_TUTORIAL_SCRIPT = {
  title: "Stop React Infinite Re-renders! Fix useEffect Now",
  description: "Are your React components stuck in an infinite render loop? 🤯 Learn how to fix useEffect dependencies instantly! In this short tutorial, we show you the common mistake of updating state inside useEffect without a dependency array, and demonstrate the clean, optimized solution. Boost your React performance in under a minute!",
  tags: ["React", "useEffect", "react loops", "infinite render", "javascript", "react tutorial", "frontend coding", "web development", "hooks error"],
  hashtags: ["#ReactJS", "#useEffect", "#ReactHooks", "#CodingTips", "#WebDevelopment", "#JavaScript", "#FrontendDev"],
  thumbnail: {
    text: "Stop React Infinite Loop!",
    theme: "neon-purple",
    logo: "javascript"
  },
  storyboard: [
    {
      sceneIndex: 1,
      narration: "Is your React app freezing because of infinite component re-renders?!",
      visualType: "stock_media",
      zoomState: "zoom_in_center",
      visualParams: {
        keyword: "frustrated developer coding",
        overlayText: "Infinite Render Loop?!"
      },
      duration: 4
    },
    {
      sceneIndex: 2,
      narration: "This happens when you update state inside a useEffect hook without dependencies!",
      visualType: "code",
      zoomState: "zoom_in_left",
      visualParams: {
        language: "javascript",
        code: `// ❌ BUGGY
useEffect(() => {
  const count = data.length;
  setTotalCount(count);
});`,
        highlight: "2"
      },
      cursor: { action: "hover", line: 2 },
      duration: 5
    },
    {
      sceneIndex: 3,
      narration: "Every state update triggers a render, which calls useEffect again, looping forever!",
      visualType: "code",
      zoomState: "normal",
      visualParams: {
        language: "javascript",
        code: `// ❌ BUGGY
useEffect(() => {
  const count = data.length;
  setTotalCount(count); // Triggers re-render!
});`,
        highlight: "4"
      },
      cursor: { action: "click", line: 4 },
      duration: 6
    },
    {
      sceneIndex: 4,
      narration: "To fix this, you must declare your dependencies in a second argument array!",
      visualType: "code",
      zoomState: "zoom_in_right",
      visualParams: {
        language: "javascript",
        code: `// ✅ FIXED
useEffect(() => {
  const count = data.length;
  setTotalCount(count);
}, [data]);`,
        highlight: "5"
      },
      cursor: { action: "hover", line: 5 },
      duration: 6
    },
    {
      sceneIndex: 5,
      narration: "Now, React only runs this effect when the data array actually changes!",
      visualType: "code",
      zoomState: "normal",
      visualParams: {
        language: "javascript",
        code: `// ✅ FIXED
useEffect(() => {
  const count = data.length;
  setTotalCount(count);
}, [data]); // Only runs when data updates`,
        highlight: "5"
      },
      duration: 5
    },
    {
      sceneIndex: 6,
      narration: "Your app runs lightning fast and re-renders are completely solved!",
      visualType: "slide",
      zoomState: "pan_right",
      visualParams: {
        title: "React Performance Restored",
        bullets: ["No more infinite loops", "Optimal component renders"],
        highlight: "loops"
      },
      duration: 5
    },
    {
      sceneIndex: 7,
      narration: "Like, subscribe, and share your favorite React hook tip below!",
      visualType: "slide",
      zoomState: "zoom_in_center",
      visualParams: {
        title: "Subscribe for React Hacks!",
        bullets: ["New tips daily", "Drop your comments below"],
        highlight: "Subscribe"
      },
      duration: 5
    }
  ]
};

const STATIC_MEME_SCRIPT = {
  title: "AI vs Software Engineers: The Reality 🤡",
  description: "When the client thinks AI will replace all developers tomorrow... but forgets that they have to write the prompt describing what they actually want! Watch this trending tech meme. Like and subscribe for more developer sarcasm.",
  tags: ["ai memes", "developer humor", "coding jokes", "ai vs coder", "chatgpt fails", "programming memes", "web dev sarcasm", "tech shorts"],
  hashtags: ["#Shorts", "#TechMemes", "#CodingHumor", "#DeveloperLife", "#Claude", "#CursorAI", "#ChatGPT", "#WebDev", "#SoftwareEngineering", "#AIagents", "#Automation", "#FunnyTech", "#OfficeHumor", "#ProgrammerLife", "#CodingMemes"],
  voiceoverDisabled: true, // Music-only!
  thumbnail: {
    text: "AI Replacing Coder Reality!",
    theme: "cyberpunk-green",
    logo: "chatgpt"
  },
  storyboard: [
    {
      sceneIndex: 1,
      narration: "AI vs Software Engineers: The Reality!",
      visualType: "comic",
      zoomState: "normal",
      visualParams: {
        setup: "ME WATCHING THE AI AGENT AUTOMATE MY JOB IN REAL-TIME",
        punchline: "IT SPENT 4 HOURS DEBATING WITH ANOTHER BOT IN A SLACK CHANNEL",
        keyword: "two small funny cartoon robots arguing in a glowing neon digital chatroom bubble, technology sarcasm, 3d render digital art, dark background"
      },
      duration: 12 // Displays for 12 seconds!
    }
  ]
};

const STATIC_TOOL_SCRIPT = {
  title: "Is Cursor AI Actually Replacing VS Code? 🤯",
  description: "Cursor is the brand new AI-first fork of VS Code taking the developer world by storm. In this video, we review what Cursor is, what it does, its pricing, pros and cons, and whether you should switch today. Check out cursor.com! Subscribe for daily AI tool updates.",
  tags: ["Cursor AI", "VS Code", "AI code editor", "claude 3.5 sonnet", "developer productivity", "emerging AI tools", "programming tools"],
  hashtags: ["#CursorAI", "#VSCode", "#AICodeEditor", "#DeveloperTools", "#AITechnology", "#CodingTips", "#SoftwareDev"],
  voiceoverDisabled: false,
  thumbnail: {
    text: "VS Code Is Dead?",
    theme: "neon-purple",
    logo: "cursor"
  },
  storyboard: [
    {
      sceneIndex: 1,
      narration: "VS Code is officially dead and this AI code editor is the reason why!",
      visualType: "stock_media",
      zoomState: "zoom_in_center",
      visualParams: {
        keyword: "frustrated coder using computer",
        overlayText: "VS Code is Dead?!"
      },
      duration: 4
    },
    {
      sceneIndex: 2,
      narration: "Meet Cursor, an AI-first fork of VS Code that has complete codebase awareness!",
      visualType: "slide",
      zoomState: "normal",
      visualParams: {
        title: "What is Cursor?",
        bullets: ["AI-first fork of VS Code", "Full codebase awareness"],
        logo: "cursor",
        website: "cursor.com",
        highlight: "Cursor"
      },
      duration: 5
    },
    {
      sceneIndex: 3,
      narration: "You can write code inline using Control K or generate entire multi-file features using Composer!",
      visualType: "code",
      zoomState: "zoom_in_left",
      visualParams: {
        language: "javascript",
        code: `// Generate feature with Composer
// Command: Create a login form component in React
import React from 'react';
export function LoginForm() {
  return <form>...</form>;
}`,
        highlight: "5"
      },
      duration: 5
    },
    {
      sceneIndex: 4,
      narration: "It is free to start, and the Pro plan is twenty dollars per month for unlimited fast requests.",
      visualType: "slide",
      zoomState: "normal",
      visualParams: {
        title: "Cursor Pricing",
        bullets: ["Free tier: Basic features", "Pro tier: $20/month unlimited AI"],
        logo: "cursor",
        website: "cursor.com",
        highlight: "Pricing"
      },
      duration: 5
    },
    {
      sceneIndex: 5,
      narration: "Pros are lightning speed and Composer mode. Cons? High RAM usage and closed-source.",
      visualType: "slide",
      zoomState: "pan_right",
      visualParams: {
        title: "Pros & Cons",
        bullets: ["Pros: Multi-file edits, fast", "Cons: High RAM, closed source"],
        logo: "cursor",
        website: "cursor.com",
        highlight: "Pros"
      },
      duration: 6
    },
    {
      sceneIndex: 6,
      narration: "Try it out at cursor.com and subscribe for daily emerging AI tool reviews!",
      visualType: "slide",
      zoomState: "zoom_in_center",
      visualParams: {
        title: "Visit cursor.com",
        bullets: ["Subscribe for daily reviews", "Get more AI tool updates"],
        logo: "cursor",
        website: "cursor.com",
        highlight: "cursor.com"
      },
      duration: 5
    }
  ]
};

