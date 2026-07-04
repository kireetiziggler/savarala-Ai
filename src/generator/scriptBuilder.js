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
        console.warn(`[Gemini Quota Warning] Quota/Rate limit exceeded. Falling back to gemini-flash-latest...`);
        try {
          const apiKey = process.env.GEMINI_API_KEY;
          const genAI = new GoogleGenerativeAI(apiKey);
          currentModel = genAI.getGenerativeModel({
            model: 'gemini-flash-latest',
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

export async function generateScriptAndMetadata(topicInfo) {
  if (process.env.TEST_MOCK === 'true') {
    if (topicInfo.subType === 'single_scene_tech') {
      console.log('[TEST] Returning mock script for Single-Scene Tech Meme...');
      return MOCK_SINGLE_SCENE;
    } else if (topicInfo.subType === 'meme_tech_2scene') {
      console.log('[TEST] Returning mock script for 2-Scene Tech Meme...');
      return MOCK_2SCENE_MEME;
    } else if (topicInfo.subType === 'tutorial') {
      console.log('[TEST] Returning mock script for Coding Tutorial...');
      return MOCK_TUTORIAL;
    }
    console.log('[TEST] Returning mock script for Cursor AI...');
    return MOCK_UNIQUE_SCRIPT;
  }
  const model = getGeminiModel();
  let formatConstraints = '';
  let responseSchema = '';
  
  if (topicInfo.subType === 'single_scene_tech') {
    formatConstraints = `
CRITICAL FORMAT CONSTRAINT (Single-Scene Meme):
- This is a highly viral, funny, or sarcastic single-scene technology fact, joke, or news.
- You MUST write a storyboard with EXACTLY ONE (1) scene.
- Scene 1 duration must be strictly 12 seconds.
- You MUST set "voiceoverDisabled": true at the root of the JSON. There will be no spoken voiceover and no subtitle captions.
- The visualType MUST be 'comic'.
- The zoomState MUST be selected from: 'zoom_in_center', 'zoom_in_left', 'zoom_in_right', 'pan_left', 'pan_right'. Select one that best fits the emotion or action of the scene to create visual movement and hook the viewer immediately.
- visualParams must contain:
  * "setup": "Setup/Context text (e.g. WHEN JAVASCRIPT SEES AN ARRAY COMPARISON)"
  * "punchline": "The funny punchline or fact (e.g. [] == ![] IS ACTUALLY TRUE 🤡)"
  * "keyword": "A highly detailed, specific image generation prompt (without any placeholder text/names) that describes a realistic, high-quality photograph or real-life scene (e.g., 'a professional software developer sitting at a modern desk staring at a dual-monitor screen showing code, holding his head in frustration, natural lighting, sharp focus, real human, DSLR photography, 8k resolution, tech humor')"
- IMPORTANT SYNC RULE: The image generation prompt ("keyword") must NOT contain any raw text overlays or labels inside the image. It must focus entirely on drawing a clear, funny, high-impact physical scene or metaphor that conveys the exact situation described in the setup and punchline text cards.
`;

    responseSchema = `{
  "title": "SEO optimized title (under 50 chars, primary keyword near front, CTR-phrased, e.g. JavaScript Coercion is Wild! 🤡)",
  "description": "Compelling video description, first 2 lines must hook the viewer. Include viral tags and tech hashtags.",
  "tags": ["tag1", "tag2"], // 20-30 tags, must include viral tech/meme tags
  "hashtags": ["hashtag1", "hashtag2"], // 15-20 hashtags, MUST include: #Shorts, #TechMemes, #CodingHumor, #DeveloperLife, #WebDev, #SoftwareEngineering, #OfficeHumor, #ProgrammerLife, #CodingMemes
  "voiceoverDisabled": true,
  "thumbnail": {
    "text": "5-7 high CTR bold words",
    "theme": "layout style (e.g. cyberpunk-green)",
    "logo": "brand logo element (e.g. javascript, github, vscode)"
  },
  "storyboard": [
    {
      "sceneIndex": 1,
      "narration": "Text describing Scene 1 (e.g. When JavaScript array comparison evaluates to true)",
      "visualType": "comic",
      "zoomState": "normal",
      "visualParams": {
        "setup": "Setup text at the top",
        "punchline": "Punchline text",
        "keyword": "Detailed prompt to generate expectation image via AI"
      },
      "duration": 12
    }
  ]
}`;
  } else if (topicInfo.subType === 'meme_tech_2scene') {
    formatConstraints = `
CRITICAL FORMAT CONSTRAINT (2-Scene Meme):
- This is a funny, sarcastic technology meme that functions as a 2-scene progression (Expectation vs Reality).
- You MUST write a storyboard with EXACTLY TWO (2) scenes.
- Scene 1 (Expectation/Setup) duration must be strictly 10 seconds.
- Scene 2 (Reality/Punchline) duration must be strictly 10 seconds.
- You MUST set "voiceoverDisabled": true at the root of the JSON. There will be no spoken voiceover and no subtitle captions.
- For both scenes, the visualType MUST be 'comic'.
- For each scene, select a dynamic zoomState from: 'zoom_in_center', 'zoom_in_left', 'zoom_in_right', 'pan_left', 'pan_right' to create pattern interrupts and reset viewer attention. Avoid using 'normal' for all scenes.
- For Scene 1, visualParams must contain:
  * "setup": "Expectation Setup text (e.g. EXPECTATION: DEPLOYING TO PRODUCTION ON A FRIDAY)"
  * "punchline": "Expectation Hope text (e.g. WALKING OUT OF THE OFFICE LIKE A BOSS)"
  * "keyword": "A highly detailed, specific image generation prompt (without any placeholder text/names) that describes a realistic, high-quality photograph or real-life representation of the scene (e.g., 'a cool software developer wearing sunglasses confidently walking away from a modern glass office building, sunny day, natural lighting, DSLR photo, sharp focus')"
- For Scene 2, visualParams must contain:
  * "setup": "Reality Setup text (e.g. REALITY: SERVER CRASHED AT 5:01 PM)"
  * "punchline": "Final punchline text (e.g. THE CLIENT HAS CALLED MY PHONE 14 TIMES ALREADY)"
  * "keyword": "A highly detailed, specific image generation prompt that describes a realistic, high-quality photograph or real-life representation of the reality punchline (e.g., 'a computer server tower in a dark server room with realistic smoke rising from it, emergency blinking red warning lights, realistic details, DSLR photo')"
- IMPORTANT SYNC RULE: The image generation prompt ("keyword") must NOT contain any raw text overlays or labels inside the image. It must focus entirely on drawing a clear, funny, high-impact physical scene or metaphor that conveys the exact situation described in the setup and punchline text cards.
`;

    responseSchema = `{
  "title": "SEO optimized title (under 50 chars, primary keyword near front, CTR-phrased, e.g. Friday Deployments Go Wrong! 😭)",
  "description": "Compelling video description, first 2 lines must hook the viewer. Include viral tags and tech hashtags.",
  "tags": ["tag1", "tag2"], // 20-30 tags, must include viral tech/meme tags
  "hashtags": ["hashtag1", "hashtag2"], // 15-20 hashtags, MUST include: #Shorts, #TechMemes, #CodingHumor, #DeveloperLife, #WebDev, #SoftwareEngineering, #OfficeHumor, #ProgrammerLife, #CodingMemes
  "voiceoverDisabled": true,
  "thumbnail": {
    "text": "5-7 high CTR bold words",
    "theme": "layout style (e.g. cyberpunk-green)",
    "logo": "brand logo element (e.g. github, vscode, cursor)"
  },
  "storyboard": [
    {
      "sceneIndex": 1,
      "narration": "Text describing Scene 1 (e.g. Deploying code on Friday expectation)",
      "visualType": "comic",
      "zoomState": "normal",
      "visualParams": {
        "setup": "Expectation text at the top",
        "punchline": "Punchline text",
        "keyword": "Detailed prompt to generate expectation image via AI"
      },
      "duration": 10
    },
    {
      "sceneIndex": 2,
      "narration": "Text describing Scene 2 (e.g. Servers crashing reality)",
      "visualType": "comic",
      "zoomState": "normal",
      "visualParams": {
        "setup": "Reality text at the top",
        "punchline": "Punchline text",
        "keyword": "Detailed prompt to generate reality image via AI"
      },
      "duration": 10
    }
  ]
}`;
  } else {
    formatConstraints = `
CRITICAL FORMAT CONSTRAINT (Coding Tutorial):
- This is a highly professional, educational coding tutorial solving a specific, common programmer bug or troubleshooting topic.
- You MUST write a storyboard with 3 to 5 scenes.
- Total video duration should sum to ~45-55 seconds.
- You MUST set "voiceoverDisabled": false at the root of the JSON. There WILL be spoken voiceover and subtitle captions.
- For each scene, select a dynamic zoomState from: 'zoom_in_center', 'zoom_in_left', 'zoom_in_right', 'pan_left', 'pan_right' to create pattern interrupts and reset viewer attention.
- For each scene, you can choose visualType: 'slide' or 'code'.
- For 'slide' visualType, visualParams must contain:
  * "title": "Slide Title"
  * "bullets": ["Bullet 1", "Bullet 2"]
- For 'code' visualType, visualParams must contain:
  * "language": "javascript" or "python"
  * "code": "Code snippet to display"
  * "highlight": "Line number to highlight (e.g. 3)"
`;

    responseSchema = `{
  "title": "SEO optimized title (under 50 chars, primary keyword near front, CTR-phrased, e.g. Fix React useEffect Loop! 🤯)",
  "description": "Compelling video description, first 2 lines must hook the viewer. Include viral tags and tech hashtags.",
  "tags": ["tag1", "tag2"], // 20-30 tags, must include viral coding tags
  "hashtags": ["hashtag1", "hashtag2"], // 15-20 hashtags, MUST include: #Shorts, #CodingTutorial, #ReactJS, #NextJS, #WebDevelopment, #LearnCoding, #ProgrammingTutorial
  "voiceoverDisabled": false,
  "thumbnail": {
    "text": "5-7 high CTR bold words",
    "theme": "layout style (e.g. cyberpunk-green)",
    "logo": "brand logo element (e.g. javascript, react, vscode)"
  },
  "storyboard": [
    {
      "sceneIndex": 1,
      "narration": "Narration text describing Scene 1 (This will be synthesized into spoken voiceover)",
      "visualType": "slide",
      "zoomState": "normal",
      "visualParams": {
        "title": "Step 1 Title",
        "bullets": ["Bullet 1 text", "Bullet 2 text"]
      },
      "duration": 12
    },
    {
      "sceneIndex": 2,
      "narration": "Narration text describing Scene 2 code editor",
      "visualType": "code",
      "zoomState": "normal",
      "visualParams": {
        "language": "javascript",
        "code": "const count = 0;\\n...",
        "highlight": "2"
      },
      "duration": 15
    }
  ]
}`;
  }

  const prompt = `
You are an expert tech content production team (Strategist, Writer, SEO Expert). You need to write a highly viral, funny, and SEO-optimized daily tech video script and storyboard package.

ADVERTISER-FRIENDLY & SAFETY CONSTRAINTS:
- Do NOT use any profanity, vulgarity, or inappropriate language.
- CRITICAL: Do NOT use internet slang/abbreviations representing profanity or vulgar expressions, including but not limited to "WTF", "LMAO", "STFU", etc. in the script, title, description, tags, or hashtags. Keep all content advertiser-friendly and eligible for monetization.

VIRAL SHORTS BEST PRACTICES (To get millions of views):
1. THE 2-SECOND HOOK: Start the very first sentence of the narration (or the setup card text) with instant tension, surprise, or curiosity (e.g., "This one line of CSS changes everything...", "Stop using React useEffect like this...", "Why Senior devs hate Friday deploys..."). Never use generic greetings like "Welcome back" or "Hey guys".
2. THE INFINITE LOOP: Write the script's narration so that the final 3-4 words of the video lead seamlessly back into the first 3-4 words of the video's hook. This creates an infinite, seamless loop when played on YouTube, driving viewer retention past 100%.
3. DYNAMIC PACING: Ensure each scene flows rapidly, making it clear, high-impact, and directly focused on the trending topic.

TOPIC DETAILS:
- Topic: ${topicInfo.topic}
- Category: ${topicInfo.category}
- Suggested Title: ${topicInfo.suggestedTitle}

${formatConstraints}

You MUST respond in JSON format matching this schema:
${responseSchema}
`;

  try {
    const result = await generateContentWithRetry(model, prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    const expectedLength = topicInfo.subType === 'single_scene_tech' ? 1 : (topicInfo.subType === 'meme_tech_2scene' ? 2 : 3);
    if (!parsed.storyboard || parsed.storyboard.length === 0) {
      throw new Error('Script generation failed: Storyboard is empty or missing.');
    }
    if (topicInfo.subType === 'single_scene_tech' && parsed.storyboard.length !== 1) {
      throw new Error(`Script generation failed: Single-scene storyboard must have exactly 1 scene, got ${parsed.storyboard.length}`);
    }
    if (topicInfo.subType === 'meme_tech_2scene' && parsed.storyboard.length !== 2) {
      throw new Error(`Script generation failed: 2-scene storyboard must have exactly 2 scenes, got ${parsed.storyboard.length}`);
    }
    if (topicInfo.subType === 'tutorial' && parsed.storyboard.length < 3) {
      throw new Error(`Script generation failed: Tutorial storyboard must have at least 3 scenes, got ${parsed.storyboard.length}`);
    }

    const fullScript = parsed.storyboard.map(s => s.narration).join(' ');
    parsed.fullScript = fullScript;
    parsed.voiceoverDisabled = parsed.voiceoverDisabled === undefined ? true : (parsed.voiceoverDisabled === true || parsed.voiceoverDisabled === 'true');

    console.log(`Script generated successfully! (${parsed.storyboard.length} scenes, voiceoverDisabled: ${parsed.voiceoverDisabled})`);
    return parsed;
  } catch (error) {
    console.error('Failed to generate script package via Gemini:', error.message || error);
    throw error;
  }
}

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
      narration: "AI vs Software Engineers: The Expectation!",
      visualType: "comic",
      zoomState: "normal",
      visualParams: {
        setup: "EXPECTATION: AUTOMATING MY ENTIRE JOB WITH AI AGENTS",
        punchline: "I WILL BE CHILLING ON A BEACH WHILE BOTS WRITE CODE",
        keyword: "A happy cartoon robot sitting on a tropical beach chair under a palm tree typing on a laptop, digital art, vibrant colors, sunny day"
      },
      duration: 10
    },
    {
      sceneIndex: 2,
      narration: "AI vs Software Engineers: The Reality!",
      visualType: "comic",
      zoomState: "normal",
      visualParams: {
        setup: "REALITY: 4 HOURS IN",
        punchline: "IT SPENT $500 DEBATING WITH ANOTHER BOT IN A SLACK CHANNEL",
        keyword: "two small funny cartoon robots arguing in a glowing neon digital chatroom bubble, technology sarcasm, 3d render digital art, dark background"
      },
      duration: 10
    }
  ]
};

const MOCK_UNIQUE_SCRIPT = {
  title: "Cursor AI editor vs Lazy Programmer! 🤡",
  description: "Spend 4 hours writing the perfect prompt in Cursor AI to save 5 minutes of coding... only to spend 3 hours debugging. Like and subscribe for developer memes!",
  tags: ["cursor ai", "developer humor", "coding memes", "vscode vs cursor", "funny programming"],
  hashtags: ["#Shorts", "#TechMemes", "#CodingHumor", "#DeveloperLife", "#CursorAI", "#ChatGPT", "#SoftwareEngineering", "#WebDev", "#CodingMemes"],
  voiceoverDisabled: true,
  thumbnail: {
    text: "Cursor AI vs Lazy Coder",
    theme: "cyberpunk-green",
    logo: "cursor"
  },
  storyboard: [
    {
      sceneIndex: 1,
      narration: "Cursor AI expectation vs reality!",
      visualType: "comic",
      zoomState: "normal",
      visualParams: {
        setup: "EXPECTATION: WRITING CURSOR PROMPTS FOR 4 HOURS",
        punchline: "TO AVOID 5 MINUTES OF ACTUAL MANUAL CODING",
        keyword: "A cute programmer cartoon character laying on a couch with a keyboard floating in the air, feeling lazy and chill, digital art, vibrant colors"
      },
      duration: 10
    },
    {
      sceneIndex: 2,
      narration: "Debugging AI code!",
      visualType: "comic",
      zoomState: "normal",
      visualParams: {
        setup: "REALITY: SPENDING 3 HOURS",
        punchline: "DEBUGGING THE AI-GENERATED SPAGHETTI HACKS IN CURSOR",
        keyword: "A cartoon programmer exhausted, surrounded by glowing computer screens showing tangled neon lines of code, digital art, technology humor"
      },
      duration: 10
    }
  ]
};

const MOCK_SINGLE_SCENE = {
  title: "JavaScript comparison array quirks! 🤡",
  description: "When JavaScript empty array comparison is completely wild... Like and subscribe for tech humor!",
  tags: ["javascript quirks", "js array comparison", "programming memes", "javascript logic"],
  hashtags: ["#Shorts", "#TechMemes", "#CodingHumor", "#DeveloperLife", "#WebDev", "#JavaScript", "#CodingMemes"],
  voiceoverDisabled: true,
  thumbnail: {
    text: "JS Comparison is Wild!",
    theme: "cyberpunk-green",
    logo: "javascript"
  },
  storyboard: [
    {
      sceneIndex: 1,
      narration: "JavaScript array comparison evaluates to true!",
      visualType: "comic",
      zoomState: "normal",
      visualParams: {
        setup: "WHEN JAVASCRIPT SEES AN ARRAY COMPARISON",
        punchline: "[] == ![] IS ACTUALLY TRUE 🤡",
        keyword: "A funny cartoon programmer staring at a glowing yellow computer screen showing code, holding his head in surprise, digital art, vibrant colors, tech humor"
      },
      duration: 12
    }
  ]
};

const MOCK_2SCENE_MEME = {
  title: "Friday production deployment reality! 😭",
  description: "Thinking you are deploying to production branch on a Friday at 4:59 PM, but server crashes immediately. Like and subscribe.",
  tags: ["friday deployment", "server crash", "git push main", "developer humor"],
  hashtags: ["#Shorts", "#TechMemes", "#CodingHumor", "#DeveloperLife", "#Github", "#FridayDeploy", "#CodingMemes"],
  voiceoverDisabled: true,
  thumbnail: {
    text: "Friday Deploy Crisis",
    theme: "cyberpunk-green",
    logo: "github"
  },
  storyboard: [
    {
      sceneIndex: 1,
      narration: "Deploying on Friday expectation!",
      visualType: "comic",
      zoomState: "normal",
      visualParams: {
        setup: "EXPECTATION: DEPLOYING TO PRODUCTION ON A FRIDAY",
        punchline: "AND WALKING OUT OF THE OFFICE LIKE A BOSS",
        keyword: "A cool cartoon developer wearing sunglasses walking away from an office building, smiling, digital art, vibrant colors"
      },
      duration: 10
    },
    {
      sceneIndex: 2,
      narration: "Production server crashes reality!",
      visualType: "comic",
      zoomState: "normal",
      visualParams: {
        setup: "REALITY: SERVER CRASHED AT 5:01 PM",
        punchline: "AND THE CLIENT HAS CALLED MY PHONE 14 TIMES ALREADY",
        keyword: "A computer server tower on fire in a dark server room, with cartoon smoke, flames, and emergency red lights flashing, digital art"
      },
      duration: 10
    }
  ]
};

const MOCK_TUTORIAL = {
  title: "Stop React useEffect Infinite loops! 🤯",
  description: "How to fix React useEffect infinite re-render loops by properly managing state dependencies. Like and subscribe for programming tutorials.",
  tags: ["react tutorial", "react useEffect loop", "react re-renders", "reactjs bugs"],
  hashtags: ["#Shorts", "#CodingTutorial", "#ReactJS", "#WebDevelopment", "#LearnCoding", "#ProgrammingTutorial"],
  voiceoverDisabled: false,
  thumbnail: {
    text: "Fix useEffect Loop!",
    theme: "cyberpunk-green",
    logo: "javascript"
  },
  storyboard: [
    {
      sceneIndex: 1,
      narration: "React useEffect loops are one of the most common ways to accidentally crash your browser. Today, we are going to fix it in under sixty seconds. Let's dive in.",
      visualType: "slide",
      zoomState: "normal",
      visualParams: {
        title: "React useEffect Loop",
        bullets: ["Why does my component re-render infinitely?", "It happens when state updates trigger useEffect in a loop."]
      },
      duration: 12
    },
    {
      sceneIndex: 2,
      narration: "Here is the buggy code. Notice how updating state inside the useEffect Hook updates the data variable, which then triggers the dependency array, making the Hook run all over again in an infinite loop.",
      visualType: "code",
      zoomState: "normal",
      visualParams: {
        language: "javascript",
        code: "useEffect(() => {\n  setData(fetchData());\n}, [data]);",
        highlight: "2"
      },
      duration: 15
    },
    {
      sceneIndex: 3,
      narration: "To fix this, we can pass an empty dependencies array to run the effect only on mount, or we can add a simple condition to verify if the data has already been fetched before updating state.",
      visualType: "slide",
      zoomState: "normal",
      visualParams: {
        title: "The Clean Fix",
        bullets: ["Pass an empty dependency array for mount-only", "Or only call set data if it changed."]
      },
      duration: 15
    },
    {
      sceneIndex: 4,
      narration: "Now our component renders cleanly, only loading data once without crashing the app. Share this with a developer who needs it, and subscribe for more clean code tutorials!",
      visualType: "slide",
      zoomState: "normal",
      visualParams: {
        title: "Clean Code",
        bullets: ["No more infinite loops or memory leaks", "Subscribe for daily programming tips!"]
      },
      duration: 10
    }
  ]
};
