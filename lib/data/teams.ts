// Master NHL team list with arena geographic data.
// Coordinates approximated to arena, altitudes in feet, IANA timezones.
export interface SeedTeam {
  nhl_team_id: number;
  name: string;
  abbreviation: string;
  conference: 'Eastern' | 'Western';
  division: 'Atlantic' | 'Metropolitan' | 'Central' | 'Pacific';
  home_arena: string;
  latitude: number;
  longitude: number;
  altitude_feet: number;
  time_zone: string;
  // Seeded power ratings (rolling xGF/60 baseline). League avg ≈ 2.95.
  offense: number;
  defense: number;
}

export const SEED_TEAMS: SeedTeam[] = [
  // Atlantic
  { nhl_team_id: 1, name: 'Boston Bruins', abbreviation: 'BOS', conference: 'Eastern', division: 'Atlantic', home_arena: 'TD Garden', latitude: 42.3662, longitude: -71.0621, altitude_feet: 19, time_zone: 'America/New_York', offense: 3.05, defense: 2.65 },
  { nhl_team_id: 2, name: 'Buffalo Sabres', abbreviation: 'BUF', conference: 'Eastern', division: 'Atlantic', home_arena: 'KeyBank Center', latitude: 42.8750, longitude: -78.8765, altitude_feet: 600, time_zone: 'America/New_York', offense: 2.85, defense: 3.10 },
  { nhl_team_id: 3, name: 'Detroit Red Wings', abbreviation: 'DET', conference: 'Eastern', division: 'Atlantic', home_arena: 'Little Caesars Arena', latitude: 42.3411, longitude: -83.0553, altitude_feet: 620, time_zone: 'America/Detroit', offense: 2.95, defense: 3.05 },
  { nhl_team_id: 4, name: 'Florida Panthers', abbreviation: 'FLA', conference: 'Eastern', division: 'Atlantic', home_arena: 'Amerant Bank Arena', latitude: 26.1585, longitude: -80.3251, altitude_feet: 12, time_zone: 'America/New_York', offense: 3.25, defense: 2.55 },
  { nhl_team_id: 5, name: 'Montreal Canadiens', abbreviation: 'MTL', conference: 'Eastern', division: 'Atlantic', home_arena: 'Bell Centre', latitude: 45.4965, longitude: -73.5694, altitude_feet: 200, time_zone: 'America/Montreal', offense: 2.75, defense: 3.15 },
  { nhl_team_id: 6, name: 'Ottawa Senators', abbreviation: 'OTT', conference: 'Eastern', division: 'Atlantic', home_arena: 'Canadian Tire Centre', latitude: 45.2969, longitude: -75.9281, altitude_feet: 250, time_zone: 'America/Toronto', offense: 2.95, defense: 3.00 },
  { nhl_team_id: 7, name: 'Tampa Bay Lightning', abbreviation: 'TBL', conference: 'Eastern', division: 'Atlantic', home_arena: 'Amalie Arena', latitude: 27.9425, longitude: -82.4519, altitude_feet: 14, time_zone: 'America/New_York', offense: 3.15, defense: 2.85 },
  { nhl_team_id: 8, name: 'Toronto Maple Leafs', abbreviation: 'TOR', conference: 'Eastern', division: 'Atlantic', home_arena: 'Scotiabank Arena', latitude: 43.6435, longitude: -79.3791, altitude_feet: 280, time_zone: 'America/Toronto', offense: 3.30, defense: 2.80 },
  // Metropolitan
  { nhl_team_id: 9, name: 'Carolina Hurricanes', abbreviation: 'CAR', conference: 'Eastern', division: 'Metropolitan', home_arena: 'Lenovo Center', latitude: 35.8033, longitude: -78.7218, altitude_feet: 360, time_zone: 'America/New_York', offense: 3.20, defense: 2.60 },
  { nhl_team_id: 10, name: 'Columbus Blue Jackets', abbreviation: 'CBJ', conference: 'Eastern', division: 'Metropolitan', home_arena: 'Nationwide Arena', latitude: 39.9694, longitude: -83.0064, altitude_feet: 760, time_zone: 'America/New_York', offense: 2.80, defense: 3.20 },
  { nhl_team_id: 11, name: 'New Jersey Devils', abbreviation: 'NJD', conference: 'Eastern', division: 'Metropolitan', home_arena: 'Prudential Center', latitude: 40.7336, longitude: -74.1711, altitude_feet: 100, time_zone: 'America/New_York', offense: 3.10, defense: 2.85 },
  { nhl_team_id: 12, name: 'New York Islanders', abbreviation: 'NYI', conference: 'Eastern', division: 'Metropolitan', home_arena: 'UBS Arena', latitude: 40.7167, longitude: -73.7283, altitude_feet: 26, time_zone: 'America/New_York', offense: 2.90, defense: 2.95 },
  { nhl_team_id: 13, name: 'New York Rangers', abbreviation: 'NYR', conference: 'Eastern', division: 'Metropolitan', home_arena: 'Madison Square Garden', latitude: 40.7505, longitude: -73.9934, altitude_feet: 33, time_zone: 'America/New_York', offense: 3.15, defense: 2.75 },
  { nhl_team_id: 14, name: 'Philadelphia Flyers', abbreviation: 'PHI', conference: 'Eastern', division: 'Metropolitan', home_arena: 'Wells Fargo Center', latitude: 39.9012, longitude: -75.1719, altitude_feet: 39, time_zone: 'America/New_York', offense: 2.85, defense: 3.05 },
  { nhl_team_id: 15, name: 'Pittsburgh Penguins', abbreviation: 'PIT', conference: 'Eastern', division: 'Metropolitan', home_arena: 'PPG Paints Arena', latitude: 40.4395, longitude: -79.9892, altitude_feet: 760, time_zone: 'America/New_York', offense: 3.00, defense: 3.00 },
  { nhl_team_id: 16, name: 'Washington Capitals', abbreviation: 'WSH', conference: 'Eastern', division: 'Metropolitan', home_arena: 'Capital One Arena', latitude: 38.8981, longitude: -77.0209, altitude_feet: 25, time_zone: 'America/New_York', offense: 3.05, defense: 2.90 },
  // Central
  { nhl_team_id: 17, name: 'Chicago Blackhawks', abbreviation: 'CHI', conference: 'Western', division: 'Central', home_arena: 'United Center', latitude: 41.8807, longitude: -87.6742, altitude_feet: 590, time_zone: 'America/Chicago', offense: 2.65, defense: 3.30 },
  { nhl_team_id: 18, name: 'Colorado Avalanche', abbreviation: 'COL', conference: 'Western', division: 'Central', home_arena: 'Ball Arena', latitude: 39.7487, longitude: -105.0077, altitude_feet: 5280, time_zone: 'America/Denver', offense: 3.35, defense: 2.70 },
  { nhl_team_id: 19, name: 'Dallas Stars', abbreviation: 'DAL', conference: 'Western', division: 'Central', home_arena: 'American Airlines Center', latitude: 32.7905, longitude: -96.8104, altitude_feet: 430, time_zone: 'America/Chicago', offense: 3.20, defense: 2.65 },
  { nhl_team_id: 20, name: 'Minnesota Wild', abbreviation: 'MIN', conference: 'Western', division: 'Central', home_arena: 'Xcel Energy Center', latitude: 44.9447, longitude: -93.1011, altitude_feet: 700, time_zone: 'America/Chicago', offense: 3.00, defense: 2.90 },
  { nhl_team_id: 21, name: 'Nashville Predators', abbreviation: 'NSH', conference: 'Western', division: 'Central', home_arena: 'Bridgestone Arena', latitude: 36.1593, longitude: -86.7785, altitude_feet: 550, time_zone: 'America/Chicago', offense: 2.90, defense: 2.95 },
  { nhl_team_id: 22, name: 'St. Louis Blues', abbreviation: 'STL', conference: 'Western', division: 'Central', home_arena: 'Enterprise Center', latitude: 38.6268, longitude: -90.2026, altitude_feet: 465, time_zone: 'America/Chicago', offense: 2.95, defense: 2.95 },
  { nhl_team_id: 23, name: 'Utah Mammoth', abbreviation: 'UTA', conference: 'Western', division: 'Central', home_arena: 'Delta Center', latitude: 40.7683, longitude: -111.9011, altitude_feet: 4226, time_zone: 'America/Denver', offense: 2.90, defense: 3.00 },
  { nhl_team_id: 24, name: 'Winnipeg Jets', abbreviation: 'WPG', conference: 'Western', division: 'Central', home_arena: 'Canada Life Centre', latitude: 49.8927, longitude: -97.1435, altitude_feet: 760, time_zone: 'America/Winnipeg', offense: 3.05, defense: 2.75 },
  // Pacific
  { nhl_team_id: 25, name: 'Anaheim Ducks', abbreviation: 'ANA', conference: 'Western', division: 'Pacific', home_arena: 'Honda Center', latitude: 33.8078, longitude: -117.8765, altitude_feet: 158, time_zone: 'America/Los_Angeles', offense: 2.70, defense: 3.20 },
  { nhl_team_id: 26, name: 'Calgary Flames', abbreviation: 'CGY', conference: 'Western', division: 'Pacific', home_arena: 'Scotiabank Saddledome', latitude: 51.0374, longitude: -114.0519, altitude_feet: 3438, time_zone: 'America/Edmonton', offense: 2.85, defense: 3.05 },
  { nhl_team_id: 27, name: 'Edmonton Oilers', abbreviation: 'EDM', conference: 'Western', division: 'Pacific', home_arena: 'Rogers Place', latitude: 53.5469, longitude: -113.4977, altitude_feet: 2200, time_zone: 'America/Edmonton', offense: 3.35, defense: 2.95 },
  { nhl_team_id: 28, name: 'Los Angeles Kings', abbreviation: 'LAK', conference: 'Western', division: 'Pacific', home_arena: 'Crypto.com Arena', latitude: 34.0430, longitude: -118.2673, altitude_feet: 280, time_zone: 'America/Los_Angeles', offense: 2.95, defense: 2.80 },
  { nhl_team_id: 29, name: 'San Jose Sharks', abbreviation: 'SJS', conference: 'Western', division: 'Pacific', home_arena: 'SAP Center', latitude: 37.3327, longitude: -121.9012, altitude_feet: 80, time_zone: 'America/Los_Angeles', offense: 2.60, defense: 3.35 },
  { nhl_team_id: 30, name: 'Seattle Kraken', abbreviation: 'SEA', conference: 'Western', division: 'Pacific', home_arena: 'Climate Pledge Arena', latitude: 47.6221, longitude: -122.3540, altitude_feet: 120, time_zone: 'America/Los_Angeles', offense: 2.85, defense: 3.00 },
  { nhl_team_id: 31, name: 'Vancouver Canucks', abbreviation: 'VAN', conference: 'Western', division: 'Pacific', home_arena: 'Rogers Arena', latitude: 49.2778, longitude: -123.1089, altitude_feet: 25, time_zone: 'America/Vancouver', offense: 3.00, defense: 2.85 },
  { nhl_team_id: 32, name: 'Vegas Golden Knights', abbreviation: 'VGK', conference: 'Western', division: 'Pacific', home_arena: 'T-Mobile Arena', latitude: 36.1028, longitude: -115.1786, altitude_feet: 2030, time_zone: 'America/Los_Angeles', offense: 3.15, defense: 2.70 },
];

// Sample starting goalies — minimal seed.
export const SEED_GOALIES: Array<{
  nhl_player_id: number;
  name: string;
  team_abbreviation: string;
  gsax_l10: number;   // cumulative GSAx over last ~10 starts (realistic: -2.0 to +2.5)
  hd_sv_pct: number;
  sv_pct: number;
}> = [
  { nhl_player_id: 8475883, name: 'Andrei Vasilevskiy', team_abbreviation: 'TBL', gsax_l10: 1.2, hd_sv_pct: 0.832, sv_pct: 0.915 },
  { nhl_player_id: 8478492, name: 'Connor Hellebuyck', team_abbreviation: 'WPG', gsax_l10: 2.4, hd_sv_pct: 0.842, sv_pct: 0.923 },
  { nhl_player_id: 8478406, name: 'Igor Shesterkin', team_abbreviation: 'NYR', gsax_l10: 1.6, hd_sv_pct: 0.836, sv_pct: 0.918 },
  { nhl_player_id: 8475660, name: 'Sergei Bobrovsky', team_abbreviation: 'FLA', gsax_l10: 1.8, hd_sv_pct: 0.838, sv_pct: 0.919 },
  { nhl_player_id: 8476412, name: 'Jake Oettinger', team_abbreviation: 'DAL', gsax_l10: 0.9, hd_sv_pct: 0.828, sv_pct: 0.912 },
  { nhl_player_id: 8478048, name: 'Jeremy Swayman', team_abbreviation: 'BOS', gsax_l10: 0.4, hd_sv_pct: 0.825, sv_pct: 0.910 },
  { nhl_player_id: 8474889, name: 'Stuart Skinner', team_abbreviation: 'EDM', gsax_l10: -0.6, hd_sv_pct: 0.815, sv_pct: 0.902 },
  { nhl_player_id: 8480925, name: 'Logan Thompson', team_abbreviation: 'WSH', gsax_l10: 1.7, hd_sv_pct: 0.838, sv_pct: 0.920 },
  { nhl_player_id: 8476945, name: 'Linus Ullmark', team_abbreviation: 'OTT', gsax_l10: 0.5, hd_sv_pct: 0.826, sv_pct: 0.910 },
  { nhl_player_id: 8475831, name: 'Anthony Stolarz', team_abbreviation: 'TOR', gsax_l10: 1.9, hd_sv_pct: 0.838, sv_pct: 0.920 },
  { nhl_player_id: 8478007, name: 'Mackenzie Blackwood', team_abbreviation: 'COL', gsax_l10: 0.8, hd_sv_pct: 0.828, sv_pct: 0.913 },
  { nhl_player_id: 8475311, name: 'Frederik Andersen', team_abbreviation: 'CAR', gsax_l10: 1.3, hd_sv_pct: 0.833, sv_pct: 0.916 },
  { nhl_player_id: 8480012, name: 'Filip Gustavsson', team_abbreviation: 'MIN', gsax_l10: 1.0, hd_sv_pct: 0.830, sv_pct: 0.914 },
  { nhl_player_id: 8477970, name: 'Adin Hill', team_abbreviation: 'VGK', gsax_l10: 0.6, hd_sv_pct: 0.827, sv_pct: 0.911 },
  { nhl_player_id: 8474651, name: 'Samuel Montembeault', team_abbreviation: 'MTL', gsax_l10: -0.3, hd_sv_pct: 0.820, sv_pct: 0.906 },
  { nhl_player_id: 8477967, name: 'Karel Vejmelka', team_abbreviation: 'UTA', gsax_l10: 0.2, hd_sv_pct: 0.823, sv_pct: 0.909 },
];

export const LEAGUE_AVG_XGF_PER_60 = 2.95;
export const LEAGUE_AVG_HD_SV_PCT = 0.825;
