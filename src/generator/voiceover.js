import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { MsEdgeTTS } from 'msedge-tts';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Get the duration of an audio file using FFmpeg stderr output
export function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    // Run ffmpeg -i and capture the output (which is printed to stderr)
    exec(`"${ffmpegPath}" -i "${filePath}"`, (error, stdout, stderr) => {
      const output = stderr || stdout;
      const match = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);
        const hundredths = parseInt(match[4], 10);
        const duration = hours * 3600 + minutes * 60 + seconds + hundredths / 100;
        resolve(duration);
      } else {
        // If it's a very short audio, it might not print in this exact format. Default fallback:
        resolve(0);
      }
    });
  });
}

// Aligns word boundary timestamps from processed TTS text back to original narration words
function normalizeForMatching(word) {
  let normalized = word.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();
  
  // Map tech contractions/acronyms to expected spoken form without spaces
  const mappings = {
    'json': 'jayson',
    'sql': 'sequel',
    'nosql': 'nosequel',
    'devs': 'developers',
    'dev': 'developer',
    'config': 'configuration'
  };
  
  if (mappings[normalized]) {
    return mappings[normalized];
  }
  return normalized;
}

function alignTimings(originalWords, ttsTimings) {
  const aligned = [];
  let ttsIdx = 0;
  
  for (let i = 0; i < originalWords.length; i++) {
    const origWord = originalWords[i];
    const normalizedOrig = normalizeForMatching(origWord);
    
    if (!normalizedOrig) {
      // Pure punctuation: assign timing of preceding word or start at 0
      const prev = aligned[aligned.length - 1] || { start: 0, end: 0 };
      aligned.push({ word: origWord, start: prev.end, end: prev.end });
      continue;
    }
    
    let start = -1;
    let end = -1;
    let accumulatedText = "";
    let consumedCount = 0;
    
    // Safety guardrail: consume at most 5 TTS words to align a single original word
    while (ttsIdx < ttsTimings.length && consumedCount < 5) {
      const ttsWordObj = ttsTimings[ttsIdx];
      const normalizedTts = normalizeForMatching(ttsWordObj.word);
      accumulatedText += normalizedTts;
      
      if (start === -1) start = ttsWordObj.start;
      end = ttsWordObj.end;
      
      ttsIdx++;
      consumedCount++;
      
      // Match check
      if (accumulatedText.includes(normalizedOrig) || normalizedOrig.includes(accumulatedText)) {
        if (accumulatedText.length >= normalizedOrig.length) {
          break;
        }
      }
    }
    
    if (consumedCount === 5 && ttsIdx < ttsTimings.length) {
      console.warn(`[Subtitle Sync Warning] Alignment fallback hit for word "${origWord}" (normalized: "${normalizedOrig}"). Accumulated: "${accumulatedText}". Prevents runaway drift.`);
    }
    
    aligned.push({
      word: origWord,
      start: start !== -1 ? start : (aligned[aligned.length - 1]?.end || 0),
      end: end !== -1 ? end : (aligned[aligned.length - 1]?.end || 0)
    });
  }
  
  return aligned;
}

// Generate voiceover audio using Edge TTS and capture word boundary timestamps
async function generateEdgeTTS(processedText, outputPath, locale, jsonOutputPath, originalText) {
  try {
    const tts = new MsEdgeTTS();
    const voice = locale || 'en-IN-NeerjaNeural';
    
    // Set metadata and request word boundary markers
    await tts.setMetadata(voice, 'audio-24khz-48kbitrate-mono-mp3', {
      wordBoundaryEnabled: true
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Edge TTS request timed out after 15 seconds')), 15000);
    });

    const generatePromise = (async () => {
      const { audioStream, metadataStream } = await tts.toStream(processedText);
      
      const audioWriter = fs.createWriteStream(outputPath);
      audioStream.pipe(audioWriter);
      
      const ttsTimings = [];
      metadataStream.on('data', (chunk) => {
        try {
          const textDecoder = new TextDecoder();
          const metadataStr = textDecoder.decode(chunk);
          const parsed = JSON.parse(metadataStr);
          if (parsed.Metadata && parsed.Metadata[0] && parsed.Metadata[0].Type === 'WordBoundary') {
            const boundary = parsed.Metadata[0].Data;
            ttsTimings.push({
              word: boundary.text.Text,
              start: boundary.Offset / 10000000,
              end: (boundary.Offset + boundary.Duration) / 10000000
            });
          }
        } catch (err) {
          // Ignore JSON/parsing warnings
        }
      });
      
      await new Promise((resolve, reject) => {
        audioWriter.on('finish', resolve);
        audioWriter.on('error', reject);
      });
      
      // Align timings back to original script narration
      if (jsonOutputPath && ttsTimings.length > 0 && originalText) {
        const originalWords = originalText.trim().split(/\s+/);
        const alignedTimings = alignTimings(originalWords, ttsTimings);
        fs.writeFileSync(jsonOutputPath, JSON.stringify(alignedTimings, null, 2), 'utf-8');
        console.log(`Aligned word boundary timestamps saved at: ${jsonOutputPath}`);
      }
      
      console.log(`Edge TTS Voiceover generated at: ${outputPath}`);
    })();

    await Promise.race([generatePromise, timeoutPromise]);
  } catch (error) {
    console.error('Edge TTS generation failed:', error.message || error);
    throw error;
  }
}

// Generate voiceover audio using ElevenLabs
async function generateElevenLabsTTS(text, outputPath, voiceId, apiKey) {
  try {
    const vId = voiceId || '21m00Tcm4TlvDq8ikWAM'; // Default Rachel voice
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${vId}`;
    
    const response = await axios({
      method: 'post',
      url: url,
      headers: {
        'accept': 'audio/mpeg',
        'content-type': 'application/json',
        'xi-api-key': apiKey
      },
      data: {
        text: text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      },
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('ElevenLabs TTS generation failed:', error.message);
    throw error;
  }
}

// Preprocess text for better pronunciation of technical terms
function preprocessTextForTTS(text) {
  let cleanText = text
    .replace(/[`*_\[\]()]/g, '') // strip markdown
    .replace(/&/g, ' and ')
    .replace(/</g, '')
    .replace(/>/g, '')
    .replace(/_/g, ' '); // replace underscores with spaces (e.g., iter_fields -> iter fields)

  return cleanText
    .replace(/\bAPI\b/g, 'A P I')
    .replace(/\bAPIs\b/g, 'A P I s')
    .replace(/\bUI\b/g, 'U I')
    .replace(/\bQA\b/g, 'Q A')
    .replace(/\bURL\b/g, 'U R L')
    .replace(/\bURLs\b/g, 'U R L s')
    .replace(/\bnpm\b/gi, 'n p m')
    .replace(/\bJSON\b/gi, 'jay-son')
    .replace(/\bVS Code\b/gi, 'V S Code')
    .replace(/\bCI\/CD\b/gi, 'C I C D')
    .replace(/\bCSS\b/gi, 'C S S')
    .replace(/\bHTML\b/gi, 'H T M L')
    .replace(/\bIDE\b/gi, 'I D E')
    .replace(/\bSQL\b/gi, 'sequel')
    .replace(/\bGitHub\b/gi, 'Git Hub')
    .replace(/\bGitlab\b/gi, 'Git Lab')
    .replace(/\bNoSQL\b/gi, 'no-sequel')
    .replace(/\bdevs\b/gi, 'developers')
    .replace(/\bdev\b/gi, 'developer')
    .replace(/\bconfig\b/gi, 'configuration');
}

// Main generation function
export async function generateVoiceover(text, outputPath, jsonOutputPath) {
  const provider = (process.env.TTS_PROVIDER || 'edge').toLowerCase();
  const locale = process.env.VOICEOVER_LOCALE;
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const processedText = preprocessTextForTTS(text);

  let duration = 0;
  let attempts = 0;
  
  while (duration === 0 && attempts < 3) {
    attempts++;
    try {
      if (provider === 'elevenlabs' && elevenLabsKey) {
        console.log(`Generating premium voiceover with ElevenLabs (attempt ${attempts})...`);
        await generateElevenLabsTTS(processedText, outputPath, elevenLabsVoiceId, elevenLabsKey);
      } else {
        if (provider === 'elevenlabs') {
          console.warn('ElevenLabs API key is missing. Falling back to free Microsoft Edge TTS.');
        }
        console.log(`Generating free voiceover with Microsoft Edge TTS (attempt ${attempts})...`);
        await generateEdgeTTS(processedText, outputPath, locale, jsonOutputPath, text);
      }

      duration = await getAudioDuration(outputPath);
    } catch (err) {
      console.error(`Voiceover generation attempt ${attempts} failed:`, err.message);
      duration = 0;
    }

    if (duration === 0 && attempts < 3) {
      console.warn(`[TTS Warning] Generated audio has 0.00s duration or failed. Retrying in 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  if (duration === 0) {
    console.error(`[TTS Error] Failed to generate valid voiceover after 3 attempts for text: "${text}"`);
  } else {
    console.log(`Voiceover duration measured: ${duration.toFixed(2)}s`);
  }
  
  return {
    filePath: outputPath,
    duration
  };
}
