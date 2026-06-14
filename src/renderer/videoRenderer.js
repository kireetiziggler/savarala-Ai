import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import puppeteer from 'puppeteer';
import ffmpegPath from 'ffmpeg-static';
import axios from 'axios';
import dotenv from 'dotenv';
import { generateVoiceover, getAudioDuration } from '../generator/voiceover.js';

dotenv.config();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Download file helper
async function downloadFile(url, destPath) {
  const writer = fs.createWriteStream(destPath);
  const response = await axios({
    method: 'get',
    url: url,
    responseType: 'stream',
    headers: { 'User-Agent': USER_AGENT }
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Search and download stock media from Pexels with native orientation and resolution targeting
async function fetchStockMedia(keyword, isVideo = true, videoType = 'long') {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    return null; // Fallback to slide layout
  }

  try {
    const query = encodeURIComponent(keyword);
    const orientation = videoType === 'short' ? 'portrait' : 'landscape';
    if (isVideo) {
      const url = `https://api.pexels.com/videos/search?query=${query}&per_page=3&orientation=${orientation}`;
      const response = await axios.get(url, { headers: { Authorization: apiKey } });
      const videos = response.data?.videos || [];
      if (videos.length > 0) {
        const video = videos[0];
        // Sort and select the video file closest to target Full HD width (1080 for portrait, 1920 for landscape)
        const targetWidth = videoType === 'short' ? 1080 : 1920;
        const hdFiles = video.video_files.filter(f => f.link && f.width);
        hdFiles.sort((a, b) => Math.abs(a.width - targetWidth) - Math.abs(b.width - targetWidth));
        const file = hdFiles[0] || video.video_files[0];
        return file.link;
      }
    } else {
      const url = `https://api.pexels.com/v1/search?query=${query}&per_page=3&orientation=${orientation}`;
      const response = await axios.get(url, { headers: { Authorization: apiKey } });
      const photos = response.data?.photos || [];
      if (photos.length > 0) {
        return photos[0].src.large2x;
      }
    }
  } catch (error) {
    console.error(`Pexels API fetch failed for keyword "${keyword}":`, error.message);
  }
  return null;
}

// Generate custom AI images using Hugging Face's serverless Inference API (completely free with a HF token)
async function generateHFImage(prompt, videoType = 'long') {
  const token = process.env.HF_TOKEN;
  if (!token) {
    console.log('[AI Image Generator] HF_TOKEN is not configured. Skipping Hugging Face generation.');
    return null;
  }

  try {
    const width = videoType === 'short' ? 1080 : 1920;
    const height = videoType === 'short' ? 1920 : 1080;
    const model = 'black-forest-labs/FLUX.1-schnell';
    const url = `https://api-inference.huggingface.co/models/${model}`;
    
    console.log(`[AI Image Generator] Requesting Hugging Face Flux model for: "${prompt}"...`);
    const response = await axios({
      method: 'post',
      url: url,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: JSON.stringify({
        inputs: `${prompt}, professional high-quality 4k 3d digital art, modern software developer tech style, clean design, vibrant color scheme`,
        parameters: {
          width: width,
          height: height
        }
      }),
      responseType: 'arraybuffer'
    });

    return Buffer.from(response.data);
  } catch (error) {
    console.error('Hugging Face AI image generation failed:', error.message);
    return null;
  }
}

// Compile frame speed scale using FFmpeg atempo filter
function scaleAudioSpeed(inputPath, outputPath, factor) {
  return new Promise((resolve, reject) => {
    const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -filter:a "atempo=${factor}" "${outputPath}"`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error('FFmpeg atempo error:', stderr);
        return reject(error);
      }
      resolve();
    });
  });
}

// Compile frame sequence and audio into MP4 scene
function compileSceneVideo(framesPattern, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Compile using 15fps framerate for fast rendering speed
    const cmd = `"${ffmpegPath}" -y -framerate 15 -i "${framesPattern}" -i "${audioPath}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error('FFmpeg scene compilation error:', stderr);
        return reject(error);
      }
      resolve();
    });
  });
}

// Concatenate multiple videos
function concatenateVideos(videoListPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `"${ffmpegPath}" -y -f concat -safe 0 -i "${videoListPath}" -c copy "${outputPath}"`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error('FFmpeg concatenation error:', stderr);
        return reject(error);
      }
      resolve();
    });
  });
}

export async function renderVideo(scriptPackage, videoType, outputFilePath) {
  console.log(`Starting video render pipeline for ${videoType.toUpperCase()}...`);

  const jobId = `job_${Date.now()}`;
  const tempDir = path.join(process.cwd(), 'scratch', jobId);
  fs.mkdirSync(tempDir, { recursive: true });

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const browser = await puppeteer.launch(launchOptions);

  const page = await browser.newPage();
  const width = videoType === 'short' ? 1080 : 1920;
  const height = videoType === 'short' ? 1920 : 1080;
  await page.setViewport({ width, height });

  const templatePath = path.join(process.cwd(), 'templates', 'video.html');
  await page.goto(`file:///${templatePath.replace(/\\/g, '/')}`);

  const sceneVideoPaths = [];
  const scenesMetadata = [];

  try {
    // Phase 1: Pre-generate all voiceovers to determine exact total duration
    console.log('Phase 1: Pre-generating voiceover audio files...');
    let totalDuration = 0;

    for (let i = 0; i < scriptPackage.storyboard.length; i++) {
      const scene = scriptPackage.storyboard[i];
      const sceneIdx = i + 1;
      const sceneDir = path.join(tempDir, `scene_${sceneIdx}`);
      fs.mkdirSync(sceneDir, { recursive: true });

      const rawAudioPath = path.join(sceneDir, 'audio_raw.mp3');
      const rawJsonPath = path.join(sceneDir, 'audio_raw.json');
      const voiceover = await generateVoiceover(scene.narration, rawAudioPath, rawJsonPath);
      
      const sceneDuration = Math.max(1.0, voiceover.duration);
      if (voiceover.duration === 0) {
        console.warn(`[Video Renderer Warning] Scene ${sceneIdx} voiceover has 0.00s duration. Forcing 1.0s duration to prevent FFmpeg crashes.`);
      }

      scenesMetadata.push({
        index: sceneIdx,
        rawAudioPath,
        rawJsonPath,
        audioPath: path.join(sceneDir, 'audio.mp3'),
        jsonPath: path.join(sceneDir, 'audio.json'),
        duration: sceneDuration,
        sceneDir
      });

      totalDuration += sceneDuration;
    }

    console.log(`Pre-generation complete. Raw total video duration: ${totalDuration.toFixed(2)}s`);

    // Scale audio speed if necessary (for shorts, keep strictly between 45 and 58 seconds)
    if (videoType === 'short') {
      const minDuration = 45;
      const maxDuration = 58;
      const targetDuration = 52;

      if (totalDuration < minDuration || totalDuration > maxDuration) {
        const factor = totalDuration / targetDuration;
        const safeFactor = Math.max(0.8, Math.min(1.3, factor));
        console.log(`Applying audio speed scale factor: ${safeFactor.toFixed(2)}x to target ~${targetDuration}s (Raw: ${totalDuration.toFixed(2)}s)`);

        totalDuration = 0; // Recalculate
        for (const meta of scenesMetadata) {
          console.log(`Scaling scene ${meta.index} audio by ${safeFactor.toFixed(2)}x...`);
          await scaleAudioSpeed(meta.rawAudioPath, meta.audioPath, safeFactor);
          
          // Scale JSON timestamps if available
          if (fs.existsSync(meta.rawJsonPath)) {
            try {
              const timings = JSON.parse(fs.readFileSync(meta.rawJsonPath, 'utf-8'));
              const scaledTimings = timings.map(t => ({
                word: t.word,
                start: t.start / safeFactor,
                end: t.end / safeFactor
              }));
              fs.writeFileSync(meta.jsonPath, JSON.stringify(scaledTimings, null, 2), 'utf-8');
            } catch (err) {
              console.warn('Failed to scale raw timestamps JSON:', err.message);
            }
          }
          
          const newDur = await getAudioDuration(meta.audioPath);
          meta.duration = newDur;
          totalDuration += newDur;
        }
        console.log(`Scaled total duration: ${totalDuration.toFixed(2)}s`);
      } else {
        // No scaling needed, copy raw audio and JSON to final paths
        for (const meta of scenesMetadata) {
          fs.copyFileSync(meta.rawAudioPath, meta.audioPath);
          if (fs.existsSync(meta.rawJsonPath)) {
            fs.copyFileSync(meta.rawJsonPath, meta.jsonPath);
          }
        }
      }
    } else {
      // Long-form video - no scaling, copy raw audio and JSON to final paths
      for (const meta of scenesMetadata) {
        fs.copyFileSync(meta.rawAudioPath, meta.audioPath);
        if (fs.existsSync(meta.rawJsonPath)) {
          fs.copyFileSync(meta.rawJsonPath, meta.jsonPath);
        }
      }
    }

    // Phase 2: Render frame sequences and compile scene videos
    console.log('Phase 2: Rendering scene frames...');
    let cumulativeDuration = 0;

    for (let i = 0; i < scriptPackage.storyboard.length; i++) {
      const scene = scriptPackage.storyboard[i];
      const metadata = scenesMetadata[i];
      const sceneIdx = metadata.index;
      const sceneDir = metadata.sceneDir;
      const duration = metadata.duration;
      const audioPath = metadata.audioPath;

      console.log(`\nRendering Scene ${sceneIdx}/${scriptPackage.storyboard.length} (${duration.toFixed(2)}s)...`);
      const framesDir = path.join(sceneDir, 'frames');
      fs.mkdirSync(framesDir, { recursive: true });

      // 1. Manage Stock B-roll Assets if needed
      let localMediaUrl = null;
      if (scene.visualType === 'stock_media') {
        const keyword = scene.visualParams.keyword || 'technology';
        const mediaDest = path.join(sceneDir, `broll.jpg`);

        // Try generating with Hugging Face first
        if (process.env.HF_TOKEN) {
          console.log(`Generating AI Visual via Hugging Face for: "${keyword}"...`);
          const imgBuffer = await generateHFImage(keyword, videoType);
          if (imgBuffer) {
            fs.writeFileSync(mediaDest, imgBuffer);
            localMediaUrl = `file:///${mediaDest.replace(/\\/g, '/')}`;
          }
        }

        // Fallback to LoremFlickr (completely free and keyless stock photo matcher)
        if (!localMediaUrl) {
          console.log(`Hugging Face generation skipped or failed. Fetching keyless LoremFlickr fallback for: "${keyword}"...`);
          const width = videoType === 'short' ? 1080 : 1920;
          const height = videoType === 'short' ? 1920 : 1080;
          const mediaUrl = `https://loremflickr.com/${width}/${height}/${encodeURIComponent(keyword)}`;
          try {
            console.log(`Downloading stock visual: ${mediaUrl} -> ${mediaDest}`);
            await downloadFile(mediaUrl, mediaDest);
            localMediaUrl = `file:///${mediaDest.replace(/\\/g, '/')}`;
          } catch (dlErr) {
            console.error(`Failed to download LoremFlickr visual. Falling back to Pexels...`, dlErr.message);
          }
        }

        // Fallback to Pexels if both failed
        if (!localMediaUrl) {
          console.log('LoremFlickr failed. Falling back to Pexels stock media...');
          const mediaUrl = await fetchStockMedia(keyword, true, videoType);
          if (mediaUrl) {
            try {
              const ext = mediaUrl.includes('video') || mediaUrl.endsWith('.mp4') ? '.mp4' : '.jpg';
              const pexelsDest = path.join(sceneDir, `broll${ext}`);
              console.log(`Downloading Pexels asset: ${mediaUrl} -> ${pexelsDest}`);
              await downloadFile(mediaUrl, pexelsDest);
              localMediaUrl = `file:///${pexelsDest.replace(/\\/g, '/')}`;
            } catch (dlErr) {
              console.error(`Failed to download Pexels media. Falling back to slide...`, dlErr.message);
            }
          }
        }

        // Fallback to slide if download fails or key is missing
        if (!localMediaUrl) {
          scene.visualType = 'slide';
          scene.visualParams = {
            title: scene.visualParams.overlayText || keyword,
            bullets: ['Key Concept Overview', 'Technical Deep Dive'],
            highlight: keyword
          };
        }
      }

      // 2. Render frame screenshots
      const fps = 15; // Optimized from 30fps to double rendering speed
      const totalFrames = Math.ceil(duration * fps);
      const words = scene.narration.trim().split(/\s+/);
      const durationPerWord = duration / words.length;

      // Load exact word boundary timestamps if available
      let wordTimings = null;
      const timingJsonPath = path.join(sceneDir, 'audio.json');
      if (fs.existsSync(timingJsonPath)) {
        try {
          wordTimings = JSON.parse(fs.readFileSync(timingJsonPath, 'utf-8'));
        } catch (jsonErr) {
          console.warn('Failed to parse word timestamps JSON, falling back to estimation:', jsonErr.message);
        }
      }

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        const timeSec = frameIdx / fps;
        const sceneProgress = frameIdx / totalFrames;
        
        // Compute overall video progress for progress bar
        const overallProgress = (cumulativeDuration + timeSec) / totalDuration;
        
        // Determine exact active word index using timestamps or fallback estimation
        let activeWordIndex = 0;
        if (wordTimings && wordTimings.length > 0) {
          const matchedIdx = wordTimings.findIndex(t => timeSec >= t.start && timeSec <= t.end);
          if (matchedIdx !== -1) {
            activeWordIndex = matchedIdx;
          } else {
            // If time is past the last word, set to the last word index
            const lastWord = wordTimings[wordTimings.length - 1];
            if (timeSec >= lastWord.end) {
              activeWordIndex = wordTimings.length - 1;
            } else {
              // Find the closest word timing
              let closestIdx = 0;
              for (let wIdx = 0; wIdx < wordTimings.length; wIdx++) {
                if (timeSec >= wordTimings[wIdx].end) {
                  closestIdx = wIdx;
                }
              }
              activeWordIndex = closestIdx;
            }
          }
        } else {
          activeWordIndex = Math.floor(timeSec / durationPerWord);
        }

        const frameState = {
          videoType,
          visualType: scene.visualType,
          visualParams: {
            ...scene.visualParams,
            mediaUrl: localMediaUrl
          },
          zoomState: scene.zoomState || 'normal',
          cursor: scene.cursor || null,
          sceneProgress,
          overallProgress,
          words,
          activeWordIndex,
          timeSec,
          sceneDuration: duration
        };

        // Inject state and capture screenshot
        await page.evaluate(async (stateStr) => {
          await window.updateState(stateStr);
        }, JSON.stringify(frameState));

        // Use JPEG format (quality 85) instead of PNG to speed up disk writes by 5x
        const framePath = path.join(framesDir, `frame_${String(frameIdx).padStart(5, '0')}.jpg`);
        await page.screenshot({ path: framePath, type: 'jpeg', quality: 85 });
      }

      // 3. Compile scene video
      const sceneVideoPath = path.join(sceneDir, 'scene.mp4');
      const framesPattern = path.join(framesDir, 'frame_%05d.jpg');
      console.log(`Compiling Scene ${sceneIdx} video...`);
      await compileSceneVideo(framesPattern, audioPath, sceneVideoPath);
      sceneVideoPaths.push(sceneVideoPath);

      cumulativeDuration += duration;
    }

    // Phase 3: Stitch scene videos together
    console.log('\nPhase 3: Concatenating scene videos into final output...');
    const listFilePath = path.join(tempDir, 'concat_list.txt');
    const listContent = sceneVideoPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listFilePath, listContent, 'utf-8');

    // Ensure output directory exists
    const finalOutDir = path.dirname(outputFilePath);
    if (!fs.existsSync(finalOutDir)) {
      fs.mkdirSync(finalOutDir, { recursive: true });
    }

    await concatenateVideos(listFilePath, outputFilePath);
    console.log(`SUCCESS! Professional video compiled at: ${outputFilePath}`);

  } catch (err) {
    console.error('Error during video rendering pipeline:', err);
    throw err;
  } finally {
    await browser.close();
    // Clean up temp job files
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.error('Failed to clean up scratch workspace:', cleanupErr.message);
    }
  }
}
