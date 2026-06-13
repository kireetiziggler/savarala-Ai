import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Scrape Reddit communities using public JSON feeds (no API keys needed)
async function fetchRedditTrends() {
  const subreddits = ['softwaretesting', 'selenium', 'learnprogramming', 'artificial'];
  const trends = [];

  for (const sub of subreddits) {
    try {
      const url = `https://www.reddit.com/r/${sub}/hot.json?limit=10`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT }
      });
      
      const posts = response.data?.data?.children || [];
      posts.forEach(post => {
        const data = post.data;
        if (data && !data.stickied) {
          trends.push({
            source: `reddit/r/${sub}`,
            title: data.title,
            score: data.score,
            comments: data.num_comments,
            url: `https://reddit.com${data.permalink}`
          });
        }
      });
    } catch (error) {
      console.error(`Failed to fetch Reddit trends for r/${sub}:`, error.message);
    }
  }
  return trends;
}

// Scrape GitHub daily trending repositories
async function fetchGithubTrending() {
  const trends = [];
  try {
    const url = 'https://github.com/trending';
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT }
    });
    const html = response.data;
    
    // Simple regex parser to extract trending repository names and descriptions
    // Repository title pattern: href="/owner/name"
    const repoRegex = /href="([^"/]+)\/([^"/]+)"\s+data-hydro-click/g;
    // Description pattern
    const descRegex = /<p class="col-9 color-fg-muted my-1 pr-4">([\s\S]*?)<\/p>/g;
    
    let match;
    const repos = [];
    while ((match = repoRegex.exec(html)) !== null) {
      const owner = match[1].trim();
      const name = match[2].trim();
      if (!repos.includes(`${owner}/${name}`)) {
        repos.push(`${owner}/${name}`);
      }
      if (repos.length >= 10) break;
    }

    repos.forEach(repo => {
      trends.push({
        source: 'github/trending',
        title: repo,
        url: `https://github.com/${repo}`
      });
    });

  } catch (error) {
    console.error('Failed to fetch GitHub trending repositories:', error.message);
  }
  return trends;
}

// Fetch Google Trends RSS for India (IN) and Global (US)
async function fetchGoogleTrends() {
  const trends = [];
  const geos = ['IN', 'US'];

  for (const geo of geos) {
    try {
      const url = `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT }
      });
      const xml = response.data;

      // Extract titles using Regex
      const titleRegex = /<title>([\s\S]*?)<\/title>/g;
      let match;
      const titles = [];
      // Skip the first title since it's the RSS channel title
      let isFirst = true;
      while ((match = titleRegex.exec(xml)) !== null) {
        if (isFirst) {
          isFirst = false;
          continue;
        }
        const title = match[1].replace('<![CDATA[', '').replace(']]>', '').trim();
        if (title && !titles.includes(title)) {
          titles.push(title);
        }
        if (titles.length >= 10) break;
      }

      titles.forEach(title => {
        trends.push({
          source: `google/trends/${geo}`,
          title: title
        });
      });
    } catch (error) {
      console.error(`Failed to fetch Google Trends for ${geo}:`, error.message);
    }
  }
  return trends;
}

// Scrape tech news RSS (Hacker News or specialized feeds)
async function fetchTechNews() {
  const trends = [];
  try {
    const url = 'https://hnrss.org/frontpage';
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT }
    });
    const xml = response.data;

    const titleRegex = /<title>([\s\S]*?)<\/title>/g;
    let match;
    const titles = [];
    let isFirst = true;
    while ((match = titleRegex.exec(xml)) !== null) {
      if (isFirst) {
        isFirst = false;
        continue;
      }
      const title = match[1].replace('<![CDATA[', '').replace(']]>', '').trim();
      if (title && !titles.includes(title)) {
        titles.push(title);
      }
      if (titles.length >= 10) break;
    }

    titles.forEach(title => {
      trends.push({
        source: 'hackernews',
        title: title
      });
    });
  } catch (error) {
    console.error('Failed to fetch Hacker News feed:', error.message);
  }
  return trends;
}

// Orchestrator for daily trends
export async function scrapeDailyTrends() {
  console.log('Running daily trend scraper...');
  const [reddit, github, google, news] = await Promise.all([
    fetchRedditTrends(),
    fetchGithubTrending(),
    fetchGoogleTrends(),
    fetchTechNews()
  ]);

  return {
    timestamp: new Date().toISOString(),
    reddit,
    github,
    google,
    news
  };
}
