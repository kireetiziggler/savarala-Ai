import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'database.json');

const defaultDb = {
  history: [], // List of all videos generated/scheduled
  config: {
    lastRun: null,
    weeklyStats: [] // To track CTR, watch time, etc.
  }
};

class LocalDatabase {
  constructor() {
    this.data = { ...defaultDb };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(fileContent);
      } else {
        this.save();
      }
    } catch (error) {
      console.error('Failed to load database. Initializing with defaults.', error);
      this.data = { ...defaultDb };
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }

  // Get all history
  getHistory() {
    return this.data.history || [];
  }

  // Add video entry to history
  addVideo(video) {
    const entry = {
      id: video.id || `vid_${Date.now()}`,
      topic: video.topic,
      type: video.type, // 'short' or 'long'
      title: video.title,
      script: video.script,
      description: video.description,
      tags: video.tags || [],
      hashtags: video.hashtags || [],
      scheduledTime: video.scheduledTime, // ISO string
      status: video.status || 'generated', // 'generated', 'qc_failed', 'qc_passed', 'published', 'failed'
      youtubeId: video.youtubeId || null,
      createdDate: new Date().toISOString(),
      attempts: video.attempts || 0,
      errorLog: video.errorLog || null,
      metrics: video.metrics || null
    };
    
    this.data.history.push(entry);
    this.save();
    return entry;
  }

  // Update a video record by ID
  updateVideo(id, updates) {
    const idx = this.data.history.findIndex(v => v.id === id);
    if (idx !== -1) {
      this.data.history[idx] = { ...this.data.history[idx], ...updates };
      this.save();
      return this.data.history[idx];
    }
    return null;
  }

  // Check if a similar topic was covered in the last 7 days
  hasTopicInLast7Days(topic) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Normalize topic words for keyword matching
    const cleanWords = (str) => 
      str.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3); // ignore short stop words

    const targetWords = cleanWords(topic);
    if (targetWords.length === 0) return false;

    // Filter videos created in the last 7 days
    const recentVideos = this.data.history.filter(video => {
      const createdDate = new Date(video.createdDate);
      return createdDate >= sevenDaysAgo && video.status !== 'failed';
    });

    for (const video of recentVideos) {
      // Direct comparison
      if (video.topic.toLowerCase().trim() === topic.toLowerCase().trim()) {
        return true;
      }

      // Keyword overlap comparison
      const videoWords = cleanWords(video.topic);
      let matchCount = 0;
      for (const word of targetWords) {
        if (videoWords.includes(word)) {
          matchCount++;
        }
      }
      
      // If more than 50% of content-rich words overlap, consider it too similar
      const threshold = Math.min(3, Math.ceil(targetWords.length / 2));
      if (matchCount >= threshold) {
        return true;
      }
    }

    return false;
  }

  // Record runtime configuration / health checks
  setLastRun(timestamp = new Date().toISOString()) {
    this.data.config.lastRun = timestamp;
    this.save();
  }

  // Save weekly analytics
  saveWeeklyStats(stats) {
    this.data.config.weeklyStats.push({
      date: new Date().toISOString(),
      ...stats
    });
    this.save();
  }
}

export const db = new LocalDatabase();
