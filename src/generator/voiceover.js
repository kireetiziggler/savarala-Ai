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

// Generate voiceover audio using Edge TTS
async function generateEdgeTTS(text, outputPath, locale) {
  try {
    const tts = new MsEdgeTTS();
    // Default to Indian English if not specified
    const voice = locale || 'en-IN-NeerjaNeural';
    
    // Config: voice name, audio output format
    await tts.setMetadata(voice, 'audio-24khz-48kbitrate-mono-mp3');
    
    // Parent directory must be passed to toFile
    const parentDir = path.dirname(outputPath);
    const result = await tts.toFile(parentDir, text);
    
    // Ensure the output file matches the expected outputPath using normalized paths
    const normResultPath = path.resolve(result.audioFilePath);
    const normOutputPath = path.resolve(outputPath);
    if (normResultPath !== normOutputPath) {
      if (fs.existsSync(normOutputPath)) {
        fs.unlinkSync(normOutputPath);
      }
      fs.renameSync(normResultPath, normOutputPath);
    }
    
    console.log(`Edge TTS Voiceover generated at: ${outputPath}`);
  } catch (error) {
    console.error('Edge TTS generation failed:', error);
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

// Main generation function
export async function generateVoiceover(text, outputPath) {
  const provider = (process.env.TTS_PROVIDER || 'edge').toLowerCase();
  const locale = process.env.VOICEOVER_LOCALE;
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (provider === 'elevenlabs' && elevenLabsKey) {
    console.log('Generating premium voiceover with ElevenLabs...');
    await generateElevenLabsTTS(text, outputPath, elevenLabsVoiceId, elevenLabsKey);
  } else {
    if (provider === 'elevenlabs') {
      console.warn('ElevenLabs API key is missing. Falling back to free Microsoft Edge TTS.');
    }
    console.log('Generating free voiceover with Microsoft Edge TTS...');
    await generateEdgeTTS(text, outputPath, locale);
  }

  // Get duration
  const duration = await getAudioDuration(outputPath);
  console.log(`Voiceover duration measured: ${duration.toFixed(2)}s`);
  
  return {
    filePath: outputPath,
    duration
  };
}
