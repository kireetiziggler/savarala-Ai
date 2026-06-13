import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Scrape Reddit communities using public JSON feeds (no API keys needed)
async function fetchRedditTrends() {
  const subreddits = ['webdev', 'reactjs', 'nextjs', 'LocalLLaMA', 'artificial', 'softwaretesting'];
  const trends = [];

  for (const sub of subreddits) {
    try {
      const url = `https://www.reddit.com/r/${sub}/hot.json?limit=10`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'max-age=0'
        }
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
      console.warn(`[Scraper Warning] Reddit r/${sub} blocked or rate-limited (Status ${error.response?.status || 'network error'}). The topic selector will fallback safely.`);
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
    
    // Split HTML by article container to isolate each repository block
    const articles = html.split('<article class="Box-row">');
    const repos = [];
    
    // Skip the first split since it is the header HTML before the first article
    for (let i = 1; i < articles.length; i++) {
      const block = articles[i];
      const match = block.match(/href="\/([a-zA-Z0-9-_\.]+)\/([a-zA-Z0-9-_\.]+)"/);
      if (match) {
        const owner = match[1].trim();
        const name = match[2].trim();
        if (!['sponsors', 'trending', 'apps', 'features', 'site'].includes(owner)) {
          const repo = `${owner}/${name}`;
          if (!repos.includes(repo)) {
            repos.push(repo);
          }
        }
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
      const url = `https://trends.google.com/trending/rss?geo=${geo}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
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
      console.warn(`[Scraper Warning] Google Trends for ${geo} timed out or blocked. The topic selector will fallback safely.`);
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
