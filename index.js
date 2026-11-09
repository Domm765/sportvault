// SportVault - Stremio addon: UFC, boxing, WWE legends and sport documentaries (TMDB powered)
// Zero dependencies. Needs Node 18+ and env var TMDB_API_KEY.
const http = require('http');

const PORT = process.env.PORT || 7000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const VERSION = '1.4.0';
const CACHE_MS = 6 * 60 * 60 * 1000; // refresh every 6 hours
const PAGE_SIZE = 100;

// Genres that are never real fights/matches: Animation, Fantasy, Sci-Fi, Horror, Family
const BAD_GENRES = [16, 14, 878, 27, 10751];
const VS = /\b(vs\.?|versus)\b|\bv\.\s/i;
const TV_LIKE = /\bseason\b|\bepisode\b|\bS\d+E\d+\b|\bEp\.? ?\d+/i;

// ---------- UFC ----------
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

// ---------- WWE (best matches only: Undertaker era + old legends) ----------
const WWE_OLD_NAMES = 'Hulk Hogan|Hogan|Ric Flair|Flair|Randy Savage|Macho Man|Ultimate Warrior|Andre the Giant|Roddy Piper|Piper|Ricky Steamboat|Steamboat|Jake Roberts|DiBiase|Sammartino|Harley Race|Dusty Rhodes|Bruno|Jimmy Snuka|Greg Valentine|Big Boss Man|Honky Tonk Man|Mr\\.? Perfect|Rick Rude|Sgt\\.? Slaughter|Iron Sheik|Nikolai Volkoff|Junkyard Dog|Lex Luger|Sting|Terry Funk|Bob Backlund';
const WWE_OLD_RE = new RegExp('\\b(' + WWE_OLD_NAMES + ')\\b', 'i');
const WWE_NAMES = 'Undertaker|Stone Cold|Steve Austin|The Rock|Shawn Michaels|HBK|Bret Hart|Hitman|Kane|Triple H|Mankind|Mick Foley|Cactus Jack|Edge|John Cena|Batista|Eddie Guerrero|Rey Mysterio|Brock Lesnar|Kurt Angle|Chris Jericho|CM Punk|Randy Orton|Roman Reigns|Seth Rollins|Daniel Bryan|AJ Styles|Big Show|Yokozuna|Diesel|Razor Ramon|Owen Hart|British Bulldog|Vader|Goldberg|Rob Van Dam|Chris Benoit|Lita|Trish Stratus|Charlotte|Becky Lynch|Bayley|Sasha Banks';
const WWE_RE = new RegExp('\\b(' + WWE_NAMES + '|' + WWE_OLD_NAMES + ')\\b', 'i');

// ---------- Event pools (real fights/matches only) ----------
// relevant(m) gets the full TMDB result (title + overview) so anime/fiction is filtered out.
const SPORTS = {
  ufc: {
    keywordQueries: ['ufc', 'mixed martial arts', 'ultimate fighting championship'],
    searchQueries: ['UFC', 'UFC Fight Night', 'UFC on ESPN', 'UFC on Fox', 'UFC on ABC', 'UFC 300', 'UFC 200', 'UFC 100', 'UFC 250', 'UFC 1']
      .concat(UFC_LEGENDS.map((n) => 'UFC ' + n)),
    isEvent: (t) => /\bUFC\b/i.test(t) && !/documentary|the ultimate fighter|story of|making of|embedded|countdown|dana white'?s/i.test(t),
    relevant: () => true,
  },
  boxing: {
    keywordQueries: ['boxing match', 'boxing event', 'heavyweight boxing'],
    searchQueries: ['boxing vs', 'Mayweather vs', 'Canelo vs', 'Fury vs', 'Usyk vs', 'Joshua vs', 'Tyson vs', 'Pacquiao vs', 'Ali vs', 'Wilder vs', 'Crawford vs', 'Inoue vs', 'Golovkin vs', 'Lomachenko vs', 'Haney vs', 'Davis vs', 'Garcia vs', 'Paul vs', 'Holyfield vs', 'Lewis vs', 'Frazier vs', 'Foreman vs', 'Leonard vs', 'Hagler vs', 'Hearns vs', 'Duran vs', 'De La Hoya vs', 'Hopkins vs', 'Calzaghe vs', 'Hatton vs', 'Chavez vs', 'Klitschko vs', 'Spence vs', 'Taylor vs', 'Heavyweight Championship boxing', 'World Title Fight', 'Rumble in the Jungle', 'Thrilla in Manila', 'Fight of the Century'],
    isEvent: (t) => VS.test(t) && !TV_LIKE.test(t) && !/\bUFC\b|\bWWE\b|\bMMA\b|rocky|creed|the movie|biopic|anime/i.test(t),
    // must really be a boxing bout (overview or title talks about boxing)
    relevant: (m) => /box(ing|er)|heavyweight|welterweight|middleweight|bout|title fight|knockout|\bWBC\b|\bWBA\b|\bIBF\b|\bWBO\b|championship/i.test((m.title || '') + ' ' + (m.overview || '')),
  },
  wwe: {
    keywordQueries: [],
    searchQueries: ['WrestleMania', 'WWE WrestleMania', 'SummerSlam', 'Royal Rumble', 'Survivor Series', 'Hell in a Cell', 'Undertaker vs', 'Undertaker', 'Stone Cold vs', 'The Rock vs', 'Shawn Michaels vs', 'Bret Hart vs', 'Hulk Hogan vs', 'Ric Flair vs', 'Randy Savage vs', 'Ultimate Warrior vs', 'Andre the Giant vs', 'Kane vs', 'Triple H vs', 'Mankind vs', 'Edge vs', 'John Cena vs', 'Batista vs', 'Eddie Guerrero vs', 'Brock Lesnar vs', 'Kurt Angle vs', 'WWF', 'WWE classic matches', 'Bad Blood', 'No Mercy', 'Badd Blood', 'Judgment Day', 'Armageddon', 'Starrcade', 'WCW Halloween Havoc', 'WCW Nitro'],
    isEvent: (t) =>
      (WWE_RE.test(t) || /\bWWE\b|\bWWF\b|\bWCW\b|wrestlemania|summerslam|royal rumble|survivor series|hell in a cell|starrcade|bad blood|badd blood|no mercy|judgment day|armageddon/i.test(t)) &&
      !/documentary|biography|story of|beyond the ring|fighting with my family|the movie|nacho|ready to rumble/i.test(t),
    relevant: () => true,
  },
};

// ---------- Documentaries per sport ----------
// merged = one row mixing series + movies. Otherwise separate Series and Movies rows.
const NOT_WWE = /\bWWE\b|\bWWF\b|wrestl|wrestlemania/i;
const DOCS = {
  ufc: {
    name: 'UFC',
    merged: true,
    keywords: ['ufc', 'mixed martial arts', 'mma', 'ultimate fighting championship', 'martial arts fighter'],
    queries: ['UFC documentary', 'MMA documentary', 'mixed martial arts', 'UFC fighter', 'octagon', 'Conor McGregor', 'Khabib Nurmagomedov', 'Anderson Silva', 'Georges St-Pierre', 'Jon Jones', 'Ronda Rousey', 'Israel Adesanya', 'Francis Ngannou', 'The Ultimate Fighter', 'Fight Night', 'Dana White', 'Contender Series', 'Chael Sonnen', 'Cris Cyborg', 'Brock Lesnar', 'Nick Diaz', 'Nate Diaz', 'Daniel Cormier', 'Frankie Edgar', 'Dustin Poirier', 'Max Holloway', 'Alexander Volkanovski', 'Islam Makhachev', 'Sean O\'Malley', 'Alex Pereira', 'Valentina Shevchenko', 'Amanda Nunes', 'Fedor Emelianenko', 'BJ Penn', 'Chuck Liddell', 'Royce Gracie', 'Gracie jiu-jitsu', 'Cage Warriors', 'Dagestan fighters', 'Randy Couture', 'Ken Shamrock', 'Tito Ortiz', 'Matt Hughes', 'Forrest Griffin', 'Mark Hunt', 'Joanna Jedrzejczyk', 'Rose Namajunas', 'Holly Holm', 'cage fighter', 'MMA gym', 'Fight Pass', 'Jorge Masvidal', 'Kamaru Usman', 'Colby Covington', 'Paddy Pimblett', 'Tom Aspinall', 'Zhang Weili', 'Ilia Topuria'],
    relevant: /\bUFC\b|mixed martial|\bMMA\b|octagon|cage fight|McGregor|Khabib|Nurmagomedov|Anderson Silva|St-Pierre|Jon Jones|Rousey|Adesanya|Ngannou|Liddell|Couture|Gracie|Dana White|Fight Pass|Lesnar|Diaz|Cormier|Poirier|Holloway|Volkanovski|Makhachev|O'Malley|Pereira|Shevchenko|Nunes|Emelianenko|Penn|Pimblett|Aspinall|Topuria/i,
    exclude: NOT_WWE,
  },
  boxing: {
    name: 'Boxing',
    merged: true,
    keywords: ['boxing', 'boxer', 'boxing match', 'heavyweight boxing', 'boxing champion', 'professional boxing'],
    queries: ['boxing documentary', 'Mike Tyson', 'Muhammad Ali', 'Floyd Mayweather', 'Manny Pacquiao', 'Canelo Alvarez', 'Tyson Fury', 'Anthony Joshua', 'heavyweight champion', 'boxer documentary', 'Oleksandr Usyk', 'Sugar Ray Leonard', 'Joe Frazier', 'George Foreman', 'Roy Jones', 'Golovkin', 'prizefighter', 'world title fight', 'Evander Holyfield', 'Lennox Lewis', 'Marvin Hagler', 'Thomas Hearns', 'Roberto Duran', 'Oscar De La Hoya', 'Bernard Hopkins', 'Joe Calzaghe', 'Naseem Hamed', 'Ricky Hatton', 'Julio Cesar Chavez', 'Vasyl Lomachenko', 'Deontay Wilder', 'Gervonta Davis', 'Ryan Garcia', 'Devin Haney', 'Terence Crawford', 'Errol Spence', 'Naoya Inoue', 'Jake Paul', 'Katie Taylor', 'Claressa Shields', 'Amir Khan', 'Chris Eubank', 'Nigel Benn', 'Jack Johnson boxer', 'Rocky Marciano', 'Sonny Liston', 'Jake LaMotta', 'Sugar Ray Robinson', 'Rumble in the Jungle', 'Thrilla in Manila', 'Golden Gloves', 'amateur boxing', 'boxing gym', 'Olympic boxing', 'Don King', 'Klitschko', 'Cus D\'Amato', 'Teddy Atlas', 'The Contender', 'Mayweather vs Pacquiao', 'female boxer', 'Mexican boxing', 'boxing trainer', 'Joshua vs Ruiz', 'Fury vs Wilder'],
    relevant: /box(ing|er)|heavyweight|prizefight|title fight|knockout|Tyson|Muhammad Ali|Mayweather|Pacquiao|Foreman|Frazier|Holyfield|Lennox Lewis|Hagler|De La Hoya|Canelo|Fury|Joshua|Klitschko|Usyk|Wilder|Hopkins|Calzaghe|Hamed|Hatton|Marciano|Liston|LaMotta|Don King|Golden Gloves|\bring\b/i,
    exclude: new RegExp(NOT_WWE.source + '|\\bUFC\\b|\\bMMA\\b|mixed martial', 'i'),
  },
  football: {
    name: 'Football',
    keywords: ['soccer', 'association football', 'football (soccer)', 'fifa world cup', 'premier league', 'la liga', 'champions league', 'footballer', 'soccer player', 'football club'],
    queries: ['football documentary', 'soccer documentary', 'World Cup documentary', 'Lionel Messi', 'Cristiano Ronaldo', 'Diego Maradona', 'Pele', 'Premier League documentary', 'Champions League documentary', 'FC Barcelona documentary', 'Real Madrid documentary', 'Manchester United documentary', 'Liverpool documentary', 'Manchester City documentary', 'Arsenal documentary', 'Zinedine Zidane', 'David Beckham', 'Neymar', 'FIFA', 'All or Nothing', 'Welcome to Wrexham', 'Sunderland Til I Die', 'Take Us Home', 'Ronaldinho', 'Cruyff', 'Mbappe', 'Haaland', 'Juventus documentary', 'Bayern Munich documentary', 'Zlatan Ibrahimovic', 'Mohamed Salah', 'Kevin De Bruyne', 'Pep Guardiola', 'Alex Ferguson', 'Jose Mourinho', 'Jurgen Klopp', 'Arsene Wenger', 'Leicester City', 'Tottenham documentary', 'Chelsea documentary', 'AC Milan documentary', 'Inter Milan documentary', 'PSG documentary', 'Borussia Dortmund', 'Ajax documentary', 'Brazil national team', 'Argentina national team', 'England national team', 'Germany national team', 'Euro 2020', 'World Cup 2022', 'Qatar World Cup', 'World Cup 2018', 'World Cup 2014', 'Copa America', 'Leeds United', 'Everton documentary', 'Newcastle United', 'Celtic Rangers', 'Atletico Madrid', 'Eric Cantona', 'Thierry Henry', 'Roberto Baggio', 'Paolo Maldini', 'Ronaldo Nazario', 'George Best', 'Andrea Pirlo', 'Gianluigi Buffon', 'Xavi Iniesta', 'Womens World Cup', 'Lionesses', 'football hooligans', 'Football Leaks', 'FIFA Uncovered', 'football agent', 'football academy', 'transfer window', 'Messi Barcelona', 'Wayne Rooney', 'Steven Gerrard', 'Frank Lampard', 'Roy Keane', 'Paul Gascoigne', 'Gareth Southgate', 'Harry Kane', 'Vinicius Junior', 'Lamine Yamal', 'Jude Bellingham', 'Antoine Griezmann', 'Karim Benzema', 'Luis Suarez', 'Robert Lewandowski', 'Gerd Muller', 'Franz Beckenbauer', 'Michel Platini', 'Socrates Brazilian', 'Garrincha', 'Eusebio', 'Bobby Moore', 'Bobby Charlton', 'Munich air disaster', 'Hillsborough', 'Heysel', 'Class of 92', 'Premier League 25', 'Arsenal Invincibles', 'Istanbul 2005', 'Spain Golden generation', 'Tiki-taka', 'Boca Juniors', 'River Plate', 'Flamengo', 'Santos FC', 'Galatasaray', 'Besiktas', 'Africa Cup of Nations', 'Egypt football', 'Morocco World Cup', 'Senegal football'],
    relevant: /football|soccer|world cup|premier league|champions league|\bFIFA\b|striker|goalkeeper|footballer|la liga|serie a|bundesliga|Barcelona|Real Madrid|Manchester|Liverpool|Arsenal|Chelsea|Juventus|Messi|Ronaldo|Maradona|Pel[eé]\b|Beckham|Neymar|Zidane|Mbapp|Haaland|Salah|Wrexham|Sunderland|Leicester|Mourinho|Klopp|Guardiola|Ferguson|Wenger|Tottenham|Ajax|Dortmund|Bayern/i,
    exclude: new RegExp(NOT_WWE.source + '|\\bNFL\\b|american football|quarterback|super bowl|college football|touchdown|gridiron|high school football|friday night|rugby|australian rules', 'i'),
  },
  nba: {
    name: 'NBA',
    keywords: ['basketball', 'nba', 'basketball player', 'basketball team', 'nba basketball', 'streetball', 'wnba'],
    queries: ['NBA documentary', 'basketball documentary', 'Michael Jordan', 'The Last Dance', 'Kobe Bryant', 'LeBron James', 'Stephen Curry', 'Magic Johnson', 'Larry Bird', 'Dream Team', 'Allen Iverson', 'Lakers documentary', 'Celtics documentary', 'Chicago Bulls documentary', 'Shaquille O\'Neal', 'Kevin Durant', 'Tim Duncan', 'Wilt Chamberlain', 'Bill Russell', 'Steph Curry', 'NBA Finals', 'Dennis Rodman', 'Reggie Miller', 'Dirk Nowitzki', 'Kawhi Leonard', 'James Harden', 'Giannis Antetokounmpo', 'Luka Doncic', 'Dwyane Wade', 'Chris Paul', 'Vince Carter', 'Isiah Thomas', 'Bad Boys Pistons', 'Kareem Abdul-Jabbar', 'Julius Erving', 'Charles Barkley', 'Scottie Pippen', 'Draymond Green', 'Golden State Warriors', 'Miami Heat', 'San Antonio Spurs', 'Toronto Raptors', 'Boston Celtics', 'New York Knicks', 'Clippers', 'Phoenix Suns', 'Hoop Dreams', 'More Than a Game', 'NBA Draft', 'slam dunk', 'AND1 streetball', 'WNBA', 'Dream Team 1992', 'Pistol Pete Maravich', 'Yao Ming', 'Jeremy Lin', 'Linsanity', 'Kyrie Irving', 'Carmelo Anthony', 'Russell Westbrook', 'Zion Williamson', 'Victor Wembanyama', 'Ja Morant', 'Derrick Rose', 'Penny Hardaway', 'Tracy McGrady', 'Steve Nash', 'Manu Ginobili', 'Pau Gasol', 'Dikembe Mutombo', 'Hakeem Olajuwon', 'Patrick Ewing', 'Karl Malone', 'John Stockton', 'Moses Malone', 'Bob Cousy', 'Jerry West', 'Elgin Baylor', 'Harlem Globetrotters', 'high school basketball', 'college basketball March Madness', 'Lonzo Ball', 'LaMelo Ball', 'Bronny James', 'Sixers The Process', 'Kobe Bryant Muse', 'Bulls dynasty', 'Showtime Lakers', 'Winning Time'],
    relevant: /\bNBA\b|basketball|\bWNBA\b|hoops|lakers|celtics|chicago bulls|dream team|Michael Jordan|Kobe|LeBron|Curry|Magic Johnson|Larry Bird|Iverson|Shaq|Durant|Duncan|Chamberlain|Bill Russell|Rodman|Warriors|Knicks|Spurs|Raptors|Pistons|Heat\b|Globetrotters/i,
    exclude: new RegExp(NOT_WWE.source + '|youngboy|\\bNFL\\b', 'i'),
  },
  tennis: {
    name: 'Tennis',
    keywords: ['tennis', 'tennis player', 'wimbledon', 'grand slam', 'tennis tournament'],
    queries: ['tennis documentary', 'Wimbledon', 'Roger Federer', 'Rafael Nadal', 'Novak Djokovic', 'Serena Williams', 'Bjorn Borg', 'John McEnroe', 'Pete Sampras', 'Andre Agassi', 'Break Point', 'Grand Slam', 'Roland Garros', 'Andy Murray', 'Venus Williams', 'Steffi Graf', 'Martina Navratilova', 'Carlos Alcaraz', 'Naomi Osaka', 'US Open tennis'],
    relevant: /tennis|wimbledon|grand slam|roland.?garros|us open|\bATP\b|\bWTA\b|Federer|Nadal|Djokovic|Serena|Venus Williams|Sampras|Agassi|McEnroe|Borg|Murray|Osaka|Alcaraz/i,
    exclude: new RegExp(NOT_WWE.source + '|table tennis', 'i'),
  },
};

// ---------- Catalogue definitions ----------
// filter = extra check on the item. Rows never repeat the same titles (UFC best excludes legends).
const isOldLegend = (m) => parseInt(m._date.slice(0, 4), 10) <= 1989 || WWE_OLD_RE.test(m._text);
const CATALOGS = [
  { id: 'sv-ufc-best', sport: 'ufc', name: 'All Time Best UFC Events', mode: 'best', filter: (m) => !LEGENDS_RE.test(m._text) },
  { id: 'sv-ufc-recent', sport: 'ufc', name: 'Recently Added UFC Events', mode: 'recent' },
  { id: 'sv-ufc-legends', sport: 'ufc', name: 'UFC Legends', mode: 'best', filter: (m) => LEGENDS_RE.test(m._text) },
  { id: 'sv-boxing-best', sport: 'boxing', name: 'All Time Best Boxing Events', mode: 'best' },
  { id: 'sv-boxing-recent', sport: 'boxing', name: 'Recently Added Boxing Events', mode: 'recent' },
  { id: 'sv-wwe-undertaker', sport: 'wwe', name: 'Best WWE Matches - Undertaker Era', mode: 'best', from: 1990, to: 2020, filter: (m) => !isOldLegend(m) },
  { id: 'sv-wwe-legends', sport: 'wwe', name: 'Best WWE Matches - Old Famous Wrestlers', mode: 'best', filter: isOldLegend },
];

// Documentaries: UFC and boxing = one mixed row; other sports = series row + movie row
for (const [key, d] of Object.entries(DOCS)) {
  if (d.merged) {
    CATALOGS.push({ id: `sv-doc-${key}`, sport: `doc-${key}-all`, type: 'series', name: `${d.name} Documentaries (Series & Movies)`, mode: 'popular' });
  } else {
    CATALOGS.push(
      { id: `sv-doc-${key}-series`, sport: `doc-${key}-series`, type: 'series', name: `${d.name} Documentary Series`, mode: 'popular' },
      { id: `sv-doc-${key}-movies`, sport: `doc-${key}-movie`, type: 'movie', name: `${d.name} Documentary Movies`, mode: 'popular' }
    );
  }
}

const manifest = {
  id: 'community.sportvault',
  version: VERSION,
  name: 'SportVault',
  description: 'UFC, boxing and WWE legends events, plus documentaries for UFC, boxing, football, NBA and tennis.',
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

async function keywordIds(queries, perQuery) {
  const ids = new Set();
  for (const q of queries) {
    const r = await tmdb('/search/keyword', { query: q });
    (r && r.results ? r.results.slice(0, perQuery) : []).forEach((k) => ids.add(k.id));
  }
  return [...ids];
}

const hasBadGenre = (m) => (m.genre_ids || []).some((g) => BAD_GENRES.includes(g));

// ---------- Events (UFC, boxing, WWE) ----------
async function collectCandidates(sport) {
  const cfg = SPORTS[sport];
  const found = new Map();
  const today = new Date().toISOString().slice(0, 10);

  // 1) keyword ids -> discover (animation etc. excluded up front)
  const kwIds = await keywordIds(cfg.keywordQueries, 3);
  if (kwIds.length) {
    const kw = kwIds.join('|');
    for (const sortBy of ['release_date.desc', 'vote_count.desc', 'popularity.desc']) {
      for (let page = 1; page <= 5; page++) {
        const r = await tmdb('/discover/movie', {
          with_keywords: kw,
          without_genres: BAD_GENRES.join(','),
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
    (m) => m.title && cfg.isEvent(m.title) && !hasBadGenre(m) && cfg.relevant(m) && m.release_date && m.release_date <= today
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
async function docItems(sport, isTv) {
  const cfg = DOCS[sport];
  const found = new Map();
  const fromDiscover = new Set();
  const today = new Date().toISOString().slice(0, 10);
  const endpoint = isTv ? '/search/tv' : '/search/movie';

  // 1) documentary-genre discover by sport keywords (finds titles search would miss)
  const kwIds = await keywordIds(cfg.keywords, 2);
  if (kwIds.length) {
    const kw = kwIds.join('|');
    for (const sortBy of ['popularity.desc', 'vote_count.desc', 'primary_release_date.desc']) {
      const sort = isTv ? sortBy.replace('primary_release_date', 'first_air_date') : sortBy;
      for (let page = 1; page <= 5; page++) {
        const r = await tmdb(isTv ? '/discover/tv' : '/discover/movie', {
          with_genres: 99,
          with_keywords: kw,
          sort_by: sort,
          include_adult: 'false',
          page,
        });
        if (!r || !r.results || !r.results.length) break;
        r.results.forEach((m) => { found.set(m.id, m); fromDiscover.add(m.id); });
        if (page >= (r.total_pages || 1)) break;
      }
    }
  }

  // 2) name/title searches (first 8 queries get 2 pages)
  for (let i = 0; i < cfg.queries.length; i++) {
    const pages = i < 8 ? 2 : 1;
    for (let page = 1; page <= pages; page++) {
      const r = await tmdb(endpoint, { query: cfg.queries[i], page, include_adult: 'false' });
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
      (fromDiscover.has(m.id) || cfg.relevant.test(text)) &&
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
  return items.filter(Boolean);
}

async function collectDocs(key) {
  const [, sport, kind] = key.split('-'); // doc-ufc-all / doc-football-movie / doc-nba-series
  let items = [];
  if (kind === 'all') items = (await docItems(sport, false)).concat(await docItems(sport, true));
  else items = await docItems(sport, kind === 'series');
  const seen = new Set();
  return items.filter((x) => !seen.has(x.id) && seen.add(x.id));
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
      console.log(`[${sport}] loaded ${items.length} titles`);
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

    // /catalog/<type>/<id>.json  or  /catalog/<type>/<id>/skip=100.json
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
  // warm the cache one pool at a time (gentle on TMDB) and refresh in the background
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
