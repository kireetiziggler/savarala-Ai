import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Fetch developer community trends from Dev.to API (open access, never blocks datacenter/CI IPs)
async function fetchRedditTrends() {
  const trends = [];
  try {
    const url = 'https://dev.to/api/articles?top=3&per_page=40';
    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    });

    const articles = response.data || [];
    articles.forEach(article => {
      trends.push({
        source: `dev.to/t/${article.tag_list?.join(',') || 'tech'}`,
        title: article.title,
        score: article.public_reactions_count || 0,
        comments: article.comments_count || 0,
        url: article.url
      });
    });
  } catch (error) {
    console.warn(`[Scraper Warning] Dev.to API trends failed (Status ${error.response?.status || 'network error'}). The topic selector will fallback safely.`);
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
