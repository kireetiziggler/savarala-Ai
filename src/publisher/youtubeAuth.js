import { google } from 'googleapis';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // Out of band redirect for console apps

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

export async function runAuthSetup() {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Error: YT_CLIENT_ID and YT_CLIENT_SECRET must be configured in your .env file before running auth setup.');
    rl.close();
    return;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ]
  });

  console.log('\n=== YouTube OAuth2 Authorization Setup ===');
  console.log('1. Open this URL in your web browser:');
  console.log(`\x1b[36m${authUrl}\x1b[0m\n`);
  console.log('2. Sign in with the Google Account associated with your YouTube Channel.');
  console.log('3. Grant permissions, then copy the authorization code provided by Google.');

  rl.question('4. Paste the authorization code here: ', async (code) => {
    try {
      console.log('\nExchanging code for tokens...');
      const { tokens } = await oauth2Client.getToken(code.trim());
      
      const refreshToken = tokens.refresh_token;
      if (!refreshToken) {
        console.warn('\nWarning: No refresh token returned. If you have authenticated before, you must revoke access in your Google Account settings first, or add prompt: "consent" parameters.');
      } else {
        console.log('\nSuccess! Received Refresh Token.');
        updateEnvFile(refreshToken);
      }
    } catch (err) {
      console.error('Failed to authenticate:', err.message);
    } finally {
      rl.close();
    }
  });
}

function updateEnvFile(refreshToken) {
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  // Update or add refresh token
  if (envContent.includes('YT_REFRESH_TOKEN=')) {
    envContent = envContent.replace(/YT_REFRESH_TOKEN=.*/, `YT_REFRESH_TOKEN=${refreshToken}`);
  } else {
    envContent += `\nYT_REFRESH_TOKEN=${refreshToken}`;
  }

  fs.writeFileSync(envPath, envContent, 'utf-8');
  console.log('✅ Updated .env file with your new YT_REFRESH_TOKEN.');
  console.log('You are now ready to run the automated publisher.');
}

// If executed directly
if (process.argv[1] && process.argv[1].endsWith('youtubeAuth.js')) {
  runAuthSetup();
}
