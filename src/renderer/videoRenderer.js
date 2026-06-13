import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import puppeteer from 'puppeteer';
import ffmpegPath from 'ffmpeg-static';
import axios from 'axios';
import dotenv from 'dotenv';
import { generateVoiceover } from '../generator/voiceover.js';

dotenv.config();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Download a file helper
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

// Search and download stock media from Pexels
async function fetchStockMedia(keyword, isVideo = true) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    return null; // Fallback to slide layout
  }

  try {
    const query = encodeURIComponent(keyword);
    if (isVideo) {
      const url = `https://api.pexels.com/videos/search?query=${query}&per_page=3&orientation=landscape`;
      const response = await axios.get(url, { headers: { Authorization: apiKey } });
      const videos = response.data?.videos || [];
      if (videos.length > 0) {
        // Pick the best video file
        const video = videos[0];
        // Look for HD quality file
        const file = video.video_files.find(f => f.quality === 'hd' && f.width >= 1280) || video.video_files[0];
        return file.link;
      }
    } else {
      const url = `https://api.pexels.com/v1/search?query=${query}&per_page=3&orientation=landscape`;
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

// Compile a sequence of PNG frames and audio into an MP4 file
function compileSceneVideo(framesPattern, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Command: ffmpeg -y -framerate 30 -i frames/frame_%05d.png -i audio.mp3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest output.mp4
    const cmd = `"${ffmpegPath}" -y -framerate 30 -i "${framesPattern}" -i "${audioPath}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
    
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error('FFmpeg scene compilation error:', stderr);
        return reject(error);
      }
      resolve();
    });
  });
}

// Concatenate multiple video files using FFmpeg demuxer
function concatenateVideos(videoListPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Command: ffmpeg -y -f concat -safe 0 -i list.txt -c copy final.mp4
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

  // Create temporary workspaces
  const jobId = `job_${Date.now()}`;
  const tempDir = path.join(process.cwd(), 'scratch', jobId);
  fs.mkdirSync(tempDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Set viewport resolution
  const width = videoType === 'short' ? 1080 : 1920;
  const height = videoType === 'short' ? 1920 : 1080;
  await page.setViewport({ width, height });

  // Load the frame template
  const templatePath = path.join(process.cwd(), 'templates', 'video.html');
  await page.goto(`file:///${templatePath.replace(/\\/g, '/')}`);

  const sceneVideoPaths = [];

  try {
    for (let i = 0; i < scriptPackage.storyboard.length; i++) {
      const scene = scriptPackage.storyboard[i];
      const sceneIdx = i + 1;
      console.log(`Processing Scene ${sceneIdx}/${scriptPackage.storyboard.length}...`);

      const sceneDir = path.join(tempDir, `scene_${sceneIdx}`);
      const framesDir = path.join(sceneDir, 'frames');
      fs.mkdirSync(framesDir, { recursive: true });

      // 1. Generate Voiceover for this scene
      const audioPath = path.join(sceneDir, 'audio.mp3');
      const voiceover = await generateVoiceover(scene.narration, audioPath);
      const duration = voiceover.duration;

      // 2. Fetch Stock B-roll asset if needed
      let localMediaUrl = null;
      if (scene.visualType === 'stock_media') {
        const keyword = scene.visualParams.keyword || 'technology';
        console.log(`Fetching B-roll media for keyword: "${keyword}"...`);
        const mediaUrl = await fetchStockMedia(keyword, true);
        
        if (mediaUrl) {
          try {
            const ext = mediaUrl.includes('video') || mediaUrl.endsWith('.mp4') ? '.mp4' : '.jpg';
            const mediaDest = path.join(sceneDir, `broll${ext}`);
            console.log(`Downloading B-roll asset: ${mediaUrl} -> ${mediaDest}`);
            await downloadFile(mediaUrl, mediaDest);
            localMediaUrl = `file:///${mediaDest.replace(/\\/g, '/')}`;
          } catch (dlErr) {
            console.error('Failed to download stock media, will fallback to slides', dlErr.message);
          }
        }

        // Fallback if Pexels key is missing or download failed
        if (!localMediaUrl) {
          console.log('No stock media available. Falling back to slide layout.');
          scene.visualType = 'slide';
          scene.visualParams = {
            title: scene.visualParams.overlayText || keyword,
            bullets: ['Key Concept Overview', 'Technical Deep Dive'],
            highlight: keyword
          };
        }
      }

      // 3. Render frames in Puppeteer
      const fps = 30;
      const totalFrames = Math.ceil(duration * fps);
      const words = scene.narration.trim().split(/\s+/);
      const durationPerWord = duration / words.length;

      console.log(`Rendering ${totalFrames} frames for Scene ${sceneIdx} (${duration.toFixed(2)}s)...`);

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        const timeSec = frameIdx / fps;
        const progress = frameIdx / totalFrames;
        const activeWordIndex = Math.floor(timeSec / durationPerWord);

        const frameState = {
          videoType,
          visualType: scene.visualType,
          visualParams: {
            ...scene.visualParams,
            mediaUrl: localMediaUrl
          },
          sceneProgress: progress,
          words,
          activeWordIndex
        };

        // Inject state and render frame
        await page.evaluate((stateStr) => {
          window.updateState(stateStr);
        }, JSON.stringify(frameState));

        const framePath = path.join(framesDir, `frame_${String(frameIdx).padStart(5, '0')}.png`);
        await page.screenshot({ path: framePath, type: 'png' });
      }

      // 4. Compile frames into scene mp4
      const sceneVideoPath = path.join(sceneDir, 'scene.mp4');
      const framesPattern = path.join(framesDir, 'frame_%05d.png');
      console.log(`Compiling Scene ${sceneIdx} video...`);
      await compileSceneVideo(framesPattern, audioPath, sceneVideoPath);
      sceneVideoPaths.push(sceneVideoPath);
    }

    // 5. Concatenate all scene video files
    console.log('Concatenating all scenes into final video...');
    const listFilePath = path.join(tempDir, 'concat_list.txt');
    const listContent = sceneVideoPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listFilePath, listContent, 'utf-8');

    // Ensure output directory exists
    const finalOutDir = path.dirname(outputFilePath);
    if (!fs.existsSync(finalOutDir)) {
      fs.mkdirSync(finalOutDir, { recursive: true });
    }

    await concatenateVideos(listFilePath, outputFilePath);
    console.log(`SUCCESS! Final video compiled at: ${outputFilePath}`);

  } catch (err) {
    console.error('Error during video rendering pipeline:', err);
    throw err;
  } finally {
    await browser.close();
    // Clean up temp job files to save disk space
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.error('Failed to clean up scratch workspace:', cleanupErr.message);
    }
  }
}
