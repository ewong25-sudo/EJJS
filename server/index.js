const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");
const axios = require("axios");
const https = require("https");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(cors());

// Railway / Render / Fly all set PORT via env. Fall back to 3001 locally.
const PORT = Number(process.env.PORT) || 3001;

// Persistent data directory. On Fly.io the container filesystem is wiped on
// every deploy, so durable data (ESPN leagues/cookies, saved bets) must live on
// a mounted volume. DATA_DIR points at that volume in production (/data) and
// falls back to the server folder locally. Files are migrated from the old
// in-repo location on first boot so nothing is lost.
const DATA_DIR = process.env.DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
function migrateLegacyFile(name) {
  const dest = `${DATA_DIR}/${name}`;
  const legacy = `${__dirname}/${name}`;
  if (DATA_DIR !== __dirname && !fs.existsSync(dest) && fs.existsSync(legacy)) {
    try { fs.copyFileSync(legacy, dest); } catch {}
  }
  return dest;
}
let liveGames = [];

// ---------------------------------------------------------------------------
// Existing NBA constants (kept for legacy NBA endpoints)
// ---------------------------------------------------------------------------

const SLUG_TO_TRICODE = {
  thunder: "OKC", pistons: "DET", spurs: "SAS", celtics: "BOS",
  nuggets: "DEN", knicks: "NYK", cavaliers: "CLE", lakers: "LAL",
  rockets: "HOU", raptors: "TOR", hawks: "ATL", timberwolves: "MIN",
  sixers: "PHI", suns: "PHX", blazers: "POR", magic: "ORL",
  hornets: "CHA", clippers: "LAC", warriors: "GSW", heat: "MIA",
  bucks: "MIL", pelicans: "NOP", bulls: "CHI", mavericks: "DAL",
  nets: "BKN", grizzlies: "MEM", pacers: "IND", kings: "SAC",
  wizards: "WAS", jazz: "UTA",
};

const NBA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

// ---------------------------------------------------------------------------
// ESPN constants
// ---------------------------------------------------------------------------

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_V2_BASE = "https://site.api.espn.com/apis/v2/sports";
const ESPN_CORE_BASE = "https://sports.core.api.espn.com/v2/sports";
const ESPN_LIVE_AGENT = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

const CORE_PATHS = {
  nba: "basketball/leagues/nba",
  nfl: "football/leagues/nfl",
  mlb: "baseball/leagues/mlb",
  nhl: "hockey/leagues/nhl",
};

// Broad keyword list — anything stat-related passes through; the client handles categorization
const KEY_PROP_NAMES = {
  nba: ["point", "assist", "rebound", "three", "steal", "block", "turnover", "pts", "reb", "ast", "blk", "stl"],
  nfl: ["yard", "touchdown", "completion", "sack", "intercept", "reception", "carry", "attempt"],
  mlb: ["strikeout", "hit", "base", "run", "rbi", "home run", "walk", "inning"],
  nhl: ["goal", "assist", "shot", "point", "save"],
};

const SPORT_PATHS = {
  nba: "basketball/nba",
  nfl: "football/nfl",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
};

const VALID_SPORTS = Object.keys(SPORT_PATHS);

// ---------------------------------------------------------------------------
// Simple in-memory cache (60 s TTL) for news + standings
// ---------------------------------------------------------------------------

const cache = new Map();

function cacheGet(key, maxAgeMs = 60000) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < maxAgeMs) return entry.data;
  return null;
}

function cacheSet(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Existing NBA helpers
// ---------------------------------------------------------------------------

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function todayString() {
  return toDateString(new Date());
}

function mapGame(g) {
  const homeAbbr = g?.homeTeam?.teamTricode || "HOME";
  const awayAbbr = g?.awayTeam?.teamTricode || "AWAY";
  return {
    id: String(g?.gameId ?? `${awayAbbr}_${homeAbbr}`),
    period: Number(g?.period ?? 0),
    clock: String(g?.gameClock ?? ""),
    status: String(g?.gameStatusText ?? ""),
    home: {
      team: homeAbbr,
      score: Number(g?.homeTeam?.score ?? 0),
      logo: `https://a.espncdn.com/i/teamlogos/nba/500/${homeAbbr}.png`,
    },
    away: {
      team: awayAbbr,
      score: Number(g?.awayTeam?.score ?? 0),
      logo: `https://a.espncdn.com/i/teamlogos/nba/500/${awayAbbr}.png`,
    },
  };
}

async function fetchLiveGames() {
  try {
    const res = await axios.get(
      "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json",
      { headers: NBA_HEADERS }
    );
    liveGames = (res.data?.scoreboard?.games || []).map(mapGame);
  } catch (e) {
    console.log("Live fetch error:", e.message);
  }
}

fetchLiveGames();
setInterval(fetchLiveGames, 15000);

function getCurrentSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 10) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`;
}

// ---------------------------------------------------------------------------
// ESPN mapping helpers
// ---------------------------------------------------------------------------

function normalizeLogoUrl(href) {
  // Strip /scoreboard/ segment so we always get the full-resolution logo
  if (!href) return '';
  return href.replace('/500/scoreboard/', '/500/').replace('/500-dark/scoreboard/', '/500-dark/');
}

function darkLogoFromUrl(standardUrl) {
  // Derive the ESPN dark-background logo URL from the standard one.
  // e.g. https://a.espncdn.com/i/teamlogos/mlb/500/sd.png → .../500-dark/sd.png
  if (!standardUrl) return '';
  return standardUrl.replace('/teamlogos/', '/teamlogos/').replace(/\/500\/([^/]+\.png)$/, '/500-dark/$1');
}

function mapTeam(t) {
  const logos = t.logos || [];
  const defaultLogo =
    logos.find(l => Array.isArray(l.rel) && l.rel.includes('default') && l.rel.includes('full') && !l.rel.includes('scoreboard') && !l.rel.includes('dark')) ||
    logos.find(l => Array.isArray(l.rel) && l.rel.includes('default') && !l.rel.includes('dark')) ||
    logos[0];
  // logoDark priority: explicit "on black" variant > ESPN dark variant > derived dark URL > fallback
  const darkLogo =
    logos.find(l => Array.isArray(l.rel) && l.rel.includes('primary_logo_on_black_color')) ||
    logos.find(l => Array.isArray(l.rel) && l.rel.includes('dark') && l.rel.includes('full') && !l.rel.includes('scoreboard') && !l.rel.includes('primary')) ||
    defaultLogo;
  const normalizedLogo = normalizeLogoUrl(defaultLogo?.href || t.logo || "");
  // When no explicit dark logo found in the logos array, derive it from the standard URL
  const normalizedDark = darkLogo && darkLogo !== defaultLogo
    ? normalizeLogoUrl(darkLogo.href)
    : darkLogoFromUrl(normalizedLogo) || normalizedLogo;
  return {
    id: String(t.id || ""),
    abbreviation: t.abbreviation || "",
    displayName: t.displayName || "",
    shortDisplayName: t.shortDisplayName || t.abbreviation || "",
    logo: normalizedLogo,
    logoDark: normalizedDark,
    color: t.color || "888888",
  };
}

function mapEvent(event, sport) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const homeComp =
    competitors.find((c) => c.homeAway === "home") || competitors[0] || {};
  const awayComp =
    competitors.find((c) => c.homeAway === "away") || competitors[1] || {};

  const getRecord = (comp) => comp.records?.find(r => r.type === 'total')?.summary || comp.records?.[0]?.summary || '';

  // Playoff round + series info
  const compNotes = competition.notes || [];
  const roundNote = compNotes.find(n => n.type === 'event')?.headline || '';
  const series = competition.series || null;
  const seriesSummary = series?.summary || '';

  return {
    id: event.id,
    shortName: event.shortName || "",
    date: event.date,
    status: {
      clock: event.status?.displayClock || "",
      period: event.status?.period || 0,
      state: event.status?.type?.state || "",
      detail:
        event.status?.type?.detail ||
        event.status?.type?.shortDetail ||
        "",
    },
    home: {
      team: mapTeam(homeComp.team || {}),
      score: homeComp.score || "0",
      record: getRecord(homeComp),
    },
    away: {
      team: mapTeam(awayComp.team || {}),
      score: awayComp.score || "0",
      record: getRecord(awayComp),
    },
    // Pre-game odds (when present) — feeds Trending Parlays + Bets widgets
    odds: (() => {
      const o = competition.odds?.[0];
      if (!o) return null;
      return {
        provider: o.provider?.name || "",
        details: o.details || "",                       // e.g. "LAL -3.5"
        spread: o.spread ?? null,
        overUnder: o.overUnder ?? null,
        awayMoneyLine: o.awayTeamOdds?.moneyLine ?? null,
        homeMoneyLine: o.homeTeamOdds?.moneyLine ?? null,
        overOdds: o.overOdds ?? null,
        underOdds: o.underOdds ?? null,
      };
    })(),
    note: roundNote,
    seriesSummary,
    sport,
  };
}

function mapArticle(article, sport) {
  return {
    id: String(
      article.dataSourceIdentifier || article.id || Math.random()
    ),
    headline: article.headline || "",
    description: article.description || "",
    published: article.published || "",
    image:
      article.images?.find((i) => i.width >= 400)?.url ||
      article.images?.[0]?.url ||
      null,
    url: article.links?.web?.href || "",
    sport,
    source: "ESPN",
  };
}

// --- Multi-source news via RSS (CBS Sports + Yahoo Sports) ---------------
function decodeEntities(s) {
  return (s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, "").trim();
}

function parseRss(xml, sport, source) {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  return items.slice(0, 12).map((it) => {
    const get = (tag) => {
      const m = it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? decodeEntities(m[1]) : "";
    };
    const imgMatch =
      it.match(/<media:content[^>]*url="([^"]+)"/) ||
      it.match(/<media:thumbnail[^>]*url="([^"]+)"/) ||
      it.match(/<enclosure[^>]*url="([^"]+)"/) ||
      it.match(/<img[^>]*src="([^"]+)"/);
    return {
      id: `${source}-${(get("link") || Math.random()).slice(-40)}`,
      headline: get("title"),
      description: get("description").slice(0, 200),
      published: (() => { const d = get("pubDate"); const t = Date.parse(d); return isNaN(t) ? new Date().toISOString() : new Date(t).toISOString(); })(),
      image: imgMatch ? imgMatch[1] : null,
      url: get("link"),
      sport,
      source,
    };
  }).filter((a) => a.headline && a.url);
}

const RSS_SPORT_SLUG = { nba: "nba", nfl: "nfl", mlb: "mlb", nhl: "nhl" };
async function fetchExtraNews(sport) {
  const slug = RSS_SPORT_SLUG[sport];
  if (!slug) return [];
  const feeds = [
    { url: `https://www.cbssports.com/rss/headlines/${slug}/`, source: "CBS Sports" },
    { url: `https://sports.yahoo.com/${slug}/rss/`, source: "Yahoo Sports" },
  ];
  const results = await Promise.allSettled(
    feeds.map((f) =>
      axios.get(f.url, { timeout: 7000, responseType: "text" }).then((r) => parseRss(r.data, sport, f.source))
    )
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

// Interleave articles from multiple sources for diversity, newest-ish first.
function mergeNews(...lists) {
  const all = lists.flat();
  // Sort by published desc, but cap any single source so one doesn't dominate.
  all.sort((a, b) => Date.parse(b.published || 0) - Date.parse(a.published || 0));
  return all;
}

// Flatten the standings tree down to the LEAF groups (divisions) while carrying
// the parent conference/league name so the client can filter by conference or
// by division. `conference` is the top-most ancestor's name (e.g. "American
// League", "Eastern Conference"); for a top-level league with no division
// children it falls back to the group's own name.
// Overall W-L record summary (e.g. "38-41") from an ESPN competitor.
function recordSummary(competitor) {
  const recs = competitor?.record || competitor?.records || [];
  if (!Array.isArray(recs)) return "";
  const total = recs.find((r) => r.type === "total") || recs[0];
  return total?.summary || "";
}

function flattenGroups(node, conference = null) {
  const conf = conference || node?.name || null;
  if (node?.children && node.children.length) {
    return node.children.flatMap((child) => flattenGroups(child, conf));
  }
  if (node?.standings?.entries) {
    return [{ name: node.name, conference: conf, standings: node.standings }];
  }
  return [];
}

function mapStandingsGroups(rawData) {
  let groups = [];

  const topGroups = rawData?.standings?.groups || rawData?.children || [rawData];
  // Walk each top-level conference/league down to its division leaves.
  groups = topGroups.flatMap((g) => flattenGroups(g));

  return groups.map((group) => ({
    conference: group.conference || group.name,
    name: group.name,
    entries: (group.standings?.entries || []).map((entry, i) => {
      const getStat = (name) =>
        entry.stats?.find(
          (s) => s.name === name || s.abbreviation === name
        );

      const pointsStat = getStat("points");

      return {
        rank: i + 1,
        team: {
          id: String(entry.team?.id || ""),
          abbreviation: entry.team?.abbreviation || "",
          displayName: entry.team?.displayName || "",
          shortDisplayName: entry.team?.shortDisplayName || "",
          logo: entry.team?.logos?.[0]?.href || "",
          color: entry.team?.color || "888888",
        },
        wins: Number(getStat("wins")?.value ?? 0),
        losses: Number(getStat("losses")?.value ?? 0),
        pct:
          getStat("winPercent")?.displayValue ??
          getStat("PCT")?.displayValue ??
          ".000",
        gb: getStat("gamesBehind")?.displayValue ?? "-",
        points: pointsStat ? Number(pointsStat.value) : undefined,
        streak: getStat("streak")?.displayValue ?? "",
        // Extended columns (ESPN-style standings table)
        home: getStat("Home")?.displayValue ?? "-",
        away: getStat("Road")?.displayValue ?? getStat("AWAY")?.displayValue ?? "-",
        last10: getStat("Last Ten Games")?.displayValue ?? getStat("Last Ten")?.displayValue ?? "-",
        pointsFor: getStat("pointsFor")?.displayValue ?? getStat("RS")?.displayValue ?? "-",
        pointsAgainst: getStat("pointsAgainst")?.displayValue ?? getStat("RA")?.displayValue ?? "-",
        diff: getStat("pointDifferential")?.displayValue ?? getStat("DIFF")?.displayValue ?? "-",
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Middleware: validate :sport param
// ---------------------------------------------------------------------------

function validateSport(req, res, next) {
  const { sport } = req.params;
  if (!VALID_SPORTS.includes(sport)) {
    return res.status(400).json({
      error: `Invalid sport. Valid values: ${VALID_SPORTS.join(", ")}`,
    });
  }
  next();
}

// ---------------------------------------------------------------------------
// Existing NBA endpoints (UNCHANGED)
// ---------------------------------------------------------------------------

app.get("/nba/games", async (req, res) => {
  const date = req.query.date;
  if (!date || date === todayString()) {
    return res.json({ games: liveGames });
  }

  try {
    const r = await axios.get(
      `https://stats.nba.com/stats/scoreboardV3?GameDate=${date}&LeagueID=00`,
      { headers: NBA_HEADERS }
    );
    const games = (r.data?.scoreboard?.games || []).map(mapGame);
    res.json({ games });
  } catch (e) {
    console.log("Historical fetch error:", e.message);
    res
      .status(502)
      .json({ games: [], error: "Could not fetch games for that date" });
  }
});

app.get("/nba/boxscore/:gameId", async (req, res) => {
  const { gameId } = req.params;
  try {
    const r = await axios.get(
      `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`,
      { headers: NBA_HEADERS }
    );
    const g = r.data?.game;
    if (!g) return res.status(404).json({ error: "No boxscore found" });

    function mapPlayers(team) {
      return (team.players || []).map((p) => {
        const s = p.statistics || {};
        const rawMin = s.minutesCalculated || s.minutes || "PT00M";
        const minMatch = rawMin.match(/PT(\d+)M/);
        return {
          name: p.name || "",
          nameI: p.nameI || "",
          position: p.position || "",
          minutes: minMatch ? minMatch[1] + "m" : "0m",
          points: s.points ?? 0,
          rebounds: s.reboundsTotal ?? 0,
          assists: s.assists ?? 0,
          steals: s.steals ?? 0,
          blocks: s.blocks ?? 0,
          fieldGoalsMade: s.fieldGoalsMade ?? 0,
          fieldGoalsAttempted: s.fieldGoalsAttempted ?? 0,
          threesMade: s.threePointersMade ?? 0,
          threesAttempted: s.threePointersAttempted ?? 0,
          freeThrowsMade: s.freeThrowsMade ?? 0,
          freeThrowsAttempted: s.freeThrowsAttempted ?? 0,
          plusMinus: s.plusMinusPoints ?? 0,
          starter: p.starter === "1" || p.starter === true,
        };
      });
    }

    const homeAbbr = g.homeTeam?.teamTricode || "HOME";
    const awayAbbr = g.awayTeam?.teamTricode || "AWAY";

    res.json({
      gameId: g.gameId,
      status: g.gameStatusText || "",
      period: g.period || 0,
      clock: g.gameClock || "",
      home: {
        team: homeAbbr,
        logo: `https://a.espncdn.com/i/teamlogos/nba/500/${homeAbbr}.png`,
        score: g.homeTeam?.score ?? 0,
        players: mapPlayers(g.homeTeam),
      },
      away: {
        team: awayAbbr,
        logo: `https://a.espncdn.com/i/teamlogos/nba/500/${awayAbbr}.png`,
        score: g.awayTeam?.score ?? 0,
        players: mapPlayers(g.awayTeam),
      },
    });
  } catch (e) {
    console.log("Boxscore fetch error:", e.message);
    res.status(502).json({ error: "Could not fetch boxscore" });
  }
});

app.get("/nba/standings", async (req, res) => {
  const season = req.query.season || getCurrentSeason();
  try {
    const r = await axios.get(
      `https://stats.nba.com/stats/leaguestandingsv3?LeagueID=00&Season=${season}&SeasonType=Regular+Season&Section=overall`,
      { headers: NBA_HEADERS }
    );
    const data = r.data?.resultSets?.[0];
    if (!data) return res.status(404).json({ standings: [] });

    const headers = data.headers;
    const rows = data.rowSet;

    function col(row, name) {
      return row[headers.indexOf(name)];
    }

    const standings = rows.map((row) => {
      const streak = col(row, "strCurrentStreak") || "";
      const streakType = streak.startsWith("W") ? "W" : "L";
      const streakNum = parseInt(streak.replace(/\D/g, ""), 10) || 0;
      const l10 = col(row, "L10") || "0-0";
      const [l10w, l10l] = l10.split("-").map(Number);
      return {
        teamId: col(row, "TeamID"),
        teamCity: col(row, "TeamCity"),
        teamName: col(row, "TeamName"),
        teamTricode:
          SLUG_TO_TRICODE[col(row, "TeamSlug")] ??
          col(row, "TeamSlug")?.toUpperCase() ??
          "",
        conference: col(row, "Conference"),
        wins: col(row, "WINS"),
        losses: col(row, "LOSSES"),
        winPct: col(row, "WinPCT"),
        gamesBehind: col(row, "ConferenceGamesBack") ?? 0,
        streak: streakNum,
        streakType,
        last10Wins: l10w || 0,
        last10Losses: l10l || 0,
        clinchIndicator: (col(row, "ClinchIndicator") || "")
          .replace(/\s*-\s*/, "")
          .trim(),
      };
    });

    res.json({ standings, season });
  } catch (e) {
    console.log("Standings fetch error:", e.message);
    res
      .status(502)
      .json({ standings: [], error: "Could not fetch standings" });
  }
});

// ---------------------------------------------------------------------------
// ESPN endpoints
// IMPORTANT: /sports/all/news must be declared BEFORE /sports/:sport/news
// so Express does not interpret "all" as a :sport parameter.
// ---------------------------------------------------------------------------

// GET /sports/all/news — parallel fetch from all 4 sports (5 each), merged + sorted
app.get("/sports/all/news", async (req, res) => {
  const cacheKey = "news:all";
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const fetches = VALID_SPORTS.map(async (sport) => {
      const sportPath = SPORT_PATHS[sport];
      const url = `${ESPN_BASE}/${sportPath}/news?limit=5`;
      const [espn, extra] = await Promise.all([
        axios.get(url).then((r) => (r.data?.articles || []).map((a) => mapArticle(a, sport))).catch(() => []),
        fetchExtraNews(sport).then((a) => a.slice(0, 4)).catch(() => []),
      ]);
      return [...espn, ...extra];
    });

    const results = await Promise.allSettled(fetches);
    const merged = results.flatMap((r) =>
      r.status === "fulfilled" ? r.value : []
    );
    merged.sort((a, b) => {
      const ta = a.published ? new Date(a.published).getTime() : 0;
      const tb = b.published ? new Date(b.published).getTime() : 0;
      return tb - ta;
    });

    const result = { articles: merged };
    cacheSet(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.log("all-news fetch error:", e.message);
    res.status(502).json({ articles: [], error: "Could not fetch news" });
  }
});

// GET /sports/:sport/scores?date=YYYY-MM-DD
app.get("/sports/:sport/scores", validateSport, async (req, res) => {
  const { sport } = req.params;
  const sportPath = SPORT_PATHS[sport];

  // NFL uses week-based navigation instead of dates
  if (sport === "nfl") {
    const week = req.query.week;
    const seasontype = req.query.seasontype || "2";
    const year = req.query.year;
    let params = "";
    if (week) {
      params = `?seasontype=${seasontype}&week=${week}`;
      if (year) params += `&dates=${year}`;
    }
    const url = `${ESPN_BASE}/${sportPath}/scoreboard${params}${params ? '&limit=100' : '?limit=100'}`;
    try {
      const r = await axios.get(url);
      const events = (r.data?.events || []).map((e) => mapEvent(e, sport));
      const weekNum = r.data?.week?.number ?? null;
      const seasonType = r.data?.season?.type ?? 2;
      const seasonYear = r.data?.season?.year ?? new Date().getFullYear();
      res.json({ sport, games: events, week: weekNum, seasontype: seasonType, seasonYear });
    } catch (e) {
      console.log(`ESPN NFL scores fetch error:`, e.message);
      res.status(502).json({ sport, games: [], error: "Could not fetch scores" });
    }
    return;
  }

  const dateParam = req.query.date; // YYYY-MM-DD or undefined
  // ESPN scoreboard expects dates as YYYYMMDD
  const datesQuery = dateParam ? dateParam.replace(/-/g, "") : "";
  const url = `${ESPN_BASE}/${sportPath}/scoreboard${datesQuery ? `?dates=${datesQuery}&limit=100` : `?limit=100`}`;

  try {
    const r = await axios.get(url);
    const events = (r.data?.events || []).map((e) => mapEvent(e, sport));
    res.json({ sport, games: events });
  } catch (e) {
    console.log(`ESPN scores fetch error [${sport}]:`, e.message);
    res
      .status(502)
      .json({ sport, games: [], error: "Could not fetch scores" });
  }
});

// GET /sports/:sport/news
app.get("/sports/:sport/news", validateSport, async (req, res) => {
  const { sport } = req.params;
  const cacheKey = `news:${sport}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  const sportPath = SPORT_PATHS[sport];
  const url = `${ESPN_BASE}/${sportPath}/news?limit=20`;

  try {
    const [espnRes, extra] = await Promise.all([
      axios.get(url).then((r) => (r.data?.articles || []).map((a) => mapArticle(a, sport))).catch(() => []),
      fetchExtraNews(sport).catch(() => []),
    ]);
    const articles = mergeNews(espnRes, extra);
    const result = { sport, articles };
    cacheSet(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.log(`news fetch error [${sport}]:`, e.message);
    res
      .status(502)
      .json({ sport, articles: [], error: "Could not fetch news" });
  }
});

// GET /sports/:sport/standings?season=YYYY&seasontype=N
//   seasontype: 1 = preseason/spring training, 2 = regular season (default)
app.get("/sports/:sport/standings", validateSport, async (req, res) => {
  const { sport } = req.params;
  const season = (req.query.season || "").toString().trim();
  const seasontype = (req.query.seasontype || "2").toString().trim();
  const cacheKey = `standings:${sport}:${season || "cur"}:${seasontype}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  const sportPath = SPORT_PATHS[sport];
  // level=3 returns the full conference → division tree so we can offer
  // division-level filtering on the client.
  const params = ["level=3"];
  if (season) params.push(`season=${encodeURIComponent(season)}`);
  if (seasontype) params.push(`seasontype=${encodeURIComponent(seasontype)}`);
  const url = `${ESPN_V2_BASE}/${sportPath}/standings?${params.join("&")}`;

  try {
    const r = await axios.get(url);
    const groups = mapStandingsGroups(r.data);
    const result = { sport, groups, season: season || null, seasontype };
    cacheSet(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.log(`ESPN standings fetch error [${sport}]:`, e.message);
    res
      .status(502)
      .json({ sport, groups: [], error: "Could not fetch standings" });
  }
});

// GET /sports/:sport/game/:eventId  — ESPN summary (box score)
// ESPN odds-provider IDs per sportsbook (used for game lines + prop bets).
// FanDuel is NOT in ESPN's free feed — handled via a paid odds API when a key
// is configured; falls back to DraftKings data otherwise.
const BOOK_PROVIDER_IDS = {
  draftkings: [100, 1000],
  caesars: [45, 38, 31],
  fanduel: [], // not in ESPN
};
const BOOK_NAME_MATCH = {
  draftkings: /draft/i,
  caesars: /caesar|william hill/i,
  fanduel: /fanduel|fan duel/i,
};

app.get("/sports/:sport/game/:eventId", validateSport, async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  const { sport, eventId } = req.params;
  const book = String(req.query.book || "draftkings").toLowerCase();
  const sportPath = SPORT_PATHS[sport];
  const url = `${ESPN_BASE}/${sportPath}/summary`;

  try {
    const r = await axios.get(url, {
      params: { event: eventId, _: Date.now() },
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Accept: "application/json",
      },
      httpsAgent: ESPN_LIVE_AGENT,
      timeout: 5000,
    });
    const data = r.data;

    const comp = data.header?.competitions?.[0];
    const competitors = comp?.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home") || competitors[0] || {};
    const away = competitors.find((c) => c.homeAway === "away") || competitors[1] || {};

    const status = {
      // ESPN's authoritative game state: 'pre' (scheduled), 'in' (live), 'post'
      // (final). Use this — not the description text — to decide LIVE.
      state: comp?.status?.type?.state || "pre",
      completed: !!comp?.status?.type?.completed,
      description:
        comp?.status?.type?.shortDetail ||
        comp?.status?.type?.detail ||
        comp?.status?.type?.description ||
        "",
      clock: comp?.status?.displayClock || "",
      period: comp?.status?.period || 0,
    };

    // Season stats from header competitors (available pre-game)
    // teamSeasonStats is populated after fetchTeamRecordStats runs (below), so compute after Promise.all
    const _rawTeamSeasonStats = competitors.map((c) => ({
      homeAway: c.homeAway || "",
      teamId: String(c.team?.id || ""),
      abbreviation: c.team?.abbreviation || "",
      record: c.record?.[0]?.displayValue || "",
      stats: (c.statistics || []).map((s) => ({
        name: s.name || "",
        label: s.shortDisplayName || s.displayName || s.name || "",
        displayValue: s.displayValue || "",
      })),
    }));

    // Map player stats from boxscore.players[]
    // Build batter stats from statistics[0] (batting group).
    const readHotZoneNumber = (...values) => {
      for (const value of values) {
        const raw = typeof value === "object" && value !== null
          ? (value.displayValue ?? value.value ?? value.number ?? "")
          : value;
        if (raw == null || raw === "") continue;
        const cleaned = String(raw).replace(/[^\d.-]/g, "");
        if (!cleaned) continue;
        const parsed = Number(cleaned);
        if (Number.isFinite(parsed)) return parsed;
      }
      return 0;
    };
    const readHotZoneAvg = (z) => readHotZoneNumber(
      z.battingAvg,
      z.battingAverage,
      z.avg,
      z.average,
      z.ba,
      z.value,
      z.displayValue,
      z.stats?.battingAvg,
      z.stats?.battingAverage,
      z.stats?.avg,
    );
    const readHotZoneList = (athleteEntry) => {
      const athlete = athleteEntry.athlete || {};
      const groups = athlete.hotZones || athleteEntry.hotZones || [];
      if (!Array.isArray(groups)) return [];
      const activeGroup = groups.find((z) => z.active && Array.isArray(z.zones));
      if (activeGroup) return activeGroup.zones;
      const firstZoneGroup = groups.find((z) => Array.isArray(z.zones));
      if (firstZoneGroup) return firstZoneGroup.zones;
      return groups.filter((z) => z && (z.zoneId || z.id || z.battingAvg || z.battingAverage || z.avg || z.displayValue));
    };
    const playerTeams = (data.boxscore?.players || []).map((teamData) => {
      const statsGroup = teamData.statistics?.[0] || {};
      const labels = statsGroup.labels || statsGroup.names || [];
      const athletes = (statsGroup.athletes || [])
        .filter((a) => !a.didNotPlay)
        .map((a) => ({
          id: String(a.athlete?.id || ""),
          name: a.athlete?.displayName || "",
          position: a.position?.abbreviation || a.athlete?.position?.abbreviation || "",
          battingOrder: Number(a.order ?? a.battingOrder ?? a.lineupSlot ?? 0) || null,
          hotZones: readHotZoneList(a)
            .map((z) => ({
              zoneId: readHotZoneNumber(z.zoneId, z.id, z.zone, z.zoneNumber),
              xMin: readHotZoneNumber(z.xMin, z.minX),
              xMax: readHotZoneNumber(z.xMax, z.maxX),
              yMin: readHotZoneNumber(z.yMin, z.minY),
              yMax: readHotZoneNumber(z.yMax, z.maxY),
              atBats: readHotZoneNumber(z.atBats, z.ab, z.abs),
              hits: readHotZoneNumber(z.hits, z.h),
              battingAvg: readHotZoneAvg(z),
              battingAvgScore: readHotZoneNumber(z.battingAvgScore, z.avgScore, z.score),
            }))
            .filter((z) => z.zoneId > 0)
            .sort((x, y) => x.zoneId - y.zoneId),
          headshot: a.athlete?.headshot?.href || (a.athlete?.id ? `https://a.espncdn.com/i/headshots/${sport}/players/full/${a.athlete.id}.png` : ""),
          starter: !!a.starter,
          stats: Object.fromEntries(labels.map((l, i) => [l, a.stats?.[i] ?? "--"])),
        }));
      return { teamId: String(teamData.team?.id || ""), labels, athletes };
    });

    // Build pitcher stats from statistics[1] (pitching group, MLB only).
    // Exposed separately so fantasy matching can find pitchers without
    // mixing them into the batting box-score table.
    const pitcherTeams = (data.boxscore?.players || []).map((teamData) => {
      const statsGroup = teamData.statistics?.[1] || {};
      const labels = statsGroup.labels || statsGroup.names || [];
      const athletes = (statsGroup.athletes || [])
        .filter((a) => !a.didNotPlay)
        .map((a) => ({
          id: String(a.athlete?.id || ""),
          name: a.athlete?.displayName || "",
          position: a.athlete?.position?.abbreviation || "",
          headshot: a.athlete?.headshot?.href || (a.athlete?.id ? `https://a.espncdn.com/i/headshots/${sport}/players/full/${a.athlete.id}.png` : ""),
          starter: !!a.starter,
          stats: Object.fromEntries(labels.map((l, i) => [l, a.stats?.[i] ?? "--"])),
        }));
      return { teamId: String(teamData.team?.id || ""), labels, athletes };
    });

    // Map team-level stats from boxscore.teams[] — filter out header rows with no numeric value
    const teamStats = (data.boxscore?.teams || []).map((t) => ({
      teamId: String(t.team?.id || ""),
      stats: (t.statistics || [])
        .map((s) => ({ label: s.label || s.name, value: s.displayValue }))
        .filter((s) => s.value && s.value !== "--" && s.value !== "" && /\d/.test(s.value)),
    }));

    // For MLB: parse play-by-play to extract 2B / 3B / SB / CS / HBP per player.
    // ESPN's box score only gives H/HR/BB/K, so we mine play text for total-
    // base detail and other stats fantasy scoring depends on. Results are
    // merged into athlete.stats so the client formula has everything it needs.
    if (sport === 'mlb' && Array.isArray(data.plays)) {
      const xbh = {};       // athleteId → { '2B', '3B', 'SB', 'CS', 'HBP' }
      const ensure = (id) => {
        if (!xbh[id]) xbh[id] = { '2B': 0, '3B': 0, 'SB': 0, 'CS': 0, 'HBP': 0 };
      };
      for (const p of data.plays) {
        const txt = (p.text || '').toLowerCase();
        const batter = (p.participants || []).find(pp => pp.type === 'batter');
        const runner = (p.participants || []).find(pp => pp.type === 'runner');
        const batterId = batter?.athlete?.id ? String(batter.athlete.id) : null;
        const runnerId = runner?.athlete?.id ? String(runner.athlete.id) : null;

        if (batterId) {
          ensure(batterId);
          if (/\bdoubled\b/.test(txt) || /\bhit a double\b/.test(txt)) xbh[batterId]['2B']++;
          if (/\btripled\b/.test(txt) || /\bhit a triple\b/.test(txt)) xbh[batterId]['3B']++;
          if (/\bhit by pitch\b/.test(txt)) xbh[batterId]['HBP']++;
        }
        // Stolen base + caught stealing — typically attributed to the runner
        if (/\bstole\b/.test(txt) || /\bstolen base\b/.test(txt)) {
          const sbId = runnerId || batterId;
          if (sbId) { ensure(sbId); xbh[sbId]['SB']++; }
        }
        if (/\bcaught stealing\b/.test(txt)) {
          const csId = runnerId || batterId;
          if (csId) { ensure(csId); xbh[csId]['CS']++; }
        }
      }
      // Merge into existing athletes' stat dicts by ID
      for (const team of playerTeams) {
        for (const ath of team.athletes) {
          const e = xbh[ath.id];
          ath.stats['2B']  = String(e?.['2B']  ?? 0);
          ath.stats['3B']  = String(e?.['3B']  ?? 0);
          ath.stats['SB']  = String(e?.['SB']  ?? 0);
          ath.stats['CS']  = String(e?.['CS']  ?? 0);
          ath.stats['HBP'] = String(e?.['HBP'] ?? 0);
        }
      }
    }

    const series = comp?.series || null;
    const seriesInfo = series
      ? { summary: series.summary || "", completed: series.completed || false }
      : null;
    const notes = (comp?.notes || []).map((n) => n.headline || n.text || "").filter(Boolean);

    // Pre-game stat leaders (Points / Assists / Rebounds / etc per team)
    const leaders = (data.leaders || []).map((teamLeaders) => ({
      teamId: String(teamLeaders.team?.id || ""),
      teamAbbr: teamLeaders.team?.abbreviation || "",
      categories: (teamLeaders.leaders || []).map((cat) => {
        const top = cat.leaders?.[0] || {};
        const athlete = top.athlete || {};
        return {
          name: cat.name || "",
          displayName: cat.displayName || "",
          athlete: {
            id: String(athlete.id || ""),
            displayName: athlete.displayName || "",
            headshot: athlete.headshot?.href || "",
            position: athlete.position?.abbreviation || "",
          },
          displayValue: top.displayValue || "",
        };
      }),
    }));

    // MLB probable pitchers
    const probables = competitors.map((c) => {
      const prob = (c.probables || [])[0];
      if (!prob) return null;
      const a = prob.athlete || {};
      // ESPN sometimes returns `statistics` as an OBJECT (categorized splits)
      // rather than an array — spreading a non-array throws "not iterable" and
      // 502s the whole box score. Only spread real arrays.
      const arr = (v) => (Array.isArray(v) ? v : []);
      const statEntries = [
        ...arr(a.statistics),
        ...arr(a.stats),
        ...arr(prob.statistics),
        ...arr(prob.stats),
      ];
      const stats = {};
      for (const s of statEntries) {
        const key = s.abbreviation || s.shortDisplayName || s.name || s.displayName;
        const value = s.displayValue ?? s.value;
        if (key && value != null && value !== "") stats[String(key).toUpperCase()] = String(value);
      }
      return {
        homeAway: c.homeAway,
        pitcher: {
          id: String(a.id || ""),
          displayName: a.displayName || "",
          headshot: a.headshot?.href || (a.id ? `https://a.espncdn.com/i/headshots/mlb/players/full/${a.id}.png` : ""),
          throwingArm: a.throwingArm?.abbreviation || "",
          stats,
        },
      };
    }).filter(Boolean);

    // Betting odds from pickcenter — prefer the SELECTED book's provider, then
    // fall back to DraftKings, then any available provider.
    const bookMatch = BOOK_NAME_MATCH[book] || /draft/i;
    const pc =
      (data.pickcenter || []).find((p) => bookMatch.test(p.provider?.name || "")) ||
      (data.pickcenter || []).find((p) => p.provider?.name?.includes("Draft")) ||
      (data.pickcenter || [])[0];
    const gameOdds = pc ? {
      provider: pc.provider?.name || "DraftKings",
      spread: pc.details || "",
      overUnder: pc.overUnder ?? null,
      overOdds: pc.overOdds ?? null,
      underOdds: pc.underOdds ?? null,
      awayMoneyLine: pc.awayTeamOdds?.moneyLine ?? null,
      homeMoneyLine: pc.homeTeamOdds?.moneyLine ?? null,
    } : null;

    // Build athlete ID → {name, headshot} lookup (seed with box score + leaders)
    const athleteMap = {};
    for (const team of (data.boxscore?.players || [])) {
      const sg = team.statistics?.[0] || {};
      for (const a of (sg.athletes || [])) {
        const id = String(a.athlete?.id || "");
        if (id) athleteMap[id] = { name: a.athlete?.displayName || "", headshot: a.athlete?.headshot?.href || `https://a.espncdn.com/i/headshots/${sport}/players/full/${id}.png` };
      }
    }
    for (const tl of (data.leaders || [])) {
      for (const cat of (tl.leaders || [])) {
        for (const l of (cat.leaders || [])) {
          const id = String(l.athlete?.id || "");
          if (id) athleteMap[id] = { name: l.athlete?.displayName || "", headshot: l.athlete?.headshot?.href || "" };
        }
      }
    }

    // Extract rosters from ESPN summary API response (available even pre-game)
    // Also collect into summaryRosterPlayers so they appear on the client
    const summaryRosterPlayers = [];
    for (const teamRoster of (data.rosters || [])) {
      const tid = String(teamRoster.team?.id || "");
      for (const entry of (teamRoster.entries || [])) {
        const a = entry.athlete || {};
        const pid = String(a.id || "");
        const pname = a.displayName || a.fullName || "";
        if (!pid || !pname) continue;
        if (!athleteMap[pid]) athleteMap[pid] = { name: pname, headshot: a.headshot?.href || "" };
        summaryRosterPlayers.push({ id: pid, name: pname, position: a.position?.abbreviation || "", teamId: tid });
      }
    }

    // Fetch full team rosters + props in parallel
    const homeTeamId = String(home.team?.id || "");
    const awayTeamId = String(away.team?.id || "");

    async function fetchRoster(teamId) {
      if (!teamId) return [];
      try {
        const { data: rd } = await axios.get(`${ESPN_BASE}/${sportPath}/teams/${teamId}/roster`, { timeout: 8000 });
        const players = [];
        // ESPN returns athletes grouped by position: [{ position, items: [...] }]
        for (const group of (rd.athletes || [])) {
          const list = Array.isArray(group.items) ? group.items : (group.id ? [group] : []);
          for (const a of list) {
            if (!a.id) continue;
            const name = a.displayName || a.fullName || a.shortName || "";
            if (!name) continue;
            players.push({
              id: String(a.id),
              name,
              position: a.position?.abbreviation || "",
              headshot: a.headshot?.href || `https://a.espncdn.com/i/headshots/${sport}/players/full/${a.id}.png`,
            });
          }
        }
        return players;
      } catch (_) { return []; }
    }

    // The Odds API key — powers FanDuel, Caesars, and DraftKings props with
    // real sportsbook-specific lines (ESPN only has DraftKings).
    const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
    const ODDS_SPORT_MAP = { nba: "basketball_nba", nfl: "americanfootball_nfl", mlb: "baseball_mlb", nhl: "icehockey_nhl" };
    const ODDS_BOOK_MAP = { draftkings: "draftkings", fanduel: "fanduel", caesars: "williamhill_us" };
    const ODDS_MARKETS = {
      mlb: "pitcher_strikeouts,batter_total_bases,batter_hits,batter_home_runs,batter_rbis,batter_runs_scored,batter_stolen_bases",
      nba: "player_points,player_rebounds,player_assists,player_threes",
      nfl: "player_pass_yds,player_pass_tds,player_rush_yds,player_reception_yds,player_receptions",
      nhl: "player_points,player_goals,player_assists,player_shots_on_goal",
    };

    async function fetchProps() {
      const corePath = CORE_PATHS[sport];
      let rawProps = [];
      // Try the selected book's ESPN providers first, then fall back to the
      // default DraftKings-first order so there's always something to show.
      const bookProviders = BOOK_PROVIDER_IDS[book] || [];
      const providerOrder = [...bookProviders, 1000, 100, 45];
      for (const provider of providerOrder) {
        try {
          const { data: pd } = await axios.get(
            `${ESPN_CORE_BASE}/${corePath}/events/${eventId}/competitions/${eventId}/odds/${provider}/propBets?limit=500`,
            { timeout: 5000 }
          );
          rawProps = pd?.items || [];
          if (rawProps.length > 0) break;
        } catch (_) {}
      }
      return rawProps;
    }

    // Fetch player props from The Odds API for the selected sportsbook.
    // Returns an array of ESPN-shaped playerProp objects so the client can
    // display them with the same renderer. Falls back gracefully if the API
    // has no data for this game/book (off-season, unavailable market, etc.).
    async function fetchOddsApiProps() {
      const oddsSport = ODDS_SPORT_MAP[sport];
      const oddsBook = ODDS_BOOK_MAP[book];
      if (!oddsSport || !oddsBook || !ODDS_API_KEY) return { props: [], bookGameOdds: {} };
      // DraftKings is fully covered by ESPN for free — never spend paid Odds API
      // credits on it. Only FanDuel / Caesars need the external API.
      if (book === "draftkings") return { props: [], bookGameOdds: {} };
      // Cache per game+book for 10 minutes so repeated loads don't burn credits.
      const oddsCacheKey = `oddsapi:${sport}:${eventId}:${book}`;
      const cachedOdds = cacheGet(oddsCacheKey, 600000); // 10 min — conserve credits
      if (cachedOdds) return cachedOdds;
      try {
        // Step 1: find The Odds API event ID for this ESPN event. Match by team
        // names since the IDs are different systems.
        const homeTeamName = home.team?.displayName || home.team?.name || "";
        const awayTeamName = away.team?.displayName || away.team?.name || "";
        const { data: events } = await axios.get(
          `https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${ODDS_API_KEY}`,
          { timeout: 8000 }
        );
        // Match by team NICKNAME (last word) since full names differ between
        // ESPN ("Texas Rangers") and The Odds API ("Texas Rangers" usually but
        // sometimes "Athletics" vs "Oakland Athletics"). Nickname match is the
        // most reliable cross-platform key.
        const nick = (full) => (full || "").toLowerCase().split(" ").pop();
        const homeNick = nick(homeTeamName);
        const awayNick = nick(awayTeamName);
        const match = (events || []).find(e => {
          const h = nick(e.home_team);
          const a = nick(e.away_team);
          return h === homeNick && a === awayNick;
        });
        if (!match) { const r = { props: [], bookGameOdds: {} }; cacheSet(oddsCacheKey, r); return r; }

        // Step 2: fetch player props AND game lines in ONE request (props markets
        // + h2h/spreads/totals together) to halve the credit cost.
        const markets = [ODDS_MARKETS[sport] || "", "h2h", "spreads", "totals"].filter(Boolean).join(",");
        const { data: oddsData } = await axios.get(
          `https://api.the-odds-api.com/v4/sports/${oddsSport}/events/${match.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&bookmakers=${oddsBook}`,
          { timeout: 8000 }
        );
        const bm = (oddsData?.bookmakers || []).find(b => b.key === oddsBook);
        if (!bm) { const r = { props: [], bookGameOdds: {} }; cacheSet(oddsCacheKey, r); return r; }
        const linesBm = bm; // same bookmaker object holds props + lines markets

        // Step 4: convert to ESPN-shaped prop objects
        const props = [];
        for (const mkt of (bm.markets || [])) {
          // Market key like "pitcher_strikeouts" → readable "Pitcher Strikeouts"
          const typeName = mkt.key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          for (const o of (mkt.outcomes || [])) {
            if (o.name !== "Over") continue; // only keep the Over line (has player + point)
            const playerName = o.description || "";
            const line = o.point;
            const overOdds = o.price;
            const underEntry = (mkt.outcomes || []).find(u => u.name === "Under" && u.description === playerName);
            const underOdds = underEntry?.price || null;
            // Convert decimal odds → American, formatted as a STRING with sign
            // ("+116" / "-148") to match ESPN's prop format the client expects.
            const toAmerican = (dec) => {
              if (!dec || dec <= 1) return "";
              const n = dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
              return n > 0 ? `+${n}` : `${n}`;
            };
            props.push({
              athleteId: playerName.replace(/\s+/g, "_").toLowerCase(),
              athlete: { name: playerName, headshot: "" },
              typeName,
              line: String(line ?? 0),
              overOdds: toAmerican(overOdds),
              underOdds: toAmerican(underOdds),
              source: oddsBook,
            });
          }
        }

        // Attach game lines from this book (override ESPN's pickcenter)
        const bookGameOdds = {};
        if (linesBm) {
          for (const m of (linesBm.markets || [])) {
            if (m.key === "h2h") {
              const awayO = m.outcomes?.find(o => o.name !== homeTeamName);
              const homeO = m.outcomes?.find(o => o.name === homeTeamName || o.name !== awayO?.name);
              const toAm = (dec) => (!dec || dec <= 1) ? null : (dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1)));
              bookGameOdds.awayMoneyLine = toAm(awayO?.price);
              bookGameOdds.homeMoneyLine = toAm(homeO?.price);
            }
            if (m.key === "spreads") {
              const homeS = m.outcomes?.find(o => o.name === homeTeamName);
              if (homeS) bookGameOdds.spread = `${homeTeamName.split(" ").pop()} ${homeS.point > 0 ? "+" : ""}${homeS.point}`;
            }
            if (m.key === "totals") {
              const over = m.outcomes?.find(o => o.name === "Over");
              const under = m.outcomes?.find(o => o.name === "Under");
              const toAm = (dec) => (!dec || dec <= 1) ? null : (dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1)));
              bookGameOdds.overUnder = over?.point ?? null;
              bookGameOdds.overOdds = toAm(over?.price);
              bookGameOdds.underOdds = toAm(under?.price);
            }
          }
        }

        const result = { props, bookGameOdds };
        cacheSet(oddsCacheKey, result);
        return result;
      } catch (e) {
        console.warn("Odds API fetch error:", e.message);
        return { props: [], bookGameOdds: {} };
      }
    }

    // Key stats to surface per sport from the ESPN core statistics endpoint
    const CORE_STATS_KEYS = {
      nba: {
        offensive: ['avgPoints','avgAssists','fieldGoalPct','avgThreePointFieldGoalsMade','freeThrowPct','avgTurnovers'],
        defensive: ['avgDefensiveRebounds','avgBlocks','avgSteals'],
        general:   ['rebounds'],
      },
      nfl: {
        passing:  ['avgPassingYards','passingTouchdowns','interceptions','completionPct'],
        rushing:  ['avgRushingYards','rushingTouchdowns'],
        defensive:['sacks','interceptions','fumblesForced'],
      },
      mlb: {
        batting:  ['avg','homeRuns','rbi','stolenBases','OBP'],
        pitching: ['ERA','WHIP','wins','losses','strikeouts','saves'],
      },
      nhl: {
        scoring:    ['avgGoals','avgAssists','avgPenaltyMinutes'],
        goaltending:['saves','savePercentage','goalsAgainstAverage'],
      },
    };
    const corePath2 = CORE_PATHS[sport]; // e.g. "baseball/leagues/mlb"
    const coreStatsSport = corePath2.split('/')[0]; // e.g. "baseball"
    const coreStatsLeague = corePath2.split('/').pop(); // e.g. "mlb"
    const coreYear = sport === 'mlb' ? (new Date().getFullYear()) : (new Date().getMonth() + 1 >= 10 ? new Date().getFullYear() : new Date().getFullYear() - 1);

    async function fetchTeamRecordStats(teamId) {
      if (!teamId) return [];
      try {
        const { data: td } = await axios.get(
          `${ESPN_CORE_BASE}/${coreStatsSport}/leagues/${coreStatsLeague}/seasons/${coreYear}/types/2/teams/${teamId}/statistics`,
          { timeout: 5000 }
        );
        const wantedKeys = CORE_STATS_KEYS[sport] || {};
        const results = [];
        for (const [catName, statKeys] of Object.entries(wantedKeys)) {
          const cat = (td.splits?.categories || []).find((c) => c.name === catName) || {};
          for (const key of statKeys) {
            const s = (cat.stats || []).find((st) => st.name === key);
            if (s && s.displayValue && s.displayValue !== "--") {
              results.push({
                name: s.name,
                label: s.shortDisplayName || s.abbreviation || s.displayName || s.name,
                displayValue: s.displayValue,
              });
            }
          }
        }
        return results;
      } catch { return []; }
    }

    const needsStatsFallback = competitors.some((c) => (c.statistics || []).length === 0);
    const [homeRoster, awayRoster, rawProps, homeRecordStats, awayRecordStats, oddsApiResult] = await Promise.all([
      fetchRoster(homeTeamId),
      fetchRoster(awayTeamId),
      fetchProps(),
      needsStatsFallback ? fetchTeamRecordStats(homeTeamId) : Promise.resolve([]),
      needsStatsFallback ? fetchTeamRecordStats(awayTeamId) : Promise.resolve([]),
      fetchOddsApiProps().catch(() => ({ props: [], bookGameOdds: {} })),
    ]);
    // If The Odds API returned game lines for the selected book, override ESPN's
    const oddsApiLines = oddsApiResult?.bookGameOdds || {};
    const oddsApiProps = oddsApiResult?.props || [];

    // Merge roster players into athleteMap so props can resolve their names
    // Priority: full roster fetch > summary roster (deduplicate by id)
    const rosterPlayers = [];
    const seenRosterIds = new Set();
    for (const [roster, teamId] of [[homeRoster, homeTeamId], [awayRoster, awayTeamId]]) {
      for (const p of roster) {
        if (!athleteMap[p.id] || !athleteMap[p.id].headshot) {
          athleteMap[p.id] = { name: p.name, headshot: p.headshot || `https://a.espncdn.com/i/headshots/${sport}/players/full/${p.id}.png` };
        }
        if (!seenRosterIds.has(p.id)) {
          seenRosterIds.add(p.id);
          rosterPlayers.push({ id: p.id, name: p.name, position: p.position, teamId });
        }
      }
    }
    // Fall back to summary roster players for anyone not covered by full roster fetch
    for (const p of summaryRosterPlayers) {
      if (!seenRosterIds.has(p.id)) {
        seenRosterIds.add(p.id);
        rosterPlayers.push(p);
      }
    }

    // Merge fallback record stats into teamSeasonStats if competitors[x].statistics was empty
    const recordStatsByTeamId = {
      [homeTeamId]: homeRecordStats,
      [awayTeamId]: awayRecordStats,
    };
    const teamSeasonStats = _rawTeamSeasonStats.map((t) => ({
      ...t,
      stats: t.stats.length > 0 ? t.stats : (recordStatsByTeamId[t.teamId] || []),
    }));

    // Build props map (over/under pairs)
    let playerProps = [];
    try {
      const keyNames = KEY_PROP_NAMES[sport] || [];
      const propsMap = {};
      for (const item of rawProps) {
        const aref = item.athlete?.$ref || "";
        const aid = aref.split("/athletes/")[1]?.split("?")[0] || "";
        const typeId = String(item.type?.id || "");
        const typeName = item.type?.name || "";
        const line = item.odds?.total?.value || "";
        const odds = item.odds?.american?.value || "";
        if (!aid || !line || !odds) continue;
        const isKey = keyNames.length === 0 || keyNames.some((k) => typeName.toLowerCase().includes(k.toLowerCase()));
        if (!isKey) continue;
        const k = `${aid}-${typeId}`;
        if (!propsMap[k]) {
          propsMap[k] = { athleteId: aid, typeName, line, overOdds: odds };
        } else if (!propsMap[k].underOdds) {
          propsMap[k].underOdds = odds;
        }
      }
      playerProps = Object.values(propsMap)
        .filter((p) => athleteMap[p.athleteId])
        .map((p) => ({ ...p, athlete: athleteMap[p.athleteId] }));
    } catch (_) {}

    // Merge Odds API props — these have the correct book-specific lines.
    // They take priority over ESPN props when available.
    if (oddsApiProps.length > 0) {
      // Try to resolve headshots from athleteMap by fuzzy-matching the name
      for (const op of oddsApiProps) {
        if (!op.athlete.headshot) {
          const nameWords = op.athlete.name.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter(Boolean);
          const nameNorm = nameWords.join("");
          const lastNorm = nameWords[nameWords.length - 1] || nameNorm;
          let fallback = null;
          for (const [id, info] of Object.entries(athleteMap)) {
            const infoWords = info.name.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter(Boolean);
            const infoNorm = infoWords.join("");
            const lastToken = info.name.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).pop() || "";
            if (infoNorm === nameNorm || infoNorm.endsWith(nameNorm) || nameNorm.endsWith(infoNorm)) {
              op.athlete = info;
              op.athleteId = id;
              break;
            }
            if (lastNorm && lastToken === lastNorm) {
              if (fallback) { fallback = null; break; }
              fallback = [id, info];
            }
          }
          if (!op.athlete.headshot && fallback) {
            const [id, info] = fallback;
            op.athlete = info;
            op.athleteId = id;
          }
        }
      }
      playerProps = oddsApiProps;
    }

    // Override game lines if The Odds API provided book-specific ones
    const finalGameOdds = (Object.keys(oddsApiLines).length > 0)
      ? { ...gameOdds, ...oddsApiLines, provider: book.charAt(0).toUpperCase() + book.slice(1) }
      : gameOdds;

    // Per-period scores (innings/quarters/periods)
    const mapLinescores = (c) => (c.linescores || []).map((ls) => ({
      value: String(ls.displayValue ?? ls.value ?? "0"),
      hits: ls.hits ?? null,
      errors: ls.errors ?? null,
    }));

    res.json({
      sport,
      eventId,
      status,
      home: { team: mapTeam(home.team || {}), score: home.score || "0", linescores: mapLinescores(home), record: recordSummary(home) },
      away: { team: mapTeam(away.team || {}), score: away.score || "0", linescores: mapLinescores(away), record: recordSummary(away) },
      playerTeams,
      pitcherTeams,
      rosterPlayers,
      teamStats,
      teamSeasonStats,
      series: seriesInfo,
      notes,
      leaders,
      probables,
      gameOdds: finalGameOdds,
      playerProps,
      oddsSource: oddsApiProps.length > 0 ? book : 'espn',
    });
  } catch (e) {
    console.log(`ESPN game summary error [${sport}/${eventId}]:`, e.message);
    res.status(502).json({ error: "Could not fetch game summary" });
  }
});

// In-memory live cache + background pollers. For an active game the server
// polls ESPN in a tight loop and keeps the latest parsed payload hot in memory,
// so client requests return INSTANTLY instead of awaiting a fresh ESPN round-
// trip — making pitch-by-pitch updates feel real-time.
const playsCache = new Map();   // key → { ts, payload }
const livePollers = new Map();  // key → { timer, lastRequested, state }

async function buildPlaysPayload(sport, eventId) {
  const sportPath = SPORT_PATHS[sport];
  const url = `${ESPN_BASE}/${sportPath}/summary`;
  const r = await axios.get(url, {
    params: { event: eventId, _: Date.now() },
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Accept: "application/json",
    },
    httpsAgent: ESPN_LIVE_AGENT,
    timeout: 5000,
  });
    const data = r.data;
    const rawPlays = data.plays || [];
    // Send the full play-by-play so the client can group by inning/quarter
    // dropdowns. Cap at 1000 — covers extreme baseball games (600-800 typical
    // pitch-by-pitch) and any basketball/football/hockey game.
    const plays = rawPlays.slice(-1000).reverse().map(p => ({
      id: String(p.id || p.sequenceNumber || Math.random()),
      text: p.text || p.type?.text || '',
      typeText: p.type?.text || '',
      typeAbbr: p.type?.abbreviation || '',
      period: p.period?.displayValue || '',
      clock: p.clock?.displayValue || '',
      awayScore: p.awayScore ?? 0,
      homeScore: p.homeScore ?? 0,
      scoringPlay: !!p.scoringPlay,
      scoreValue: p.scoreValue || 0,
      teamId: String(p.team?.id || ''),
      coordinate: sport === "mlb"
        ? (p.hitCoordinate || p.coordinate || null)
        : (p.coordinate || p.hitCoordinate || null),
      participants: (p.participants || []).slice(0, 2).map(part => {
        const athleteId = part.athlete?.id;
        const sportSlug = sportPath.split('/')[1];
        const headshot =
          part.athlete?.headshot?.href ||
          (athleteId ? `https://a.espncdn.com/i/headshots/${sportSlug}/players/full/${athleteId}.png` : '');
        return {
          id: String(athleteId || ''),
          name: part.athlete?.displayName || part.athlete?.shortName || '',
          headshot,
          type: part.type || '',
        };
      }),
      // MLB pitch data
      pitchCoordinate: p.pitchCoordinate || null,
      pitchType: p.pitchType ? { text: p.pitchType.text || '', abbr: p.pitchType.abbreviation || '' } : null,
      pitchVelocity: p.pitchVelocity || null,
      atBatId: p.atBatId || null,
      atBatPitchNumber: p.atBatPitchNumber || null,
      bats: p.bats?.abbreviation || p.bats?.type || null,
      // ESPN's `pitchCount` is sometimes the count OBJECT ({balls,strikes}), not
      // a number — only accept a real numeric pitch count, else null.
      pitchCount: (() => {
        for (const c of [p.pitchCount, p.pitcherPitchCount, p.pitcher?.pitchCount, p.count?.pitches]) {
          if (typeof c === 'number') return c;
        }
        return null;
      })(),
      onDeck: (() => {
        const d = p.onDeck || p.nextBatter || p.dueUp?.[0] || null;
        const athlete = d?.athlete || d;
        if (!athlete) return null;
        const id = athlete.id;
        return {
          id: String(id || ''),
          name: athlete.displayName || athlete.shortName || athlete.name || '',
          headshot: athlete.headshot?.href || (id ? `https://a.espncdn.com/i/headshots/mlb/players/full/${id}.png` : ''),
        };
      })(),
      // MLB situational data
      onFirst:  (() => { const r = p.onFirst;  if (!r?.athlete) return null; const id = r.athlete.id; return { id: String(id||''), name: r.athlete.displayName||r.athlete.shortName||'', headshot: r.athlete.headshot?.href||(id?`https://a.espncdn.com/i/headshots/mlb/players/full/${id}.png`:'') }; })(),
      onSecond: (() => { const r = p.onSecond; if (!r?.athlete) return null; const id = r.athlete.id; return { id: String(id||''), name: r.athlete.displayName||r.athlete.shortName||'', headshot: r.athlete.headshot?.href||(id?`https://a.espncdn.com/i/headshots/mlb/players/full/${id}.png`:'') }; })(),
      onThird:  (() => { const r = p.onThird;  if (!r?.athlete) return null; const id = r.athlete.id; return { id: String(id||''), name: r.athlete.displayName||r.athlete.shortName||'', headshot: r.athlete.headshot?.href||(id?`https://a.espncdn.com/i/headshots/mlb/players/full/${id}.png`:'') }; })(),
      outcomeAbbr: p.alternativeType?.abbreviation || null,
      outs: p.outs ?? null,
      trajectory: p.trajectory || null,
      resultCount: p.resultCount ? { balls: p.resultCount.balls ?? 0, strikes: p.resultCount.strikes ?? 0 } : null,
    }));
    const comp = data.header?.competitions?.[0];
    const status = {
      state: comp?.status?.type?.state || 'pre',
      description:
        comp?.status?.type?.shortDetail ||
        comp?.status?.type?.detail ||
        comp?.status?.type?.description ||
        '',
      clock: comp?.status?.displayClock || '',
      period: comp?.status?.period || 0,
    };
    const payload = { sport, eventId, plays, status };
    return payload;
}

// Keep an active game hot in memory: poll ESPN in the background so client
// requests are served instantly from cache (no per-request ESPN round-trip).
function ensureLivePoller(sport, eventId) {
  const key = `${sport}:${eventId}`;
  const existing = livePollers.get(key);
  if (existing) { existing.lastRequested = Date.now(); return; }
  const poller = { timer: null, lastRequested: Date.now(), state: "pre" };
  livePollers.set(key, poller);
  const loop = async () => {
    // Stop polling once no client has asked in 30s.
    if (Date.now() - poller.lastRequested > 30000) { livePollers.delete(key); return; }
    try {
      const payload = await buildPlaysPayload(sport, eventId);
      playsCache.set(key, { ts: Date.now(), payload });
      poller.state = payload.status?.state || "pre";
    } catch (_) {}
    // Tight 250ms loop for live games (ESPN's own refresh rate is the floor);
    // relaxed when the game isn't in progress.
    poller.timer = setTimeout(loop, poller.state === "in" ? 250 : 2000);
  };
  loop();
}

app.get("/sports/:sport/game/:eventId/plays", validateSport, async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  const { sport, eventId } = req.params;
  const cacheKey = `${sport}:${eventId}`;
  ensureLivePoller(sport, eventId);
  const cached = playsCache.get(cacheKey);
  if (cached) return res.json(cached.payload); // INSTANT — served from memory
  // Cold start only: fetch once synchronously, then the poller keeps it fresh.
  try {
    const payload = await buildPlaysPayload(sport, eventId);
    playsCache.set(cacheKey, { ts: Date.now(), payload });
    res.json(payload);
  } catch (e) {
    res.status(502).json({ plays: [], error: "Could not fetch plays" });
  }
});

// GET /sports/:sport/player/:playerId — player bio + season stats
app.get("/sports/:sport/player/:playerId", validateSport, async (req, res) => {
  const { sport, playerId } = req.params;
  const sportPath = SPORT_PATHS[sport];
  const webUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${sportPath}/athletes/${playerId}`;
  try {
    const { data } = await axios.get(webUrl, { timeout: 8000 });
    const a = data.athlete || {};
    const team = a.team || {};
    const stats = (a.statsSummary?.statistics || []).map(s => ({
      abbr: s.abbreviation,
      label: s.shortDisplayName,
      value: s.displayValue,
      rank: s.rankDisplayValue || null,
    }));
    res.json({
      id: String(a.id || playerId),
      name: a.displayName || a.fullName || '',
      firstName: a.firstName || '',
      lastName: a.lastName || '',
      headshot: a.headshot?.href || `https://a.espncdn.com/i/headshots/${sportPath.split('/')[1]}/players/full/${playerId}.png`,
      jersey: a.displayJersey || a.jersey || null,
      position: a.position?.displayName || null,
      height: a.displayHeight || null,
      weight: a.displayWeight || null,
      age: a.age || null,
      dob: a.displayDOB || null,
      birthplace: a.displayBirthPlace || null,
      college: a.college?.name || null,
      draft: a.displayDraft || null,
      experience: a.displayExperience || null,
      debutYear: a.debutYear || null,
      status: a.status?.name || null,
      team: {
        id: String(team.id || ''),
        name: team.displayName || team.name || '',
        abbreviation: team.abbreviation || '',
        logo: team.logos?.[0]?.href || null,
        color: team.color || null,
      },
      statsSummary: {
        label: a.statsSummary?.displayName || '',
        stats,
      },
    });
  } catch (e) {
    console.error('Player bio error:', e.message);
    res.status(502).json({ error: 'Could not load player data' });
  }
});

// GET /sports/:sport/player/:playerId/gamelog
app.get("/sports/:sport/player/:playerId/gamelog", validateSport, async (req, res) => {
  const { sport, playerId } = req.params;
  const sportPath = SPORT_PATHS[sport];
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/${sportPath}/athletes/${playerId}/gamelog`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const labels = data.labels || [];
    const eventsMap = data.events || {};
    const games = [];
    for (const st of (data.seasonTypes || [])) {
      for (const cat of (st.categories || [])) {
        for (const ev of (cat.events || [])) {
          const detail = eventsMap[ev.eventId] || {};
          const rawDate = detail.gameDate || '';
          // Format date to "Apr 14"
          let dateStr = '';
          if (rawDate) {
            const d = new Date(rawDate);
            dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }
          games.push({
            id: ev.eventId,
            date: dateStr,
            opponent: detail.opponent?.abbreviation || '',
            atVs: detail.atVs || '',
            result: detail.gameResult || '',
            score: detail.score || '',
            stats: Object.fromEntries(labels.map((l, i) => [l, ev.stats?.[i] ?? '--'])),
          });
        }
      }
    }
    res.json({ labels, games });
  } catch (e) {
    console.error('Gamelog error:', e.message);
    res.status(502).json({ error: 'Could not load gamelog' });
  }
});

// GET /sports/:sport/player/:playerId/career
app.get("/sports/:sport/player/:playerId/career", validateSport, async (req, res) => {
  const { sport, playerId } = req.params;
  const sportPath = SPORT_PATHS[sport];
  try {
    // The /stats endpoint returns EVERY season of the player's career (from
    // their rookie year), not just a recent window — so the career table goes
    // all the way back to the debut season.
    const { data } = await axios.get(
      `https://site.web.api.espn.com/apis/common/v3/sports/${sportPath}/athletes/${playerId}/stats`,
      { timeout: 8000 }
    );
    const cats = data.categories || [];
    // Pick the player's PRIMARY category (skip postseason / opponent / expanded
    // / advanced splits). First remaining category with season rows wins.
    const skip = /postseason|opponent|expanded|advanced|misc|defensive/i;
    const primary =
      cats.find(c => !skip.test(c.name || '') && (c.statistics || []).length) ||
      cats.find(c => (c.statistics || []).length);
    if (!primary) return res.json({ labels: [], seasons: [] });

    const labels = primary.labels || [];
    // One row per season, newest first. ESPN gives season.displayName like
    // "2014" (MLB) or "2014-15" (NBA/NHL).
    const seasons = (primary.statistics || [])
      .filter(st => st.season && (st.stats || []).length)
      .map(st => ({
        year: Number(st.season.year) || 0,
        displayYear: st.season.displayName || String(st.season.year || ''),
        stats: Object.fromEntries(labels.map((l, i) => [l, st.stats?.[i] ?? '--'])),
      }))
      .sort((a, b) => b.year - a.year);

    res.json({ labels, seasons });
  } catch (e) {
    console.error('Career error:', e.message);
    res.status(502).json({ error: 'Could not load career stats' });
  }
});

// GET /sports/:sport/player/:playerId/splits — ESPN-style split rows
// (Last 7 days, Home, Away, by month, etc.) for the player page SPLITS table.
app.get("/sports/:sport/player/:playerId/splits", validateSport, async (req, res) => {
  const { sport, playerId } = req.params;
  const sportPath = SPORT_PATHS[sport];
  const season = (req.query.season || new Date().getFullYear()).toString();
  try {
    const { data } = await axios.get(
      `https://site.web.api.espn.com/apis/common/v3/sports/${sportPath}/athletes/${playerId}/splits`,
      { params: { season, seasontype: 2 }, timeout: 7000 }
    );
    const labels = data.labels || [];
    // Curated row order ESPN shows on the player page, pulled across categories.
    // Only rows that share the player's primary stat label set. (vs. Left/Right
    // for pitchers use opponent-batting stats with a different shape, so they're
    // excluded to avoid misaligned values.)
    // All months so every sport's season is covered (MLB Mar–Oct, NBA/NHL
    // Oct–Apr, NFL Sep–Jan). Home/Away apply to every sport; Day/Night are
    // baseball-only and simply won't be present for others.
    const wanted = [
      'Last 7 Days', 'Last 15 Days', 'Last 30 Days',
      'Home', 'Away', 'Road', 'Day', 'Night',
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const byName = {};
    for (const cat of (data.splitCategories || [])) {
      for (const sp of (cat.splits || [])) {
        const name = sp.displayName;
        if (!name || byName[name]) continue;
        if ((sp.stats || []).every(v => v === '0' || v === '--' || v === '')) continue;
        byName[name] = Object.fromEntries(labels.map((l, i) => [l, sp.stats?.[i] ?? '--']));
      }
    }
    // ESPN labels the road split "Road" for some sports — normalize to "Away".
    if (byName['Road'] && !byName['Away']) { byName['Away'] = byName['Road']; }
    delete byName['Road'];
    const rows = wanted
      .filter(n => n !== 'Road' && byName[n])
      .map(n => ({ name: n.replace('Last 7 Days', 'Last seven days'), stats: byName[n] }));
    res.json({ labels, rows });
  } catch (e) {
    res.status(502).json({ error: 'Could not load splits', labels: [], rows: [] });
  }
});

// GET /sports/:sport/teams — list all teams
app.get("/sports/:sport/teams", validateSport, async (req, res) => {
  const { sport } = req.params;
  const sportPath = SPORT_PATHS[sport];
  try {
    const r = await axios.get(`${ESPN_BASE}/${sportPath}/teams?limit=50`);
    const teams = (r.data?.sports?.[0]?.leagues?.[0]?.teams || []).map(({ team: t }) => mapTeam(t));
    res.json({ sport, teams });
  } catch (e) {
    res.status(502).json({ teams: [], error: "Could not fetch teams" });
  }
});

// GET /sports/:sport/teams/:teamId/profile
// Bundles everything the team-profile screen needs into one round-trip:
//   • Team identity (name, abbreviation, logo, colors, venue, division)
//   • Current record (wins / losses / win-pct / standing summary)
//   • Roster (active players with headshot, position, jersey)
// We use Promise.allSettled so a failure in any one source still returns
// a usable response — the screen handles missing fields gracefully.
app.get("/sports/:sport/teams/:teamId/profile", validateSport, async (req, res) => {
  const { sport, teamId } = req.params;
  const sportPath = SPORT_PATHS[sport];
  try {
    const [teamRes, rosterRes] = await Promise.allSettled([
      axios.get(`${ESPN_BASE}/${sportPath}/teams/${teamId}`, { timeout: 8000 }),
      axios.get(`${ESPN_BASE}/${sportPath}/teams/${teamId}/roster`, { timeout: 8000 }),
    ]);

    // Team info (always required; if it failed we can't render the screen)
    if (teamRes.status !== "fulfilled") {
      return res.status(502).json({ error: "Could not fetch team" });
    }
    const t = teamRes.value.data.team || {};
    const record = t.record?.items?.[0] || {};
    const stats = record.stats || [];
    const getStat = (name) => stats.find((s) => s.name === name)?.value;

    const team = {
      id: String(t.id || teamId),
      displayName: t.displayName || "",
      shortName: t.shortDisplayName || t.name || "",
      nickname: t.nickname || "",
      abbreviation: t.abbreviation || "",
      location: t.location || "",
      logo: t.logos?.[0]?.href || "",
      logoDark: t.logos?.find((l) => l.rel?.includes("dark"))?.href || "",
      color: t.color || "888888",
      altColor: t.alternateColor || "ffffff",
      venue: t.franchise?.venue?.fullName || t.venue?.fullName || "",
      conference: t.groups?.parent?.name || "",
      division: t.groups?.name || "",
      record: {
        summary: record.summary || "",
        wins: Number(getStat("wins") ?? 0),
        losses: Number(getStat("losses") ?? 0),
        ties: Number(getStat("ties") ?? 0),
        winPct: Number(getStat("winPercent") ?? 0),
        gamesBack: Number(getStat("gamesBehind") ?? 0),
      },
      standingSummary: t.standingSummary || "",
    };

    // Roster — flatten ESPN's per-position groupings into one array
    let players = [];
    if (rosterRes.status === "fulfilled") {
      const groups = rosterRes.value.data.athletes || [];
      // MLB/NHL group by position ("pitchers", "catchers", etc); NBA/NFL
      // return a flat list. Handle both shapes.
      const flat = Array.isArray(groups[0]?.items) ? groups.flatMap((g) => g.items) : groups;
      players = flat.filter(Boolean).map((p) => ({
        id: String(p.id || ""),
        firstName: p.firstName || "",
        lastName: p.lastName || "",
        fullName: p.fullName || p.displayName || "",
        jersey: p.jersey || "",
        position: p.position?.abbreviation || p.position?.name || "",
        headshot: p.headshot?.href || "",
        age: p.age || null,
        height: p.displayHeight || "",
        weight: p.displayWeight || "",
        experience: p.experience?.displayValue || p.experience?.years || "",
        college: p.college?.name || "",
        injuryStatus: p.injuries?.[0]?.status || "",
      }));
    }

    res.json({ team, players, sport });
  } catch (e) {
    console.log(`Team profile error [${sport}/${teamId}]:`, e.message);
    res.status(502).json({ error: "Could not fetch team profile" });
  }
});

// GET /sports/:sport/teams/:teamId/schedule
app.get("/sports/:sport/teams/:teamId/schedule", validateSport, async (req, res) => {
  const { sport, teamId } = req.params;
  const sportPath = SPORT_PATHS[sport];
  const url = `${ESPN_BASE}/${sportPath}/teams/${teamId}/schedule`;
  try {
    const r = await axios.get(url);
    const teamData = r.data.team || {};
    const events = (r.data.events || []).map((e) => {
      const comp = e.competitions?.[0] || {};
      const comps = comp.competitors || [];
      const homeC = comps.find((c) => c.homeAway === "home") || {};
      const awayC = comps.find((c) => c.homeAway === "away") || {};
      const isHome = String(homeC.team?.id) === String(teamId);
      const opponent = isHome ? awayC.team : homeC.team;
      const myScore = isHome ? (homeC.score?.displayValue ?? homeC.score ?? "") : (awayC.score?.displayValue ?? awayC.score ?? "");
      const oppScore = isHome ? (awayC.score?.displayValue ?? awayC.score ?? "") : (homeC.score?.displayValue ?? homeC.score ?? "");
      const completed = comp.status?.type?.completed ?? false;
      let result = null;
      if (completed && myScore !== "" && oppScore !== "") {
        result = Number(myScore) > Number(oppScore) ? "W" : "L";
      }
      return {
        id: e.id,
        date: e.date,
        state: comp.status?.type?.state || "pre",
        detail: comp.status?.type?.shortDetail || comp.status?.type?.detail || "",
        isHome,
        opponent: opponent ? mapTeam(opponent) : null,
        myScore,
        oppScore,
        result,
      };
    });
    res.json({
      team: { id: String(teamData.id || teamId), displayName: teamData.displayName || "", abbreviation: teamData.abbreviation || "", logo: teamData.logos?.[0]?.href || "", color: teamData.color || "888888" },
      games: events,
      sport,
    });
  } catch (e) {
    console.log(`ESPN team schedule error [${sport}/${teamId}]:`, e.message);
    res.status(502).json({ error: "Could not fetch team schedule" });
  }
});

// ---------------------------------------------------------------------------
// Yahoo Fantasy OAuth (PKCE, Public Client)
// ---------------------------------------------------------------------------

const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID || "dj0yJmk9R1NXbmtaUGJ5STQxJmQ9WVdrOVlVZHlUVGxaZWpFbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTY5";
// Redirect URI must be HTTPS and registered with Yahoo. In production set
// YAHOO_REDIRECT_URI to your deployed Railway URL (e.g.
// https://ejjs-production.up.railway.app/yahoo/callback). The self-signed
// localhost default triggers the "connection not private" warning in the
// browser — fine for solo dev (click "show details → visit this website"
// once) but unusable for testers.
const YAHOO_REDIRECT_URI = process.env.YAHOO_REDIRECT_URI || "https://localhost:3443/yahoo/callback";
const YAHOO_AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const YAHOO_API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";

// In-memory token store (single user)
let yahooToken = null;
let pkceVerifier = null;

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// GET /yahoo/auth — mobile calls this to get the auth URL
app.get("/yahoo/auth", (req, res) => {
  pkceVerifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(pkceVerifier).digest());
  const state = base64url(crypto.randomBytes(16));
  const params = new URLSearchParams({
    client_id: YAHOO_CLIENT_ID,
    redirect_uri: YAHOO_REDIRECT_URI,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  res.json({ url: `${YAHOO_AUTH_URL}?${params}` });
});

// GET /yahoo/callback — Yahoo redirects here with ?code=
app.get("/yahoo/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code");
  try {
    const body = new URLSearchParams({
      client_id: YAHOO_CLIENT_ID,
      redirect_uri: YAHOO_REDIRECT_URI,
      code,
      grant_type: "authorization_code",
      code_verifier: pkceVerifier,
    });
    const { data } = await axios.post(YAHOO_TOKEN_URL, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    yahooToken = { ...data, expires_at: Date.now() + data.expires_in * 1000 };
    // Close the browser tab — redirect to a self-closing page
    res.send(`<html><body><h2>Connected to Yahoo Fantasy!</h2><script>setTimeout(()=>window.close(),1500);</script></body></html>`);
  } catch (e) {
    console.error("Yahoo token exchange error:", e.response?.data || e.message);
    res.status(502).send("Token exchange failed");
  }
});

async function refreshYahooIfNeeded() {
  if (!yahooToken) throw new Error("Not authenticated with Yahoo");
  if (Date.now() < yahooToken.expires_at - 30000) return;
  const body = new URLSearchParams({
    client_id: YAHOO_CLIENT_ID,
    redirect_uri: YAHOO_REDIRECT_URI,
    refresh_token: yahooToken.refresh_token,
    grant_type: "refresh_token",
  });
  const { data } = await axios.post(YAHOO_TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  yahooToken = { ...data, expires_at: Date.now() + data.expires_in * 1000 };
}

async function yahooGet(path) {
  await refreshYahooIfNeeded();
  const { data } = await axios.get(`${YAHOO_API_BASE}${path}?format=json`, {
    headers: { Authorization: `Bearer ${yahooToken.access_token}` },
  });
  return data;
}

// GET /yahoo/status — is the user connected?
app.get("/yahoo/status", (req, res) => {
  res.json({ connected: !!yahooToken });
});

// GET /yahoo/leagues — list all fantasy leagues for current user
app.get("/yahoo/leagues", async (req, res) => {
  try {
    const data = await yahooGet("/users;use_login=1/games;game_codes=nfl,nba,mlb,nhl/leagues");
    const users = data?.fantasy_content?.users;
    const user = users?.["0"]?.user;
    const gamesRaw = user?.[1]?.games;
    const leagues = [];
    if (gamesRaw) {
      const count = gamesRaw.count;
      for (let gi = 0; gi < count; gi++) {
        const game = gamesRaw[String(gi)]?.game;
        if (!game) continue;
        const gameMeta = game[0];
        const leaguesRaw = game[1]?.leagues;
        if (!leaguesRaw) continue;
        const lcount = leaguesRaw.count;
        for (let li = 0; li < lcount; li++) {
          const l = leaguesRaw[String(li)]?.league?.[0];
          if (!l) continue;
          leagues.push({
            league_key: l.league_key,
            league_id: l.league_id,
            name: l.name,
            sport: gameMeta.code,
            season: gameMeta.season,
            num_teams: l.num_teams,
            logo_url: l.logo_url || null,
          });
        }
      }
    }
    res.json({ leagues });
  } catch (e) {
    console.error("Yahoo leagues error:", e.response?.data || e.message);
    res.status(e.message === "Not authenticated with Yahoo" ? 401 : 502).json({ error: e.message });
  }
});

// GET /yahoo/roster/:leagueKey — get my team's roster for a league
app.get("/yahoo/roster/:leagueKey", async (req, res) => {
  try {
    const { leagueKey } = req.params;
    // leagueKey format: 423.l.12345 — derive team key via /teams
    const teamsData = await yahooGet(`/leagues/${leagueKey}/teams`);
    const teamsRaw = teamsData?.fantasy_content?.league?.[1]?.teams;
    const currentUserGuid = yahooToken?.xoauth_yahoo_guid;
    let myTeamKey = null;
    if (teamsRaw) {
      const count = teamsRaw.count;
      for (let i = 0; i < count; i++) {
        const team = teamsRaw[String(i)]?.team?.[0];
        if (!team) continue;
        const managers = team.find?.((t) => t?.managers)?.managers;
        if (managers) {
          const mgr = managers[0]?.manager;
          if (mgr?.is_current_login === "1") {
            myTeamKey = team[0]?.team_key;
            break;
          }
        }
      }
    }
    if (!myTeamKey) return res.status(404).json({ error: "Your team not found in this league" });

    const rosterData = await yahooGet(`/teams/${myTeamKey}/roster/players`);
    const playersRaw = rosterData?.fantasy_content?.team?.[1]?.roster?.["0"]?.players;
    const players = [];
    if (playersRaw) {
      const count = playersRaw.count;
      for (let i = 0; i < count; i++) {
        const p = playersRaw[String(i)]?.player;
        if (!p) continue;
        const meta = p[0];
        const info = Array.isArray(meta) ? meta : [];
        const name = info.find((x) => x?.name)?.name;
        const pos = info.find((x) => x?.selected_position)?.selected_position?.position;
        const eligPos = info.find((x) => x?.eligible_positions)?.eligible_positions;
        const img = info.find((x) => x?.image_url)?.image_url;
        const teamName = info.find((x) => x?.editorial_team_abbr)?.editorial_team_abbr;
        players.push({
          player_key: info.find((x) => x?.player_key)?.player_key,
          name: name ? `${name.first} ${name.last}` : "Unknown",
          position: pos || (Array.isArray(eligPos) ? eligPos[0]?.position : null),
          team: teamName || "",
          image: img || null,
        });
      }
    }
    res.json({ team_key: myTeamKey, players });
  } catch (e) {
    console.error("Yahoo roster error:", e.response?.data || e.message);
    res.status(e.message === "Not authenticated with Yahoo" ? 401 : 502).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Bets / Parlay tracker endpoints
// ---------------------------------------------------------------------------

app.use(express.json());

const BETS_FILE = migrateLegacyFile('bets.json');

function loadBetsFile() {
  try {
    const raw = fs.readFileSync(BETS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveBetsFile(parlays) {
  try {
    fs.writeFileSync(BETS_FILE, JSON.stringify(parlays, null, 2));
  } catch (e) {
    console.warn('Could not save bets:', e.message);
  }
}

function toDecimal(americanOdds) {
  const o = Number(americanOdds);
  if (isNaN(o)) return 1;
  return o > 0 ? o / 100 + 1 : 100 / Math.abs(o) + 1;
}

function calcCombinedOdds(legs) {
  if (!legs || legs.length === 0) return 0;
  const totalDecimal = legs.reduce((acc, leg) => acc * toDecimal(leg.odds), 1);
  const american = totalDecimal >= 2
    ? Math.round((totalDecimal - 1) * 100)
    : Math.round(-100 / (totalDecimal - 1));
  return american;
}

function calcPotentialPayout(legs, stake) {
  if (!legs || legs.length === 0) return 0;
  const totalDecimal = legs.reduce((acc, leg) => acc * toDecimal(leg.odds), 1);
  return Math.round(stake * totalDecimal * 100) / 100;
}

// GET /bets
app.get('/bets', (req, res) => {
  res.json({ parlays: loadBetsFile() });
});

// POST /bets
app.post('/bets', (req, res) => {
  const { name, legs, stake } = req.body || {};
  if (!legs || !Array.isArray(legs) || legs.length === 0) {
    return res.status(400).json({ error: 'legs array required' });
  }
  const parlays = loadBetsFile();
  const combinedOdds = calcCombinedOdds(legs);
  const potentialPayout = calcPotentialPayout(legs, stake ?? 0);
  const parlay = {
    id: crypto.randomUUID(),
    name: name || `Parlay - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    legs: legs.map(l => ({ ...l, id: l.id || crypto.randomUUID(), status: l.status || 'pending' })),
    stake: stake ?? 0,
    combinedOdds,
    potentialPayout,
    status: 'active',
    createdAt: Date.now(),
  };
  parlays.push(parlay);
  saveBetsFile(parlays);
  res.status(201).json({ parlay });
});

// PUT /bets/:id
app.put('/bets/:id', (req, res) => {
  const { id } = req.params;
  let parlays = loadBetsFile();
  const idx = parlays.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Parlay not found' });
  const updates = req.body || {};
  if (updates.legs) {
    updates.combinedOdds = calcCombinedOdds(updates.legs);
    updates.potentialPayout = calcPotentialPayout(updates.legs, updates.stake ?? parlays[idx].stake);
  }
  parlays[idx] = { ...parlays[idx], ...updates };
  saveBetsFile(parlays);
  res.json({ parlay: parlays[idx] });
});

// DELETE /bets/:id
app.delete('/bets/:id', (req, res) => {
  const { id } = req.params;
  let parlays = loadBetsFile();
  const before = parlays.length;
  parlays = parlays.filter(p => p.id !== id);
  if (parlays.length === before) return res.status(404).json({ error: 'Parlay not found' });
  saveBetsFile(parlays);
  res.json({ ok: true });
});

// POST /bets/:id/settle
app.post('/bets/:id/settle', (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!['won', 'lost', 'push'].includes(status)) {
    return res.status(400).json({ error: 'status must be won, lost, or push' });
  }
  let parlays = loadBetsFile();
  const idx = parlays.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Parlay not found' });
  parlays[idx].status = status;
  saveBetsFile(parlays);
  res.json({ parlay: parlays[idx] });
});

// ---------------------------------------------------------------------------
// ESPN Fantasy proxy (cookie-based auth)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ESPN Fantasy — persistent storage (survives server restarts)
// ---------------------------------------------------------------------------

const ESPN_DATA_FILE = migrateLegacyFile("espn_data.json");

function loadEspnData() {
  try {
    const raw = fs.readFileSync(ESPN_DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { cookies: null, leagues: [] };
  }
}

function saveEspnData(cookies, leagues) {
  try {
    fs.writeFileSync(ESPN_DATA_FILE, JSON.stringify({ cookies, leagues }, null, 2));
  } catch (e) {
    console.warn("Could not save ESPN data:", e.message);
  }
}

const _espnData = loadEspnData();
let espnCookies = _espnData.cookies || null;
let espnSavedLeagues = _espnData.leagues || [];

const ESPN_HEADERS = (cookies) => ({
  Cookie: `espn_s2=${cookies.espn_s2}; SWID=${cookies.swid}`,
  "x-fantasy-source": "kona",
  "x-fantasy-platform": "kona-PROD-m.fantasy.espn.com",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
});

function getFantasySeason(ep) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  // MLB season starts in March — use current year
  if (ep === 'flb') return month >= 3 ? year : year - 1;
  // NFL season starts in September — use prior year Jan-Jul
  if (ep === 'ffl') return month >= 8 ? year : year - 1;
  // NBA/NHL seasons start in October — use prior year Jan-Sep
  return month >= 10 ? year : year - 1;
}

// Auto-discover ALL of a user's ESPN fantasy leagues from their SWID via the
// "fan" API — so the user never has to paste league IDs. Returns the same
// shape we store in espnSavedLeagues: { leagueId, sport, name, numTeams, season }.
// ESPN identifies the sport two ways: legacy string slugs (ffl/fba/flb/fhl) AND
// the newer fan API v2 numeric gameIds (1=NFL, 2=MLB, 3=NBA, 4=NHL). Map both.
const ESPN_GAME_TO_SPORT = {
  ffl: 'nfl', fba: 'nba', flb: 'mlb', fhl: 'nhl',
  '1': 'nfl', '2': 'mlb', '3': 'nba', '4': 'nhl',
};
async function fetchEspnUserLeagues(cookies) {
  if (!cookies?.swid) return [];
  // SWID must keep its braces and be URL-encoded for the fan API path.
  const swid = cookies.swid.startsWith('{') ? cookies.swid : `{${cookies.swid}}`;
  const url = `https://fan.api.espn.com/apis/v2/fans/${encodeURIComponent(swid)}?context=fantasy&useCookieAuth=true&displayHiddenPrefs=true&featureFlags=expandAthlete`;
  const { data } = await axios.get(url, { headers: ESPN_HEADERS(cookies), timeout: 10000 });
  const prefs = data?.preferences || [];
  const out = [];
  const seen = new Set();
  for (const p of prefs) {
    const entry = p?.metaData?.entry;
    if (!entry) continue;
    // Sport: gameId can be a slug ("ffl") or sometimes nested under abbrev.
    const rawGame = String(entry.gameId || entry.abbrev || '').toLowerCase();
    const sport = ESPN_GAME_TO_SPORT[rawGame];
    if (!sport) continue;
    // League id + name live under groups[0] (the league the team belongs to).
    const group = (entry.groups && entry.groups[0]) || {};
    const leagueId = String(group.groupId || entry.leagueId || '');
    if (!leagueId) continue;
    const key = `${sport}:${leagueId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      leagueId,
      sport,
      name: group.groupName || entry.name || `League ${leagueId}`,
      numTeams: entry.size || null,
      season: entry.seasonId || getFantasySeason(rawGame),
    });
  }
  return out;
}

async function espnLeagueGet(ep, leagueId, params, cookies, season) {
  const seasonYear = season || getFantasySeason(ep);
  // ESPN expects repeated params for arrays: ?view=mRoster&view=mTeam
  // Axios serializes arrays as view[0]=X by default — we must build the query string manually.
  const queryString = params
    ? Object.entries(params)
        .flatMap(([k, v]) => (Array.isArray(v) ? v.map((i) => `${k}=${encodeURIComponent(i)}`) : [`${k}=${encodeURIComponent(v)}`]))
        .join('&')
    : '';
  // Try lm-api-reads first — it works for both public leagues (no cookies) and private (with cookies).
  // fantasy.espn.com redirects to an HTML login page without cookies, breaking the JSON check.
  const baseUrls = [
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${ep}/seasons/${seasonYear}/segments/0/leagues/${leagueId}`,
    `https://fantasy.espn.com/apis/v3/games/${ep}/seasons/${seasonYear}/segments/0/leagues/${leagueId}`,
  ];
  const urls = queryString ? baseUrls.map(u => `${u}?${queryString}`) : baseUrls;
  let lastErr;
  for (const url of urls) {
    try {
      const { data } = await axios.get(url, {
        headers: cookies ? ESPN_HEADERS(cookies) : {},
        maxRedirects: 0, // Don't follow redirects — a redirect means auth failure
      });
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        lastErr = new Error('ESPN returned unexpected response');
        continue; // Try next URL
      }
      return data;
    } catch (e) {
      lastErr = e;
      // A real 401/403 from ESPN means cookies are invalid — stop immediately
      if (e.response?.status === 401 || e.response?.status === 403) throw e;
      // Redirect (302) or other errors — try next URL
    }
  }
  throw lastErr || new Error('ESPN league not found');
}

// POST /espn/fantasy/connect
app.post("/espn/fantasy/connect", async (req, res) => {
  const { espn_s2, swid } = req.body || {};
  if (!espn_s2 || !swid) return res.status(400).json({ error: "espn_s2 and swid required" });
  espnCookies = { espn_s2, swid };
  // Auto-discover the user's leagues from their SWID so they don't have to
  // paste league IDs. Merge with any already-saved leagues (dedup by id+sport).
  let discovered = [];
  try {
    discovered = await fetchEspnUserLeagues(espnCookies);
  } catch (e) {
    console.warn("ESPN auto-league discovery failed:", e.response?.status || e.message);
  }
  if (discovered.length) {
    const merged = [...espnSavedLeagues];
    for (const lg of discovered) {
      if (!merged.some(l => l.leagueId === lg.leagueId && l.sport === lg.sport)) merged.push(lg);
    }
    espnSavedLeagues = merged;
  }
  saveEspnData(espnCookies, espnSavedLeagues);
  res.json({ connected: true, leaguesFound: discovered.length });
});

// POST /espn/fantasy/refresh-leagues — re-run auto-discovery on demand.
app.post("/espn/fantasy/refresh-leagues", async (req, res) => {
  if (!espnCookies) return res.status(401).json({ error: "Not connected" });
  try {
    const discovered = await fetchEspnUserLeagues(espnCookies);
    const merged = [...espnSavedLeagues];
    for (const lg of discovered) {
      if (!merged.some(l => l.leagueId === lg.leagueId && l.sport === lg.sport)) merged.push(lg);
    }
    espnSavedLeagues = merged;
    saveEspnData(espnCookies, espnSavedLeagues);
    res.json({ leagues: espnSavedLeagues, found: discovered.length });
  } catch (e) {
    res.status(502).json({ error: "Could not auto-discover leagues" });
  }
});

app.get("/espn/fantasy/status", (req, res) => {
  res.json({ connected: !!espnCookies });
});

// POST /espn/fantasy/add-league
app.post("/espn/fantasy/add-league", async (req, res) => {
  // Cookies are optional — public leagues work without them
  const { leagueId, sport = "nfl" } = req.body || {};
  if (!leagueId) return res.status(400).json({ error: "leagueId required" });
  const sportEndpoints = { nfl: "ffl", nba: "fba", mlb: "flb", nhl: "fhl" };
  const ep = sportEndpoints[sport];
  if (!ep) return res.status(400).json({ error: "Unknown sport" });
  try {
    const data = await espnLeagueGet(ep, leagueId, { view: ["mSettings", "mTeam"] }, espnCookies);
    console.log("ESPN league data keys:", Object.keys(data).slice(0, 20));
    console.log("ESPN settings:", JSON.stringify(data.settings || data.settingsGroup || {}).slice(0, 300));
    // ESPN can nest the name in several places depending on API version
    const name =
      data.settings?.name ||
      data.settings?.rosterSettings?.name ||
      data.settingsGroup?.name ||
      data.name ||
      (data.teams && data.teams[0] ? undefined : undefined) ||
      `League ${leagueId}`;
    const numTeams = data.settings?.size || data.size || null;
    const season = data.seasonId || data.settings?.seasonId || 2025;
    const league = { leagueId: String(leagueId), sport, name, numTeams, season };
    espnSavedLeagues = espnSavedLeagues.filter(l => !(l.leagueId === String(leagueId) && l.sport === sport));
    espnSavedLeagues.push(league);
    saveEspnData(espnCookies, espnSavedLeagues);
    res.json({ league });
  } catch (e) {
    const status = e.response?.status;
    const msg = e.response?.data?.messages?.[0] || e.message;
    console.error("ESPN add-league error:", status, msg);
    if (e.espnExpired || status === 401 || status === 403) {
      // Clear stored cookies so status endpoint correctly shows disconnected
      espnCookies = null;
      saveEspnData(null, espnSavedLeagues);
      return res.status(401).json({ error: "ESPN session expired — re-enter your espn_s2 and SWID cookies" });
    }
    if (status === 404) return res.status(404).json({ error: "League not found — double-check the ID and sport" });
    res.status(502).json({ error: `ESPN error: ${msg}` });
  }
});

// GET /espn/fantasy/leagues
app.get("/espn/fantasy/leagues", (req, res) => {
  if (!espnCookies) return res.status(401).json({ error: "Not connected" });
  res.json({ leagues: espnSavedLeagues });
});

// DELETE /espn/fantasy/leagues/:leagueId
app.delete("/espn/fantasy/leagues/:leagueId", (req, res) => {
  const { leagueId } = req.params;
  const { sport } = req.query;
  espnSavedLeagues = espnSavedLeagues.filter(
    l => !(l.leagueId === leagueId && (!sport || l.sport === sport))
  );
  saveEspnData(espnCookies, espnSavedLeagues);
  res.json({ ok: true });
});

// Position ID → abbreviation maps per sport
const FANTASY_POSITIONS = {
  nfl: { 1:"QB",2:"RB",3:"WR",4:"TE",5:"K",6:"P",7:"HC",8:"DE",9:"DT",10:"LB",11:"CB",12:"S",13:"DL",14:"LB",15:"DB",16:"D/ST" },
  nba: { 1:"PG",2:"SG",3:"SF",4:"PF",5:"C",6:"PG/SG",7:"SF/PF" },
  mlb: { 1:"SP",2:"C",3:"1B",4:"2B",5:"3B",6:"SS",7:"LF",8:"CF",9:"RF",10:"DH",11:"RP",12:"UT" },
  nhl: { 1:"C",2:"LW",3:"RW",4:"D",5:"G",6:"UTIL" },
};

// GET /espn/fantasy/:sport/:leagueId/roster
app.get("/espn/fantasy/:sport/:leagueId/roster", async (req, res) => {
  const { sport, leagueId } = req.params;
  const sportEndpoints = { nfl: "ffl", nba: "fba", mlb: "flb", nhl: "fhl" };
  const ep = sportEndpoints[sport];
  if (!ep) return res.status(400).json({ error: "Unknown sport" });
  try {
    const savedLeague = espnSavedLeagues.find(l => l.leagueId === leagueId && l.sport === sport);
    const season = savedLeague?.season || undefined;
    const today = new Date().toISOString().slice(0, 10);
    const [leagueData, teamsResp, scoreboardResp] = await Promise.all([
      // mMatchupScore brings in head-to-head totalPoints + pointsByScoringPeriod
      espnLeagueGet(ep, leagueId, { view: ["mRoster", "mTeam", "mMatchupScore", "mScoreboard"] }, espnCookies, season),
      axios.get(`${ESPN_BASE}/${SPORT_PATHS[sport]}/teams?limit=50`).catch(() => ({ data: {} })),
      axios.get(`${ESPN_BASE}/${SPORT_PATHS[sport]}/scoreboard?dates=${today.replace(/-/g, "")}`).catch(() => ({ data: {} })),
    ]);

    // Build proTeamId → abbreviation from the ESPN sports teams endpoint
    const teamAbbrevMap = {};
    for (const { team: t } of (teamsResp.data?.sports?.[0]?.leagues?.[0]?.teams || [])) {
      teamAbbrevMap[String(t.id)] = t.abbreviation || "";
    }

    // Build set of pro-team IDs that are CURRENTLY in a live game today —
    // used to show whether each rostered player's real team is on the field
    // right now (so the UI can color "0.0" white when they're playing).
    const liveProTeamIds = new Set();
    for (const ev of (scoreboardResp.data?.events || [])) {
      const state = ev.status?.type?.state;
      if (state !== "in") continue;
      for (const c of (ev.competitions?.[0]?.competitors || [])) {
        if (c.team?.id) liveProTeamIds.add(String(c.team.id));
      }
    }

    const posMap = FANTASY_POSITIONS[sport] || {};
    const sportHeadshot = { nfl:"nfl", nba:"nba", mlb:"mlb", nhl:"nhl" }[sport] || sport;

    // Find the current user's team — match by SWID, fall back to first team
    const teams = leagueData.teams || [];
    if (!teams.length) return res.json({ players: [] });
    const members = leagueData.members || [];
    const swidClean = espnCookies ? espnCookies.swid.replace(/[{}]/g, "") : "";
    const myMember = swidClean ? members.find((m) => m.id?.replace(/[{}]/g, "") === swidClean) : null;
    const myTeam =
      (myMember ? teams.find((t) => t.owners?.some((o) => o?.replace(/[{}]/g, "") === swidClean)) : null) ||
      teams[0];
    if (!myTeam) return res.status(404).json({ error: "Your team not found" });

    // Sort entries by lineupSlotId so the order matches the fantasy app
    // (starters first, bench at end — ESPN's own ordering)
    const sortedEntries = [...(myTeam.roster?.entries || [])].sort(
      (a, b) => (a.lineupSlotId ?? 999) - (b.lineupSlotId ?? 999)
    );

    // Find current matchup first so we know the week's daily period IDs to sum
    const scoringPeriodId   = leagueData.scoringPeriodId ?? null;
    const currentMatchupId  = leagueData.status?.currentMatchupPeriod ?? leagueData.currentMatchupPeriod ?? null;
    const schedule = leagueData.schedule || [];
    const involvesMe = (m) => m.home?.teamId === myTeam.id || m.away?.teamId === myTeam.id;
    const myMatchups = schedule.filter(involvesMe);
    const myMatchup =
      // 1. Exact current matchup period (most authoritative).
      (currentMatchupId != null && myMatchups.find((m) => m.matchupPeriodId === currentMatchupId)) ||
      // 2. The first in-progress matchup (no winner decided yet) — handles the
      //    common case where currentMatchupPeriod is missing/stale but a live
      //    matchup exists. Avoids falling through to a finished playoff week.
      myMatchups.find((m) => (m.winner === 'UNDECIDED' || m.winner == null) &&
        ((m.home?.totalPointsLive ?? 0) > 0 || (m.away?.totalPointsLive ?? 0) > 0 ||
         (m.home?.totalPoints ?? 0) > 0 || (m.away?.totalPoints ?? 0) > 0)) ||
      myMatchups.find((m) => m.winner === 'UNDECIDED') ||
      // 3. Last resort: most recent scheduled matchup.
      [...myMatchups].sort((a, b) => (b.matchupPeriodId ?? 0) - (a.matchupPeriodId ?? 0))[0] ||
      null;

    // Period IDs that make up the current matchup week (e.g. [48, 49, …, 54])
    const matchupPeriods = (() => {
      const side = myMatchup?.home?.teamId === myTeam.id ? myMatchup?.home : myMatchup?.away;
      const pbsp = side?.pointsByScoringPeriod;
      return pbsp ? Object.keys(pbsp).map(Number) : [];
    })();

    const players = sortedEntries.map((entry) => {
      const pi = entry.playerPoolEntry?.playerPoolEntry?.player || entry.playerPoolEntry?.player;
      const pinfo = entry.playerPoolEntry;
      const proTeamId = String(pi?.proTeamId ?? "");
      const posId = pi?.defaultPositionId;

      // Per-player MATCHUP-WEEK total. Sum the player's actual-stats entries
      // (statSourceId=0, statSplitTypeId=5 = single scoring period) for every
      // day that falls inside the current matchup week. Falls back to the
      // generic appliedStatTotal if those entries aren't returned.
      let pts = 0;
      const sArr = pi?.stats || [];
      if (matchupPeriods.length > 0) {
        for (const s of sArr) {
          if (s.statSourceId === 0 && s.statSplitTypeId === 5 &&
              matchupPeriods.includes(Number(s.scoringPeriodId))) {
            pts += (s.appliedTotal || 0);
          }
        }
      }
      if (!pts) pts = pinfo?.appliedStatTotal ?? entry.appliedStatTotal ?? 0;

      // Also compute TODAY's points so the client can show daily progress
      let pointsToday = 0;
      if (scoringPeriodId != null) {
        const today = sArr.find(s =>
          s.statSourceId === 0 && s.statSplitTypeId === 5 &&
          Number(s.scoringPeriodId) === Number(scoringPeriodId));
        if (today) pointsToday = today.appliedTotal || 0;
      }

      return {
        id: pi?.id,
        name: pi?.fullName || "Unknown",
        position: posMap[posId] || (posId != null ? String(posId) : null),
        lineupSlotId: entry.lineupSlotId ?? null,
        team: teamAbbrevMap[proTeamId] || "",
        image: pi?.id ? `https://a.espncdn.com/i/headshots/${sportHeadshot}/players/full/${pi.id}.png` : null,
        injuryStatus: pinfo?.injuryStatus && pinfo.injuryStatus !== "ACTIVE" ? pinfo.injuryStatus : null,
        points: Math.round(pts * 10) / 10,
        pointsToday: Math.round(pointsToday * 10) / 10,
        // true while the player's real-world team is in a live game right now
        isPlaying: proTeamId ? liveProTeamIds.has(proTeamId) : false,
      };
    });

    // Build matchup payload using totalPoints / totalPointsLive — these are the
    // CURRENT WEEK totals that ESPN's scoreboard displays.
    let matchup = null;
    if (myMatchup) {
      const iAmHome = myMatchup.home?.teamId === myTeam.id;
      const mine    = iAmHome ? myMatchup.home : myMatchup.away;
      const oppSide = iAmHome ? myMatchup.away : myMatchup.home;
      const oppTeam = teams.find((t) => t.id === oppSide?.teamId) || null;
      const teamFullName = (t) => t ? (t.name || `${t.location || ""} ${t.nickname || ""}`.trim() || "Team") : "Opponent";
      const liveOrTotal = (s) =>
        Math.round(((s?.totalPointsLive ?? s?.totalPoints) || 0) * 10) / 10;
      matchup = {
        myTeam: {
          name: teamFullName(myTeam),
          score: liveOrTotal(mine),
          logo: myTeam.logo || null,
        },
        opponent: {
          name: teamFullName(oppTeam),
          score: liveOrTotal(oppSide),
          logo: oppTeam?.logo || null,
        },
        period: myMatchup.matchupPeriodId ?? null,
        scoringPeriodId,
      };
    }

    res.json({
      team_id: myTeam.id,
      team_name: myTeam.name || `${myTeam.location || ""} ${myTeam.nickname || ""}`.trim(),
      players,
      matchup,
    });
  } catch (e) {
    console.error("ESPN Fantasy roster error:", e.response?.status, e.message);
    if (espnCookies && (e.espnExpired || e.response?.status === 401 || e.response?.status === 403)) {
      espnCookies = null;
      saveEspnData(null, espnSavedLeagues);
      return res.status(401).json({ error: "ESPN session expired — re-enter your espn_s2 and SWID cookies" });
    }
    res.status(502).json({ error: "Could not fetch ESPN roster" });
  }
});

// GET /sports/search/players?q=:query&sport=:sport
// Searches ESPN for players within a specific sport
app.get("/sports/search/players", async (req, res) => {
  const q = (req.query.q || "").trim();
  const sport = (req.query.sport || "nba").toLowerCase();
  if (!q || q.length < 2) return res.json({ players: [] });

  try {
    const { data } = await axios.get(
      "https://site.web.api.espn.com/apis/common/v3/search",
      { params: { query: q, limit: 20, type: "player", version: "3.1" }, timeout: 6000 }
    );

    const items = data.items || [];
    const players = items
      .filter(a => a.id && a.displayName && a.league === sport && a.isActive !== false)
      .slice(0, 12)
      .map(a => {
        const id = String(a.id);
        const name = a.displayName || "";
        const headshot = a.headshot?.href || `https://a.espncdn.com/i/headshots/${sport}/players/full/${id}.png`;
        const teamRel = (a.teamRelationships || [])[0]?.core;
        const team = teamRel?.abbreviation || teamRel?.shortDisplayName || "";
        const label = a.label || "";
        // Extract position from label if available, otherwise blank
        const position = "";
        return { id, name, position, team, sport, headshot };
      });

    res.json({ players });
  } catch (e) {
    console.error("Player search error:", e.message);
    res.json({ players: [] });
  }
});

// ---------------------------------------------------------------------------
// Push notifications (Expo Push API)
//   - Clients register their Expo push token.
//   - A poller watches every sport's scoreboard and fires pushes on:
//       • game start (pre → in)
//       • final score (in → post)
//       • trade / signing news
// ---------------------------------------------------------------------------
const PUSH_TOKENS_FILE = migrateLegacyFile("push-tokens.json");
let pushTokens = [];
try {
  if (fs.existsSync(PUSH_TOKENS_FILE)) pushTokens = JSON.parse(fs.readFileSync(PUSH_TOKENS_FILE, "utf8")) || [];
} catch {}
function savePushTokens() {
  try { fs.writeFileSync(PUSH_TOKENS_FILE, JSON.stringify(pushTokens, null, 2)); } catch {}
}

async function sendExpoPush(messages) {
  if (!messages.length || !pushTokens.length) return;
  // Expo accepts up to 100 messages per request.
  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));
  for (const chunk of chunks) {
    try {
      await axios.post("https://exp.host/--/api/v2/push/send", chunk, {
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        timeout: 10000,
      });
    } catch (e) { console.warn("Expo push error:", e.message); }
  }
}

// Broadcast a single notification to every registered token.
function pushToAll(title, body, data = {}) {
  const messages = pushTokens.map((t) => ({ to: t.token, title, body, data, sound: "default", priority: "high" }));
  return sendExpoPush(messages);
}

// POST /notifications/register { token, sports?: string[] }
app.post("/notifications/register", (req, res) => {
  const { token, sports } = req.body || {};
  if (!token || !/^ExponentPushToken|^ExpoPushToken/.test(token)) {
    return res.status(400).json({ error: "Valid Expo push token required" });
  }
  const existing = pushTokens.find((t) => t.token === token);
  if (existing) {
    existing.sports = sports || existing.sports || [];
    existing.updatedAt = Date.now();
  } else {
    pushTokens.push({ token, sports: sports || [], createdAt: Date.now() });
  }
  savePushTokens();
  res.json({ ok: true, registered: pushTokens.length });
});

// POST /notifications/unregister { token }
app.post("/notifications/unregister", (req, res) => {
  const { token } = req.body || {};
  pushTokens = pushTokens.filter((t) => t.token !== token);
  savePushTokens();
  res.json({ ok: true });
});

// Poller state — remember each game's last-known status + score so we only
// notify on actual transitions (not every poll).
const gameStateCache = {};   // eventId → { state, awayScore, homeScore }
const notifiedTrades = new Set();   // article ids already pushed

async function pollForNotifications() {
  if (pushTokens.length === 0) return;
  const messages = [];
  for (const sport of VALID_SPORTS) {
    try {
      const sportPath = SPORT_PATHS[sport];
      const { data } = await axios.get(`${ESPN_BASE}/${sportPath}/scoreboard`, { timeout: 8000 });
      for (const ev of (data.events || [])) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const state = comp.status?.type?.state || "pre";
        const home = (comp.competitors || []).find((c) => c.homeAway === "home");
        const away = (comp.competitors || []).find((c) => c.homeAway === "away");
        const aAbbr = away?.team?.abbreviation || "";
        const hAbbr = home?.team?.abbreviation || "";
        const aScore = away?.score || "0";
        const hScore = home?.score || "0";
        const prev = gameStateCache[ev.id];
        if (prev) {
          // Game start: pre → in
          if (prev.state === "pre" && state === "in") {
            pushTokens.forEach(() => {});
            messages.push({ _broadcast: true, title: `🏟️ ${sport.toUpperCase()} — Game Started`, body: `${aAbbr} @ ${hAbbr} is underway`, data: { type: "gamestart", eventId: ev.id, sport } });
          }
          // Final: in → post
          if (prev.state === "in" && state === "post") {
            messages.push({ _broadcast: true, title: `${sport.toUpperCase()} Final`, body: `${aAbbr} ${aScore}, ${hAbbr} ${hScore}`, data: { type: "final", eventId: ev.id, sport } });
          }
        }
        gameStateCache[ev.id] = { state, awayScore: aScore, homeScore: hScore };
      }
    } catch (_) {}
  }

  // Trade / signing news → notify once per article
  try {
    const { data } = await axios.get("https://ejjs-server.fly.dev/sports/all/news", { timeout: 8000 }).catch(() => ({ data: {} }));
    for (const a of (data.articles || []).slice(0, 30)) {
      const h = (a.headline || "").toLowerCase();
      if (/\btrade|traded|acquir|signs?\b|agree to|deal\b|waived|released/.test(h) && !notifiedTrades.has(a.id)) {
        notifiedTrades.add(a.id);
        messages.push({ _broadcast: true, title: `🔔 ${(a.sport || "").toUpperCase()} News`, body: a.headline, data: { type: "news", url: a.url, sport: a.sport } });
        if (notifiedTrades.size > 500) notifiedTrades.clear();
      }
    }
  } catch (_) {}

  // Expand each broadcast into per-token messages and send.
  const expanded = [];
  for (const m of messages) {
    for (const t of pushTokens) {
      expanded.push({ to: t.token, title: m.title, body: m.body, data: m.data, sound: "default", priority: "high" });
    }
  }
  if (expanded.length) await sendExpoPush(expanded);
}

// Poll every 60s. Prime the cache on first run (no notifications) so we don't
// blast users about games already in progress at boot.
let notifPollerPrimed = false;
setInterval(async () => {
  if (!notifPollerPrimed) {
    // First pass just records current states.
    for (const sport of VALID_SPORTS) {
      try {
        const { data } = await axios.get(`${ESPN_BASE}/${SPORT_PATHS[sport]}/scoreboard`, { timeout: 8000 });
        for (const ev of (data.events || [])) {
          const comp = ev.competitions?.[0];
          gameStateCache[ev.id] = { state: comp?.status?.type?.state || "pre" };
        }
      } catch (_) {}
    }
    notifPollerPrimed = true;
    return;
  }
  pollForNotifications();
}, 60000);

// ---------------------------------------------------------------------------
// HTTP server + WebSocket
// ---------------------------------------------------------------------------

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running http://localhost:${PORT}`);
});

// HTTPS server on port 3443 for local Yahoo OAuth callback only. In production
// (Fly/Railway) TLS is terminated at the platform proxy, so we skip this — the
// self-signed certs aren't shipped and aren't needed.
const HTTPS_PORT = 3443;
if (process.env.NODE_ENV !== "production") {
  try {
    const sslOpts = {
      key: fs.readFileSync(__dirname + "/key.pem"),
      cert: fs.readFileSync(__dirname + "/cert.pem"),
    };
    https.createServer(sslOpts, app).listen(HTTPS_PORT, "0.0.0.0", () => {
      console.log(`HTTPS server running https://localhost:${HTTPS_PORT}`);
    });
  } catch (e) {
    console.warn("Could not start HTTPS server (missing certs?):", e.message);
  }
}

const wss = new WebSocket.Server({ server });

function broadcast(payload) {
  const msg = JSON.stringify({ type: "game_state_update", payload });
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

setInterval(() => {
  liveGames.forEach((g) => broadcast(g));
}, 15000);
