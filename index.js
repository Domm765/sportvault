// SportVault - Stremio addon: UFC, boxing, football, NBA and tennis catalogues (TMDB powered)
// Zero dependencies. Needs Node 18+ and env var TMDB_API_KEY.
const http = require('http');

const PORT = process.env.PORT || 7000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const VERSION = '1.3.0';
const CACHE_MS = 6 * 60 * 60 * 1000; // refresh every 6 hours
const PAGE_SIZE = 100;

// ---------- Sport pools ----------
// Each pool = what to search on TMDB + a title filter so only real matches/events are kept
// (normal sports movies like Rocky or Creed are excluded).
const UFC_LEGENDS = [
  'Anderson Silva', 'Georges St-Pierre', 'Jon Jones', 'Conor McGregor', 'Khabib Nurmagomedov',
  'Chuck Liddell', 'Randy Couture', 'Tito Ortiz', 'Royce Gracie', 'Ken Shamrock', 'BJ Penn',
  'Matt Hughes', 'Dominick Cruz', 'Daniel Cormier', 'Demetrious Johnson', 'Jose Aldo',
  'Cain Velasquez', 'Brock Lesnar', 'Stipe Miocic', 'Rampage Jackson', 'Rashad Evans',
  'Lyoto Machida', 'Vitor Belfort', 'Forrest Griffin', 'Nate Diaz', 'Nick Diaz', 'Ronda Rousey',
  'Amanda Nunes', 'Valentina Shevchenko', 'Joanna Jedrzejczyk', 'Holly Holm', 'Michael Bisping',
  'Dustin Poirier', 'Max Holloway', 'Tyron Woodley', 'Henry Cejudo', 'Israel Adesanya',
  'Francis Ngannou', 'Alex Pereira', 'Mauricio Rua', 'Frank Mir', 'Mirko Cro Cop',
];
const LEGENDS_RE = new RegExp(
  '\\b(' +
    UFC_LEGENDS.map((n) => n.split(' ').slice(-1)[0])
      .concat(['St\\.? ?Pierre', 'Mighty Mouse', 'Cro Cop', 'Rampage', 'GSP'])
      .join('|') +
    ')\\b',
  'i'
);

const NBA_TEAMS = 'Lakers|Celtics|Bulls|Warriors|Heat|Spurs|Cavaliers|Cavs|Pistons|Rockets|Knicks|Suns|Jazz|Nets|Mavericks|Mavs|Raptors|Bucks|Thunder|Sixers|76ers|Pacers|Magic|Kings|Clippers|Nuggets|Trail Blazers|Blazers|SuperSonics|Sonics|Hawks|Hornets|Grizzlies|Pelicans|Timberwolves|Wizards|Bullets|Dream Team';
const TENNIS_PLAYERS = 'Federer|Nadal|Djokovic|Murray|Sampras|Agassi|Borg|McEnroe|Connors|Becker|Edberg|Lendl|Williams|Graf|Seles|Navratilova|Evert|Wawrinka|Alcaraz|Sinner|Medvedev|Hewitt|Roddick|Ivanisevic|Courier|Wilander|Ashe|Laver|Safin|Del Potro|Kuerten|Rafter|Henin|Sharapova|Hingis';

const SPORTS = {
  ufc: {
    keywordQueries: ['ufc', 'mixed martial arts', 'ultimate fighting championship'],
    searchQueries: ['UFC', 'UFC Fight Night', 'UFC on ESPN', 'UFC on Fox', 'UFC on ABC', 'UFC 300', 'UFC 200', 'UFC 100', 'UFC 250', 'UFC 1']
      .concat(UFC_LEGENDS.map((n) => 'UFC ' + n)),
    isEvent: (t) => /\bUFC\b/i.test(t) && !/documentary|the ultimate fighter|story of|making of|embedded|countdown|dana white'?s/i.test(t),
  },
  boxing: {
    keywordQueries: ['boxing match', 'boxing', 'boxing event', 'heavyweight boxing', 'title fight'],
    searchQueries: ['boxing vs', 'Mayweather vs', 'Canelo vs', 'Fury vs', 'Usyk vs', 'Joshua vs', 'Tyson vs', 'Pacquiao vs', 'Ali vs', 'Wilder vs', 'Crawford vs', 'Inoue vs', 'Golovkin vs', 'Lomachenko vs', 'Haney vs', 'Davis vs', 'Garcia vs', 'Paul vs', 'Heavyweight Championship boxing', 'World Title Fight'],
    isEvent: (t) => /\b(vs\.?|v\.?|versus)\b/i.test(t) && !/\bUFC\b|\bWWE\b|\bMMA\b|rocky|creed|the movie|biopic/i.test(t),
  },
  football: {
    keywordQueries: [],
    searchQueries: ['World Cup final', 'FIFA World Cup', 'World Cup semi-final', 'World Cup quarter-final', 'Champions League final', 'European Cup final', 'Euro final', 'UEFA Euro', 'Copa America final', 'El Clasico', 'Real Madrid vs Barcelona', 'Barcelona vs Real Madrid', 'Brazil vs', 'Argentina vs', 'Germany vs', 'Italy vs', 'France vs', 'England vs', 'Netherlands vs', 'Spain vs', 'Liverpool vs', 'Manchester United vs', 'Manchester City vs', 'Arsenal vs', 'Chelsea vs', 'AC Milan vs', 'Juventus vs', 'Bayern vs', 'Real Madrid vs', 'Barcelona vs', 'Maradona match', 'Pele match', 'Premier League classic', 'FA Cup final'].concat([
      'Premier League', 'La Liga', 'Serie A', 'Champions League', 'Champions League semi-final', 'Champions League classic', 'European Cup', 'UEFA Champions League final',
      'Liverpool vs AC Milan', 'Manchester United vs Bayern', 'Barcelona vs Manchester United', 'Real Madrid vs Liverpool', 'Real Madrid vs Atletico', 'Barcelona vs PSG', 'Barcelona vs Liverpool', 'Chelsea vs Bayern', 'Manchester City vs Real Madrid',
      'Manchester United vs Arsenal', 'Manchester City vs Liverpool', 'Manchester City vs Manchester United', 'Chelsea vs Liverpool', 'Tottenham vs', 'Arsenal vs Tottenham', 'Atletico Madrid vs', 'Inter vs', 'Napoli vs', 'Roma vs', 'Juventus vs Inter', 'AC Milan vs Inter', 'PSG vs', 'Dortmund vs',
      'Brazil vs Italy', 'Argentina vs England', 'Argentina vs France', 'Germany vs Brazil', 'Netherlands vs Argentina', 'Spain vs Netherlands', 'France vs Brazil', 'Italy vs Germany',
    ]).concat([1966, 1970, 1974, 1978, 1982, 1986, 1990, 1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022].map((y) => 'World Cup ' + y)),
    isEvent: (t) =>
      (/\b(vs\.?|v\.?|versus)\b/i.test(t) || /\bfinal\b|world cup|champions league|european cup|euro \d{4}|semi-?final|copa america|el cl[aá]sico|derby|premier league|la liga|serie a/i.test(t)) &&
      !/\bNBA\b|\bUFC\b|\bWWE\b|boxing|\bNFL\b|basketball|tennis|wimbledon|super bowl|rocky|creed|goal!|bend it|ted lasso/i.test(t),
  },
  nba: {
    keywordQueries: [],
    searchQueries: ['NBA Finals', 'NBA Finals Game 7', 'NBA Finals Game 6', 'NBA Playoffs', 'NBA Game', 'NBA All-Star Game', 'Eastern Conference Finals', 'Western Conference Finals', 'Lakers vs', 'Celtics vs', 'Bulls vs', 'Warriors vs', 'Heat vs', 'Spurs vs', 'Cavaliers vs', 'Pistons vs', 'Rockets vs', 'Knicks vs', 'Suns vs', 'Jazz vs', 'Michael Jordan game', 'Magic Johnson Larry Bird', 'Kobe Bryant game', 'LeBron James game', 'Stephen Curry game', 'Dream Team'],
    isEvent: (t) =>
      new RegExp('\\bNBA\\b|\\b(' + NBA_TEAMS + ')\\b', 'i').test(t) &&
      /\b(vs\.?|v\.?|versus)\b|game \d|finals?|playoffs?|all-star|series|classic/i.test(t) &&
      !/space jam|\bUFC\b|\bWWE\b|\bNFL\b|rocky|creed|documentary|the last dance/i.test(t),
  },
  tennis: {
    keywordQueries: [],
    searchQueries: ['Wimbledon final', 'US Open final', 'Australian Open final', 'French Open final', 'Roland Garros final', 'Wimbledon', 'ATP Finals', 'Davis Cup', 'Federer vs Nadal', 'Federer vs Djokovic', 'Nadal vs Djokovic', 'Federer vs Roddick', 'Sampras vs Agassi', 'Sampras vs', 'Agassi vs', 'Borg McEnroe', 'McEnroe vs Connors', 'Becker vs', 'Murray vs Djokovic', 'Serena Williams final', 'Williams vs', 'Graf vs', 'Alcaraz vs'],
    isEvent: (t) =>
      (new RegExp('\\b(' + TENNIS_PLAYERS + ')\\b', 'i').test(t) || /wimbledon|us open|australian open|french open|roland.?garros|atp finals|davis cup/i.test(t)) &&
      (/\b(vs\.?|v\.?|versus)\b|final|match|championship|open|wimbledon/i.test(t)) &&
      !/borg vs\.? mcenroe|battle of the sexes|king richard|\bUFC\b|\bNBA\b|\bWWE\b|boxing|rocky|creed/i.test(t),
  },
};

// ---------- WWE (best matches only: Undertaker era + old legends) ----------
const WWE_OLD_NAMES = 'Hulk Hogan|Hogan|Ric Flair|Flair|Randy Savage|Macho Man|Ultimate Warrior|Andre the Giant|Roddy Piper|Piper|Ricky Steamboat|Steamboat|Jake Roberts|DiBiase|Sammartino|Harley Race|Dusty Rhodes|Bruno|Jimmy Snuka|Greg Valentine|Big Boss Man|Honky Tonk Man|Mr\\.? Perfect|Rick Rude|Sgt\\.? Slaughter|Iron Sheik|Nikolai Volkoff|Junkyard Dog|Lex Luger|Sting|Terry Funk|Bob Backlund';
const WWE_OLD_RE = new RegExp('\\b(' + WWE_OLD_NAMES + ')\\b', 'i');
const WWE_NAMES = 'Undertaker|Stone Cold|Steve Austin|The Rock|Shawn Michaels|HBK|Bret Hart|Hitman|Kane|Triple H|Mankind|Mick Foley|Cactus Jack|Edge|John Cena|Batista|Eddie Guerrero|Rey Mysterio|Brock Lesnar|Kurt Angle|Chris Jericho|CM Punk|Randy Orton|Roman Reigns|Seth Rollins|Daniel Bryan|AJ Styles|Big Show|Yokozuna|Diesel|Razor Ramon|Owen Hart|British Bulldog|Vader|Goldberg|Rob Van Dam|Chris Benoit|Lita|Trish Stratus|Charlotte|Becky Lynch|Bayley|Sasha Banks';
const WWE_RE = new RegExp('\\b(' + WWE_NAMES + '|' + WWE_OLD_NAMES + ')\\b', 'i');

SPORTS.wwe = {
  keywordQueries: [],
  searchQueries: ['WrestleMania', 'WWE WrestleMania', 'SummerSlam', 'Royal Rumble', 'Survivor Series', 'Hell in a Cell', 'Undertaker vs', 'Undertaker', 'Stone Cold vs', 'The Rock vs', 'Shawn Michaels vs', 'Bret Hart vs', 'Hulk Hogan vs', 'Ric Flair vs', 'Randy Savage vs', 'Ultimate Warrior vs', 'Andre the Giant vs', 'Kane vs', 'Triple H vs', 'Mankind vs', 'Edge vs', 'John Cena vs', 'Batista vs', 'Eddie Guerrero vs', 'Brock Lesnar vs', 'Kurt Angle vs', 'WWF', 'WWE classic matches', 'Bad Blood', 'No Mercy', 'Badd Blood', 'Judgment Day', 'Armageddon', 'Starrcade', 'WCW Halloween Havoc', 'WCW Nitro'],
  isEvent: (t) =>
    (WWE_RE.test(t) || /\bWWE\b|\bWWF\b|\bWCW\b|wrestlemania|summerslam|royal rumble|survivor series|hell in a cell|starrcade|bad blood|badd blood|no mercy|judgment day|armageddon/i.test(t)) &&
    !/documentary|biography|story of|beyond the ring|fighting with my family|the movie|nacho|ready to rumble/i.test(t),
};

// ---------- Documentaries per sport (series + movies, no WWE) ----------
const NOT_WWE = /\bWWE\b|\bWWF\b|wrestl|wrestlemania/i;
const DOCS = {
  ufc: {
    name: 'UFC',
    queries: ['UFC documentary', 'MMA documentary', 'mixed martial arts', 'UFC fighter', 'octagon', 'Conor McGregor', 'Khabib Nurmagomedov', 'Anderson Silva', 'Georges St-Pierre', 'Jon Jones', 'Ronda Rousey', 'Israel Adesanya', 'Francis Ngannou', 'The Ultimate Fighter', 'Fight Night'],
    relevant: /\bUFC\b|mixed martial|\bMMA\b|octagon|cage fight|cage fighter/i,
    exclude: NOT_WWE,
  },
  boxing: {
    name: 'Boxing',
    queries: ['boxing documentary', 'Mike Tyson', 'Muhammad Ali', 'Floyd Mayweather', 'Manny Pacquiao', 'Canelo Alvarez', 'Tyson Fury', 'Anthony Joshua', 'heavyweight champion', 'boxer documentary', 'Oleksandr Usyk', 'Sugar Ray Leonard', 'Joe Frazier', 'George Foreman', 'Roy Jones', 'Golovkin', 'prizefighter', 'world title fight'],
    relevant: /boxing|boxer|heavyweight|prizefight|title fight|knockout|\bring\b/i,
    exclude: new RegExp(NOT_WWE.source + '|\\bUFC\\b|\\bMMA\\b|mixed martial', 'i'),
  },
  football: {
    name: 'Football',
    queries: ['football documentary', 'soccer documentary', 'World Cup documentary', 'Lionel Messi', 'Cristiano Ronaldo', 'Diego Maradona', 'Pele', 'Premier League documentary', 'Champions League documentary', 'FC Barcelona documentary', 'Real Madrid documentary', 'Manchester United documentary', 'Liverpool documentary', 'Manchester City documentary', 'Arsenal documentary', 'Zinedine Zidane', 'David Beckham', 'Neymar', 'FIFA', 'All or Nothing', 'Welcome to Wrexham', 'Sunderland Til I Die', 'Take Us Home', 'Ronaldinho', 'Cruyff', 'Mbappe', 'Haaland', 'Juventus documentary', 'Bayern Munich documentary'],
    relevant: /football|soccer|world cup|premier league|champions league|\bFIFA\b|striker|goalkeeper|footballer|la liga|serie a|bundesliga/i,
    exclude: new RegExp(NOT_WWE.source + '|\\bNFL\\b|american football|quarterback|super bowl|college football|touchdown|gridiron|high school football|friday night', 'i'),
  },
  nba: {
    name: 'NBA',
    queries: ['NBA documentary', 'basketball documentary', 'Michael Jordan', 'The Last Dance', 'Kobe Bryant', 'LeBron James', 'Stephen Curry', 'Magic Johnson', 'Larry Bird', 'Dream Team', 'Allen Iverson', 'Lakers documentary', 'Celtics documentary', 'Chicago Bulls documentary', 'Shaquille O\'Neal', 'Kevin Durant', 'Tim Duncan', 'Wilt Chamberlain', 'Bill Russell', 'Steph Curry', 'NBA Finals'],
    relevant: /\bNBA\b|basketball|lakers|celtics|chicago bulls|dream team/i,
    exclude: NOT_WWE,
  },
  tennis: {
    name: 'Tennis',
    queries: ['tennis documentary', 'Wimbledon', 'Roger Federer', 'Rafael Nadal', 'Novak Djokovic', 'Serena Williams', 'Bjorn Borg', 'John McEnroe', 'Pete Sampras', 'Andre Agassi', 'Break Point', 'Grand Slam', 'Roland Garros', 'Andy Murray', 'Venus Williams', 'Steffi Graf', 'Martina Navratilova', 'Carlos Alcaraz', 'Naomi Osaka', 'US Open tennis'],
    relevant: /tennis|wimbledon|grand slam|roland.?garros|us open|atp|wta/i,
    exclude: NOT_WWE,
  },
};

// ---------- Catalogue definitions ----------
// from/to = release-year range (era rows). filter = extra check on the item (UFC legends).
const CATALOGS = [
  { id: 'sv-ufc-best', sport: 'ufc', name: 'All Time Best UFC Events', mode: 'best' },
  { id: 'sv-ufc-recent', sport: 'ufc', name: 'Recently Added UFC Events', mode: 'recent' },
  { id: 'sv-ufc-legends', sport: 'ufc', name: 'UFC Legends', mode: 'best', filter: (m) => LEGENDS_RE.test(m._text) },
  { id: 'sv-boxing-best', sport: 'boxing', name: 'All Time Best Boxing Events', mode: 'best' },
  { id: 'sv-boxing-recent', sport: 'boxing', name: 'Recently Added Boxing Events', mode: 'recent' },

  { id: 'sv-fb-greatest', sport: 'football', name: 'Greatest Football Matches of All Time', mode: 'best' },
  { id: 'sv-fb-pre80', sport: 'football', name: 'Football Eras - Before 1980', mode: 'best', to: 1979 },
  { id: 'sv-fb-80s', sport: 'football', name: 'Football Eras - 1980s', mode: 'best', from: 1980, to: 1989 },
  { id: 'sv-fb-90s', sport: 'football', name: 'Football Eras - 1990s', mode: 'best', from: 1990, to: 1999 },
  { id: 'sv-fb-00s', sport: 'football', name: 'Football Eras - 2000s', mode: 'best', from: 2000, to: 2009 },
  { id: 'sv-fb-10s', sport: 'football', name: 'Football Eras - 2010s', mode: 'best', from: 2010, to: 2019 },
  { id: 'sv-fb-20s', sport: 'football', name: 'Football Eras - 2020s', mode: 'best', from: 2020 },

  { id: 'sv-nba-greatest', sport: 'nba', name: 'Greatest NBA Games', mode: 'best' },
  { id: 'sv-nba-pre80', sport: 'nba', name: 'NBA Eras - Before 1980', mode: 'best', to: 1979 },
  { id: 'sv-nba-80s', sport: 'nba', name: 'NBA Eras - 1980s (Magic & Bird)', mode: 'best', from: 1980, to: 1989 },
  { id: 'sv-nba-90s', sport: 'nba', name: 'NBA Eras - 1990s (Jordan)', mode: 'best', from: 1990, to: 1999 },
  { id: 'sv-nba-00s', sport: 'nba', name: 'NBA Eras - 2000s (Kobe, Shaq, Duncan)', mode: 'best', from: 2000, to: 2009 },
  { id: 'sv-nba-10s', sport: 'nba', name: 'NBA Eras - 2010s (LeBron, Curry)', mode: 'best', from: 2010, to: 2019 },
  { id: 'sv-nba-20s', sport: 'nba', name: 'NBA Eras - 2020s', mode: 'best', from: 2020 },

  { id: 'sv-tn-pre90', sport: 'tennis', name: 'Tennis Eras - Before 1990 (Borg, McEnroe)', mode: 'best', to: 1989 },
  { id: 'sv-tn-90s', sport: 'tennis', name: 'Tennis Eras - 1990s (Sampras, Agassi)', mode: 'best', from: 1990, to: 1999 },
  { id: 'sv-tn-00s', sport: 'tennis', name: 'Tennis Eras - 2000s (Federer Rise)', mode: 'best', from: 2000, to: 2009 },
  { id: 'sv-tn-10s', sport: 'tennis', name: 'Tennis Eras - 2010s (Big Three)', mode: 'best', from: 2010, to: 2019 },
  { id: 'sv-tn-20s', sport: 'tennis', name: 'Tennis Eras - 2020s', mode: 'best', from: 2020 },
];

// WWE: best matches only (no premium-event rows). Undertaker era = 1990-2020, old legends = before 1990 or legend names.
const isOldLegend = (m) => parseInt(m._date.slice(0, 4), 10) <= 1989 || WWE_OLD_RE.test(m._text);
CATALOGS.push(
  { id: 'sv-wwe-undertaker', sport: 'wwe', name: 'Best WWE Matches - Undertaker Era', mode: 'best', from: 1990, to: 2020, filter: (m) => !isOldLegend(m) },
  { id: 'sv-wwe-legends', sport: 'wwe', name: 'Best WWE Matches - Old Famous Wrestlers', mode: 'best', filter: isOldLegend }
);

// Football: big-league matches (big clubs only), Champions League archive, World Cup archive
const BIG_TEAMS_RE = /\b(Manchester United|Man\.? ?United|Man\.? ?Utd|Manchester City|Man\.? ?City|Liverpool|Arsenal|Chelsea|Tottenham|Spurs|Real Madrid|Barcelona|Barca|Atl[eé]tico|Juventus|Juve|Inter|Inter Milan|AC Milan|Milan|Napoli|Roma|PSG|Paris Saint-Germain|Bayern|Dortmund)\b/i;
const NATIONAL_RE = /world cup|euro \d{4}|\beuros?\b|copa america|nations league/i;
CATALOGS.push(
  { id: 'sv-fb-bigleagues-recent', sport: 'football', name: 'Recently Added Big League Matches', mode: 'recent', filter: (m) => BIG_TEAMS_RE.test(m.name) && !NATIONAL_RE.test(m.name) },
  { id: 'sv-fb-ucl-archive', sport: 'football', name: 'Champions League Archive - Best Matches', mode: 'best', filter: (m) => /champions league|european cup|\bUCL\b/i.test(m._text) },
  { id: 'sv-fb-wc-archive', sport: 'football', name: 'World Cup Archive - Best Matches', mode: 'best', filter: (m) => /world cup/i.test(m._text) && !/women|rugby|cricket/i.test(m._text) }
);

// Documentaries: one series row and one movie row per sport (no WWE)
for (const [key, d] of Object.entries(DOCS)) {
  CATALOGS.push(
    { id: `sv-doc-${key}-series`, sport: `doc-${key}-series`, type: 'series', name: `${d.name} Documentary Series`, mode: 'popular' },
    { id: `sv-doc-${key}-movies`, sport: `doc-${key}-movie`, type: 'movie', name: `${d.name} Documentary Movies`, mode: 'popular' }
  );
}

const manifest = {
  id: 'community.sportvault',
  version: VERSION,
  name: 'SportVault',
  description: 'UFC, boxing, football, NBA, tennis and WWE legends: best events, eras and documentaries.',
  resources: ['catalog'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: CATALOGS.map((c) => ({
    type: c.type || 'movie',
    id: c.id,
    name: c.name,
    extra: [{ name: 'skip', isRequired: false }],
  })),
  behaviorHints: { configurable: false },
};

// ---------- TMDB helpers ----------
async function tmdb(path, params = {}) {
  const url = new URL('https://api.themoviedb.org/3' + path);
  url.searchParams.set('api_key', TMDB_KEY);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

async function pooled(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function collectCandidates(sport) {
  const cfg = SPORTS[sport];
  const found = new Map();
  const today = new Date().toISOString().slice(0, 10);

  // 1) keyword ids -> discover (UFC and boxing only)
  const kwIds = new Set();
  for (const q of cfg.keywordQueries) {
    const r = await tmdb('/search/keyword', { query: q });
    (r && r.results ? r.results.slice(0, 3) : []).forEach((k) => kwIds.add(k.id));
  }
  if (kwIds.size) {
    const kw = [...kwIds].join('|');
    for (const sortBy of ['release_date.desc', 'vote_count.desc', 'popularity.desc']) {
      for (let page = 1; page <= 5; page++) {
        const r = await tmdb('/discover/movie', {
          with_keywords: kw,
          sort_by: sortBy,
          'release_date.lte': today,
          include_adult: 'false',
          page,
        });
        if (!r || !r.results || !r.results.length) break;
        r.results.forEach((m) => found.set(m.id, m));
        if (page >= (r.total_pages || 1)) break;
      }
    }
  }

  // 2) title searches
  for (const q of cfg.searchQueries) {
    for (let page = 1; page <= 3; page++) {
      const r = await tmdb('/search/movie', { query: q, page, include_adult: 'false' });
      if (!r || !r.results || !r.results.length) break;
      r.results.forEach((m) => found.set(m.id, m));
      if (page >= (r.total_pages || 1)) break;
    }
  }

  // keep only real events that are already released
  const list = [...found.values()].filter(
    (m) => m.title && cfg.isEvent(m.title) && m.release_date && m.release_date <= today
  );

  // 3) resolve IMDb ids so Stremio can find streams
  const withImdb = await pooled(list, 8, async (m) => {
    const ext = await tmdb(`/movie/${m.id}/external_ids`);
    const imdb = ext && ext.imdb_id;
    if (!imdb) return null;
    return {
      id: imdb,
      type: 'movie',
      name: m.title,
      poster: m.poster_path ? 'https://image.tmdb.org/t/p/w500' + m.poster_path : undefined,
      background: m.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + m.backdrop_path : undefined,
      description: m.overview || undefined,
      releaseInfo: m.release_date ? m.release_date.slice(0, 4) : undefined,
      genres: ['Sport'],
      _date: m.release_date,
      _text: m.title + ' ' + (m.overview || ''),
      _rating: m.vote_average || 0,
      _votes: m.vote_count || 0,
      _pop: m.popularity || 0,
    };
  });
  const seen = new Set();
  return withImdb.filter((x) => x && !seen.has(x.id) && seen.add(x.id));
}

// ---------- Documentaries (genre Documentary + sport relevance) ----------
async function collectDocs(key) {
  const [, sport, kind] = key.split('-'); // doc-ufc-movie / doc-ufc-series
  const cfg = DOCS[sport];
  const isTv = kind === 'series';
  const found = new Map();
  const today = new Date().toISOString().slice(0, 10);

  for (const q of cfg.queries) {
    for (let page = 1; page <= 2; page++) {
      const r = await tmdb(isTv ? '/search/tv' : '/search/movie', { query: q, page, include_adult: 'false' });
      if (!r || !r.results || !r.results.length) break;
      r.results.forEach((m) => found.set(m.id, m));
      if (page >= (r.total_pages || 1)) break;
    }
  }

  const list = [...found.values()].filter((m) => {
    const title = isTv ? m.name : m.title;
    const date = isTv ? m.first_air_date : m.release_date;
    const text = title + ' ' + (m.overview || '');
    return (
      title && date && date <= today &&
      (m.genre_ids || []).includes(99) &&
      cfg.relevant.test(text) &&
      !cfg.exclude.test(text)
    );
  });

  const items = await pooled(list, 8, async (m) => {
    const title = isTv ? m.name : m.title;
    const date = isTv ? m.first_air_date : m.release_date;
    const ext = await tmdb(`/${isTv ? 'tv' : 'movie'}/${m.id}/external_ids`);
    const imdb = ext && ext.imdb_id;
    if (!imdb) return null;
    return {
      id: imdb,
      type: isTv ? 'series' : 'movie',
      name: title,
      poster: m.poster_path ? 'https://image.tmdb.org/t/p/w500' + m.poster_path : undefined,
      background: m.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + m.backdrop_path : undefined,
      description: m.overview || undefined,
      releaseInfo: date.slice(0, 4),
      genres: ['Documentary', 'Sport'],
      _date: date,
      _text: title + ' ' + (m.overview || ''),
      _rating: m.vote_average || 0,
      _votes: m.vote_count || 0,
      _pop: m.popularity || 0,
    };
  });
  const seen = new Set();
  return items.filter((x) => x && !seen.has(x.id) && seen.add(x.id));
}

// ---------- Cache ----------
const cache = {}; // pool key -> { at, items, loading }

async function getSport(sport) {
  const c = cache[sport];
  const fresh = c && c.items && Date.now() - c.at < CACHE_MS;
  if (fresh) return c.items;
  if (c && c.loading) return c.items || c.loading;
  const loading = (sport.startsWith('doc-') ? collectDocs(sport) : collectCandidates(sport))
    .then((items) => {
      console.log(`[${sport}] loaded ${items.length} events`);
      cache[sport] = { at: Date.now(), items };
      return items;
    })
    .catch((e) => {
      console.error(`[${sport}] failed`, e);
      return (c && c.items) || [];
    });
  cache[sport] = { ...(c || {}), loading };
  return c && c.items ? c.items : loading;
}

function rank(items, mode) {
  const arr = [...items];
  if (mode === 'recent') {
    arr.sort((a, b) => b._date.localeCompare(a._date));
  } else if (mode === 'popular') {
    // documentaries have many votes: rating weighted by log(votes), plus popularity
    const score = (x) => x._rating * Math.log10(x._votes + 1) + x._pop * 0.05;
    arr.sort((a, b) => score(b) - score(a));
  } else {
    // best = rating weighted by votes (events have few votes), popularity as tie-break
    arr.sort((a, b) => {
      const sa = a._rating * Math.min(a._votes, 20) + a._pop * 0.01;
      const sb = b._rating * Math.min(b._votes, 20) + b._pop * 0.01;
      return sb - sa;
    });
  }
  return arr;
}

function select(cat, items) {
  let list = items;
  if (cat.from || cat.to) {
    list = list.filter((m) => {
      const y = parseInt(m._date.slice(0, 4), 10);
      return (!cat.from || y >= cat.from) && (!cat.to || y <= cat.to);
    });
  }
  if (cat.filter) list = list.filter(cat.filter);
  return rank(list, cat.mode);
}

function clean(m) {
  const { _date, _text, _rating, _votes, _pop, ...rest } = m;
  return rest;
}

// ---------- HTTP server ----------
function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'max-age=900',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const path = decodeURIComponent(req.url.split('?')[0]);

    if (path === '/' || path === '/health') {
      return send(res, 200, { name: 'SportVault', version: VERSION, ok: true, manifest: '/manifest.json' });
    }
    if (path === '/manifest.json') return send(res, 200, manifest);

    // /catalog/movie/<id>.json  or  /catalog/movie/<id>/skip=100.json
    const m = path.match(/^\/catalog\/(?:movie|series)\/([^/]+?)(?:\/([^/]+))?\.json$/);
    if (m) {
      const cat = CATALOGS.find((c) => c.id === m[1]);
      if (!cat) return send(res, 404, { metas: [] });
      let skip = 0;
      if (m[2]) {
        const s = m[2].match(/skip=(\d+)/);
        if (s) skip = parseInt(s[1], 10);
      }
      const items = await getSport(cat.sport);
      const metas = select(cat, items).slice(skip, skip + PAGE_SIZE).map(clean);
      return send(res, 200, { metas });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { metas: [] });
  }
});

if (!TMDB_KEY) console.error('WARNING: TMDB_API_KEY is not set - catalogues will be empty.');

server.listen(PORT, () => {
  console.log(`SportVault v${VERSION} listening on ${PORT} with ${CATALOGS.length} catalogues`);
  // warm the cache one sport at a time (gentle on TMDB) and refresh in the background
  const warm = async () => {
    const keys = Object.keys(SPORTS).concat([...new Set(CATALOGS.map((c) => c.sport).filter((s) => s.startsWith('doc-')))]);
    for (const s of keys) {
      cache[s] = { ...(cache[s] || {}), at: 0 };
      await getSport(s);
    }
  };
  warm();
  setInterval(warm, CACHE_MS);
});
