import cron from 'node-cron';
import { exec } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
import { db } from './db/db.js';

dotenv.config();

const TIMEZONE = 'Asia/Kolkata';

// Run workflow in child process for safety
function runWorkflowProcess(type) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'src', 'index.js');
    console.log(`[Scheduler] Spawning child process: node "${scriptPath}" run-workflow ${type}`);
    
    exec(`node "${scriptPath}" run-workflow ${type}`, (error, stdout, stderr) => {
      console.log(`=== Child Process Output (${type}) ===\n`, stdout);
      if (error) {
        console.error(`=== Child Process Error (${type}) ===\n`, stderr);
        return reject(error);
      }
      resolve();
    });
  });
}

// Scheduled job runner with 30-minute retry logic on failure
async function triggerWorkflowWithRetry(type, attempt = 1) {
  console.log(`[Scheduler] [${new Date().toISOString()}] Triggering scheduled ${type.toUpperCase()} workflow (Attempt ${attempt}/3)...`);
  
  db.setLastRun();

  try {
    await runWorkflowProcess(type);
    console.log(`[Scheduler] Scheduled ${type.toUpperCase()} workflow completed successfully.`);
  } catch (err) {
    console.error(`[Scheduler] Scheduled ${type.toUpperCase()} workflow failed:`, err.message);
    
    if (attempt < 3) {
      const retryMinutes = 30;
      console.log(`[Scheduler] Scheduling retry for ${type.toUpperCase()} in ${retryMinutes} minutes...`);
      setTimeout(() => {
        triggerWorkflowWithRetry(type, attempt + 1);
      }, retryMinutes * 60 * 1000);
    } else {
      console.error(`[Scheduler] All scheduled attempts for ${type.toUpperCase()} failed.`);
    }
  }
}

console.log('=== YouTube Growth AI Agent Scheduler Started ===');
console.log(`Current local time: ${new Date().toLocaleString('en-US', { timeZone: TIMEZONE })} (${TIMEZONE})`);

// Short 1: 09:00 AM IST
cron.schedule('0 9 * * *', () => {
  triggerWorkflowWithRetry('short');
}, {
  timezone: TIMEZONE
});
console.log(`- Scheduled: Short 1 at 09:00 AM IST`);

// Short 2: 08:00 PM IST (20:00)
cron.schedule('0 20 * * *', () => {
  triggerWorkflowWithRetry('short');
}, {
  timezone: TIMEZONE
});
console.log(`- Scheduled: Short 2 at 08:00 PM IST`);

// Long Video: 07:00 PM IST (19:00)
cron.schedule('0 19 * * *', () => {
  triggerWorkflowWithRetry('long');
}, {
  timezone: TIMEZONE
});
console.log(`- Scheduled: Long Video at 07:00 PM IST`);
