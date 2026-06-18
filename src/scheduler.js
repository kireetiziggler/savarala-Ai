import cron from 'node-cron';
import { exec } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
import { db } from './db/db.js';

dotenv.config();

const TIMEZONE = 'Asia/Kolkata';

// Run workflow in child process for safety
function runWorkflowProcess(type, subType = '') {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'src', 'index.js');
    const subTypeArg = subType ? ` ${subType}` : '';
    console.log(`[Scheduler] Spawning child process: node "${scriptPath}" run-workflow ${type}${subTypeArg}`);
    
    exec(`node "${scriptPath}" run-workflow ${type}${subTypeArg}`, (error, stdout, stderr) => {
      console.log(`=== Child Process Output (${type}${subTypeArg}) ===\n`, stdout);
      if (error) {
        console.error(`=== Child Process Error (${type}${subTypeArg}) ===\n`, stderr);
        return reject(error);
      }
      resolve();
    });
  });
}

// Scheduled job runner with 5-minute retry logic on failure
async function triggerWorkflowWithRetry(type, subType = '', attempt = 1) {
  console.log(`[Scheduler] [${new Date().toISOString()}] Triggering scheduled ${type.toUpperCase()} workflow (Sub-type: ${subType || 'none'}) (Attempt ${attempt}/5)...`);
  
  db.setLastRun();

  try {
    await runWorkflowProcess(type, subType);
    console.log(`[Scheduler] Scheduled ${type.toUpperCase()} workflow completed successfully.`);
  } catch (err) {
    console.error(`[Scheduler] Scheduled ${type.toUpperCase()} workflow failed:`, err.message);
    
    if (attempt < 5) {
      const retryMinutes = 5;
      console.log(`[Scheduler] Scheduling retry for ${type.toUpperCase()} in ${retryMinutes} minutes... (Attempt ${attempt + 1}/5)`);
      setTimeout(() => {
        triggerWorkflowWithRetry(type, subType, attempt + 1);
      }, retryMinutes * 60 * 1000);
    } else {
      console.error(`[Scheduler] All 5 scheduled attempts for ${type.toUpperCase()} failed. Giving up for this slot.`);
    }
  }
}

console.log('=== YouTube Growth AI Agent Scheduler Started ===');
console.log(`Current local time: ${new Date().toLocaleString('en-US', { timeZone: TIMEZONE })} (${TIMEZONE})`);

// Short 1: 09:00 AM IST - Single-Scene Tech Meme/News
cron.schedule('0 9 * * *', () => {
  triggerWorkflowWithRetry('short', 'single_scene_tech');
}, {
  timezone: TIMEZONE
});
console.log(`- Scheduled: Short 1 (Single-Scene Tech Meme) at 09:00 AM IST`);

// Short 2: 02:00 PM IST (14:00) - 2-Scene Expectation vs Reality Tech Meme
cron.schedule('0 14 * * *', () => {
  triggerWorkflowWithRetry('short', 'meme_tech_2scene');
}, {
  timezone: TIMEZONE
});
console.log(`- Scheduled: Short 2 (2-Scene Tech Meme) at 02:00 PM IST`);

// Short 3: 08:00 PM IST (20:00) - Coding Tutorial (Voiceover & Editor)
cron.schedule('0 20 * * *', () => {
  triggerWorkflowWithRetry('short', 'tutorial');
}, {
  timezone: TIMEZONE
});
console.log(`- Scheduled: Short 3 (Coding Tutorial) at 08:00 PM IST`);
