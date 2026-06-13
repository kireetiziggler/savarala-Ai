import fs from 'fs';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { db } from '../db/db.js';

dotenv.config();

function getOAuth2Client() {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing YouTube API credentials in .env (YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN).');
  }

  // Redirect URI is not strictly needed for refreshing tokens, but we construct it properly
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

// Delay helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function attemptUpload(youtube, videoMetadata, videoPath, thumbnailPath) {
  console.log(`Uploading video file: ${videoPath} (${(fs.statSync(videoPath).size / 1024 / 1024).toFixed(2)} MB)...`);
  
  // YouTube Category ID: 28 is "Education", 27 is "Science & Technology"
  const categoryId = process.env.YT_CATEGORY_ID || '28'; 
  const privacyStatus = process.env.YT_PRIVACY_STATUS || 'public'; // 'public', 'private', or 'unlisted'

  // Construct description combining paragraphs, hashtags, and standard links
  const tagsList = videoMetadata.tags || [];
  const hashtagsList = videoMetadata.hashtags || [];
  const hashtagsString = hashtagsList.map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
  const fullDescription = `${videoMetadata.description}\n\n${hashtagsString}`;

  const requestBody = {
    snippet: {
      title: videoMetadata.title,
      description: fullDescription,
      tags: tagsList.slice(0, 30),
      categoryId: categoryId
    },
    status: {
      privacyStatus: privacyStatus,
      selfDeclaredMadeForKids: false
    }
  };

  const response = await youtube.videos.insert({
    part: 'snippet,status',
    requestBody,
    media: {
      body: fs.createReadStream(videoPath)
    }
  });

  const videoId = response.data.id;
  console.log(`Video uploaded successfully! Video ID: ${videoId}`);

  // If long-form and thumbnail is provided, upload it
  if (videoMetadata.type === 'long' && thumbnailPath && fs.existsSync(thumbnailPath)) {
    console.log(`Setting video thumbnail for video ID ${videoId} using ${thumbnailPath}...`);
    try {
      await youtube.thumbnails.set({
        videoId: videoId,
        media: {
          mimeType: 'image/jpeg',
          body: fs.createReadStream(thumbnailPath)
        }
      });
      console.log('Thumbnail updated successfully!');
    } catch (thumbErr) {
      console.error('Failed to set thumbnail:', thumbErr.message);
      // We don't fail the whole upload if just the thumbnail failed, but we log it
    }
  }

  return videoId;
}

// Upload with 3 retries and 15-minute wait time (900000ms)
export async function uploadVideo(videoDbEntry, videoPath, thumbnailPath) {
  console.log(`Starting YouTube Upload workflow for video DB ID: ${videoDbEntry.id}...`);
  
  let oauth2Client;
  try {
    oauth2Client = getOAuth2Client();
  } catch (err) {
    console.error('YouTube credentials error:', err.message);
    db.updateVideo(videoDbEntry.id, { 
      status: 'failed', 
      errorLog: `Auth Error: ${err.message}` 
    });
    throw err;
  }

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const maxAttempts = 3;
  // 15 minutes in ms (can be adjusted for testing via env if needed)
  const retryInterval = process.env.NODE_ENV === 'test' ? 1000 : 15 * 60 * 1000; 

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`Upload Attempt ${attempt}/${maxAttempts}...`);
    db.updateVideo(videoDbEntry.id, { attempts: attempt });

    try {
      const youtubeId = await attemptUpload(youtube, videoDbEntry, videoPath, thumbnailPath);
      
      // Update success in DB
      db.updateVideo(videoDbEntry.id, {
        status: 'published',
        youtubeId: youtubeId,
        publishTime: new Date().toISOString()
      });
      
      console.log(`✅ Upload Workflow Completed successfully! YouTube ID: ${youtubeId}`);
      return youtubeId;

    } catch (error) {
      console.error(`Upload attempt ${attempt} failed:`, error.message);
      db.updateVideo(videoDbEntry.id, { errorLog: error.message });

      if (attempt < maxAttempts) {
        console.log(`Waiting ${(retryInterval / 1000 / 60).toFixed(0)} minutes before next attempt...`);
        await sleep(retryInterval);
      } else {
        console.error('All upload attempts exhausted. Marking video as failed.');
        db.updateVideo(videoDbEntry.id, { status: 'failed' });
        throw new Error(`YouTube upload failed after ${maxAttempts} attempts: ${error.message}`);
      }
    }
  }
}
