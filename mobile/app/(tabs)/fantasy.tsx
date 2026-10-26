import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { F } from '@/constants/fonts';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FantasyPlayer, saveFantasyRoster, loadFantasyRoster } from '@/hooks/use-fantasy-roster';
import { EspnLoginWebView } from '@/components/espn-login-webview';
import { IconSymbol } from '@/components/ui/icon-symbol';

import { API } from '@/constants/api';

type Provider = 'yahoo' | 'espn';

// Sentinel key for the synthetic league used to render the device-cached roster
// before (or instead of) a live server league. Guards skip network calls for it.
const CACHED_LEAGUE_KEY = '__cached__';

interface League {
  key: string;
  name: string;
  sport: string;
  season: string | number;
  num_teams?: number;
  provider: Provider;
}

const SPORT_LABELS: Record<string, string> = {
  nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL',
  ffl: 'NFL', fba: 'NBA', flb: 'MLB', fhl: 'NHL',
};

const SPORT_COLORS: Record<string, string> = {
  nfl: '#013369', nba: '#17408B', mlb: '#002D72', nhl: '#003087',
  ffl: '#013369', fba: '#17408B', flb: '#002D72', fhl: '#003087',
};

export default function FantasyTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#000' : '#f2f2f7';
  const card = dark ? '#1c1c1e' : '#fff';
  const text = dark ? '#fff' : '#000';
  const sub = dark ? '#8e8e93' : '#6e6e73';
  const border = dark ? '#2c2c2e' : '#e5e5e5';

  const [yahooConnected, setYahooConnected] = useState(false);
  const [espnConnected, setEspnConnected] = useState(false);
  const [yahooLeagues, setYahooLeagues] = useState<League[]>([]);
  const [espnLeagues, setEspnLeagues] = useState<League[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [roster, setRoster] = useState<FantasyPlayer[]>([]);
  const [matchup, setMatchup] = useState<import('@/hooks/use-fantasy-roster').FantasyMatchup | null>(null);
  const [loading, setLoading] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showEspnForm, setShowEspnForm] = useState(false);
  const [showEspnWebView, setShowEspnWebView] = useState(false);
  const [espnS2, setEspnS2] = useState('');
  const [espnSwid, setEspnSwid] = useState('');
  const [showAddLeague, setShowAddLeague] = useState(false);
  const [addLeagueId, setAddLeagueId] = useState('');
  const [addLeagueSport, setAddLeagueSport] = useState<'nfl' | 'nba' | 'mlb' | 'nhl'>('nfl');
  const [addingLeague, setAddingLeague] = useState(false);
  const [addLeagueError, setAddLeagueError] = useState('');
  const [connectError, setConnectError] = useState('');
  const [connecting, setConnecting] = useState(false);

  const [todayGames, setTodayGames] = useState<Array<{
    id: string; label: string; awayAbbr: string; homeAbbr: string; state: string;
    myPlayers: FantasyPlayer[];
  }>>([]);
  const [gamesLoading, setGamesLoading] = useState(false);

  const fantHdrX = useSharedValue(-40);
  const fantHdrOpacity = useSharedValue(0);
  const fantRingScale = useSharedValue(0.5);
  useEffect(() => {
    fantHdrX.value = withSpring(0, { damping: 20, stiffness: 150 });
    fantHdrOpacity.value = withTiming(1, { duration: 350 });
    fantRingScale.value = withSpring(1, { damping: 14, stiffness: 100 });
  }, []);
  const fantHdrStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: fantHdrX.value }],
    opacity: fantHdrOpacity.value,
  }));
  const fantRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fantRingScale.value }],
    opacity: fantHdrOpacity.value,
  }));

  useEffect(() => { checkStatus(); }, []);

  // Restore the last-used roster from the persisted store so the lineup shows
  // immediately on open — even if the server has no league registered yet
  // (e.g. a fresh Fly deploy). We synthesize a "cached" league so the roster
  // section renders right away; once the real league list loads, effect #2
  // swaps in the live league so refresh/polling resumes.
  const restoredRef = useRef(false);
  useEffect(() => {
    loadFantasyRoster().then(store => {
      if (store && store.players?.length) {
        setRoster(store.players);
        setMatchup(store.matchup ?? null);
        // Only synthesize if nothing is selected yet — don't clobber a real pick.
        setSelectedLeague(prev => prev ?? {
          key: CACHED_LEAGUE_KEY,
          name: store.leagueName,
          sport: store.sport,
          provider: store.provider as Provider,
          season: '',
          num_teams: 0,
        });
      }
    });
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    // Only auto-swap if we're currently showing the synthetic cached league
    // (or nothing). Never override a real, user-tapped league.
    if (selectedLeague && selectedLeague.key !== CACHED_LEAGUE_KEY) return;
    const allLeagues = [...espnLeagues, ...yahooLeagues];
    if (allLeagues.length === 0) return;
    loadFantasyRoster().then(store => {
      // Match the saved roster to a fetched league by name + sport + provider.
      const match = store && (
        allLeagues.find(l =>
          l.name === store.leagueName &&
          l.sport === store.sport &&
          l.provider === store.provider
        ) ?? allLeagues.find(l => l.provider === store.provider && l.sport === store.sport)
      );
      if (match) {
        restoredRef.current = true;
        loadRoster(match);
      }
    });
  }, [espnLeagues, yahooLeagues, selectedLeague]);

  async function checkStatus() {
    setLoading(true);
    try {
      const [ys, es] = await Promise.allSettled([
        fetch(`${API}/yahoo/status`).then(r => r.json()),
        fetch(`${API}/espn/fantasy/status`).then(r => r.json()),
      ]);
      const yConn = ys.status === 'fulfilled' && ys.value.connected;
      const eConn = es.status === 'fulfilled' && es.value.connected;
      setYahooConnected(yConn);
      setEspnConnected(eConn);
      if (yConn) fetchYahooLeagues();
      if (eConn) fetchEspnLeagues();
    } finally {
      setLoading(false);
    }
  }

  async function loadTodayGames(league: League, players: FantasyPlayer[]) {
    setGamesLoading(true);
    try {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const { games } = await fetch(`${API}/sports/${league.sport}/scores?date=${yyyy}-${mm}-${dd}`).then(r => r.json());
      const matched = (games || [])
        .map((g: any) => {
          const awayAbbr: string = g.away?.team?.abbreviation || '';
          const homeAbbr: string = g.home?.team?.abbreviation || '';
          const myPlayers = players.filter(p =>
            p.team && (
              p.team.toUpperCase() === awayAbbr.toUpperCase() ||
              p.team.toUpperCase() === homeAbbr.toUpperCase()
            )
          );
          return {
            id: g.id,
            label: g.shortName || `${awayAbbr} @ ${homeAbbr}`,
            awayAbbr, homeAbbr,
            state: g.status?.state || 'pre',
            myPlayers,
          };
        })
        .filter((g: any) => g.myPlayers.length > 0);
      setTodayGames(matched);
    } catch {}
    finally { setGamesLoading(false); }
  }

  // Cache the Yahoo auth URL on mount so the click handler can navigate
  // SYNCHRONOUSLY — popup blockers fire when the navigation happens after
  // an async fetch (browsers don't consider it user-initiated). Pre-fetching
  // means the click→open happens in the same JS turn.
  const [yahooAuthUrl, setYahooAuthUrl] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${API}/yahoo/auth`)
      .then(r => r.json())
      .then(d => d?.url && setYahooAuthUrl(d.url))
      .catch(() => {});
  }, []);

  async function connectYahoo() {
    try {
      // Use cached URL if available (synchronous → no popup blocker on web).
      // Otherwise fetch on the fly (might be blocked on web but works native).
      const url = yahooAuthUrl
        ?? (await fetch(`${API}/yahoo/auth`).then(r => r.json())).url;
      if (!url) throw new Error('No URL');

      if (Platform.OS === 'web') {
        // Same-tab redirect — never blocked. After Yahoo auth they'll land
        // back at our redirect URI, then we re-check status on app reload.
        window.location.href = url;
      } else {
        // Native: open in system browser; OAuth redirect comes back via deep link
        await Linking.openURL(url);
      }
      setTimeout(checkStatus, 1500);
    } catch {
      Alert.alert('Error', 'Could not start Yahoo login');
    }
  }

  async function connectEspn() {
    if (!espnS2.trim() || !espnSwid.trim()) {
      setConnectError('Enter both espn_s2 and SWID values.');
      return;
    }
    setConnectError('');
    setConnecting(true);
    try {
      const res = await fetch(`${API}/espn/fantasy/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ espn_s2: espnS2.trim(), swid: espnSwid.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectError(data.error || 'Could not connect to ESPN');
        return;
      }
      setEspnConnected(true);
      setShowEspnForm(false);
      setConnectError('');
      fetchEspnLeagues();
    } catch {
      setConnectError('Could not reach server. Is the app server running?');
    } finally {
      setConnecting(false);
    }
  }

  async function addEspnLeague() {
    const id = addLeagueId.trim();
    if (!id) { setAddLeagueError('Paste your ESPN league ID first.'); return; }
    setAddLeagueError('');
    setAddingLeague(true);
    try {
      const res = await fetch(`${API}/espn/fantasy/add-league`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: id, sport: addLeagueSport }),
      });
      const data = await res.json();
      if (!res.ok) { setAddLeagueError(data.error || 'Could not add league'); return; }
      setAddLeagueId('');
      setAddLeagueError('');
      setShowAddLeague(false);
      fetchEspnLeagues();
    } catch {
      setAddLeagueError('Could not reach server. Is the app server running?');
    } finally {
      setAddingLeague(false);
    }
  }

  async function fetchYahooLeagues() {
    try {
      const { leagues } = await fetch(`${API}/yahoo/leagues`).then(r => r.json());
      setYahooLeagues((leagues || []).map((l: any) => ({
        key: l.league_key,
        name: l.name,
        sport: l.sport,
        season: l.season,
        num_teams: l.num_teams,
        provider: 'yahoo' as Provider,
      })));
    } catch {}
  }

  async function fetchEspnLeagues() {
    try {
      const res = await fetch(`${API}/espn/fantasy/leagues`);
      if (res.status === 401) { setEspnConnected(false); return; }
      const data = await res.json();
      let raw = Array.isArray(data.leagues) ? data.leagues : [];
      // Auto-discover the user's leagues from their SWID if none are stored yet,
      // so they never need to paste a league ID.
      if (raw.length === 0) {
        try {
          const disc = await fetch(`${API}/espn/fantasy/refresh-leagues`, { method: 'POST' });
          if (disc.ok) {
            const dd = await disc.json();
            if (Array.isArray(dd.leagues)) raw = dd.leagues;
          }
        } catch {}
      }
      setEspnLeagues(raw.map((l: any) => ({
        key: String(l.leagueId),
        name: l.name,
        sport: l.sport,
        season: l.season,
        num_teams: l.numTeams,
        provider: 'espn' as Provider,
      })));
    } catch {}
  }

  async function deleteLeague(league: League) {
    if (league.provider === 'espn') {
      await fetch(`${API}/espn/fantasy/leagues/${league.key}?sport=${league.sport}`, { method: 'DELETE' }).catch(() => {});
      setEspnLeagues(prev => prev.filter(l => l.key !== league.key));
    } else {
      setYahooLeagues(prev => prev.filter(l => l.key !== league.key));
    }
    if (selectedLeague?.key === league.key) { setSelectedLeague(null); setRoster([]); }
  }

  async function loadRoster(league: League) {
    // Synthetic cached league — there's no server endpoint for it. Just keep
    // the already-painted roster from the persisted store; never network-fetch.
    if (league.key === CACHED_LEAGUE_KEY) {
      setSelectedLeague(league);
      return;
    }
    setSelectedLeague(league);
    setRoster([]);
    setRosterLoading(true);
    try {
      const url = league.provider === 'yahoo'
        ? `${API}/yahoo/roster/${encodeURIComponent(league.key)}`
        : `${API}/espn/fantasy/${league.sport}/${league.key}/roster`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          Alert.alert(
            'ESPN Session Expired',
            'Your ESPN cookies have expired. Re-enter your espn_s2 and SWID values to reconnect.',
            [{ text: 'Reconnect', onPress: () => { setShowEspnForm(true); setEspnConnected(false); } }, { text: 'Cancel', style: 'cancel' }],
          );
        } else {
          Alert.alert('Error', data.error || 'Could not load roster');
        }
        return;
      }
      const players: FantasyPlayer[] = data.players || [];
      setRoster(players);
      setMatchup(data.matchup || null);
      // Persist to store so game screen can find these players
      await saveFantasyRoster({
        leagueName: league.name,
        sport: league.sport,
        provider: league.provider,
        players,
        matchup: data.matchup || null,
        savedAt: Date.now(),
      });
      await loadTodayGames(league, players);
    } catch {
      Alert.alert('Error', 'Could not load roster');
    } finally {
      setRosterLoading(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await checkStatus();
    if (selectedLeague) {
      await loadRoster(selectedLeague);
      await loadTodayGames(selectedLeague, roster);
    }
    setRefreshing(false);
  }

  // Auto-refresh on every "stale data" trigger: tab focus, app foreground,
  // midnight rollover, and a 45-second polling tick while a league is open.
  // No manual pull-to-refresh ever required.
  useAutoRefresh(
    () => { if (selectedLeague && selectedLeague.key !== CACHED_LEAGUE_KEY) loadRoster(selectedLeague); },
    { intervalMs: 45_000, enabled: !!selectedLeague && selectedLeague.key !== CACHED_LEAGUE_KEY }
  );

  const allLeagues = [...yahooLeagues, ...espnLeagues];
  const anyConnected = yahooConnected || espnConnected;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top']}>
    <ScrollView
      style={{ flex: 1, backgroundColor: bg }}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header — pad the top by the device's safe-area inset so the title
          clears the notch / front camera on phones. */}
      <LinearGradient colors={['#1A0040', '#2D0070', '#0a0008']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fantHeader, { paddingTop: insets.top + 16 }]}>
        <Animated.View style={[styles.fantHeaderRingWrap, fantRingStyle]}>
          <View style={styles.fantHeaderRing1} />
          <View style={styles.fantHeaderRing2} />
        </Animated.View>
        <View style={styles.fantHeaderShimmer} />
        <View style={styles.fantHeaderInner}>
          <View style={styles.fantHeaderAccentBar} />
          <Animated.View style={[styles.fantHeaderTitleBlock, fantHdrStyle]}>
            <Text style={styles.fantHeaderTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>FANTASY</Text>
            <Text style={styles.fantHeaderSub}>LEAGUES & ROSTER</Text>
            {selectedLeague && (
              <View style={[styles.activeBadge, { backgroundColor: selectedLeague.provider === 'yahoo' ? '#6001D2' : '#D00', marginTop: 4, alignSelf: 'flex-start' }]}>
                <Text style={styles.activeBadgeText} numberOfLines={1}>{selectedLeague.name}</Text>
              </View>
            )}
          </Animated.View>
        </View>
      </LinearGradient>

      {/* Provider connect cards */}
      <View style={styles.providerRow}>
        <ConnectCard
          provider="yahoo"
          connected={yahooConnected}
          dark={dark}
          card={card}
          border={border}
          sub={sub}
          onPress={connectYahoo}
        />
        <ConnectCard
          provider="espn"
          connected={espnConnected}
          dark={dark}
          card={card}
          border={border}
          sub={sub}
          onPress={() => {
            // Prefer the in-app WebView login (zero copy-paste) on native.
            // Web falls back to the manual paste form because we can't read
            // espn.com cookies cross-origin in a browser.
            if (Platform.OS === 'web') {
              setShowEspnForm(v => !v);
              setEspnS2(''); setEspnSwid('');
            } else {
              setShowEspnWebView(true);
            }
          }}
        />
      </View>

      {/* ESPN form — paste-everything mode */}
      {showEspnForm && (
        <Animated.View entering={FadeInDown.duration(220)} style={[styles.espnForm, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.formTitle, { color: text }]}>Connect ESPN Fantasy</Text>

          {/* Step-by-step guide with a button that opens ESPN for them */}
          <Text style={[styles.formHint, { color: sub, marginBottom: 4 }]}>
            1. Log into ESPN in your browser
          </Text>
          <Pressable
            style={[styles.helperBtn, { borderColor: border }]}
            onPress={() => {
              const url = 'https://www.espn.com/login';
              if (Platform.OS === 'web') window.open(url, '_blank');
              else Linking.openURL(url);
            }}
          >
            <Text style={[styles.helperBtnText, { color: '#D00' }]}>↗  Open espn.com/login</Text>
          </Pressable>

          <Text style={[styles.formHint, { color: sub, marginTop: 10 }]}>
            2. Once logged in, open DevTools (⌘+⌥+I on Mac, F12 on Windows) → Application tab → Cookies → espn.com.
            Find <Text style={{ fontFamily: F.bold }}>espn_s2</Text> and <Text style={{ fontFamily: F.bold }}>SWID</Text>, copy each value here:
          </Text>

          <TextInput
            style={[styles.input, { color: text, borderColor: border, backgroundColor: dark ? '#2c2c2e' : '#f2f2f7' }]}
            placeholder="Paste espn_s2 value"
            placeholderTextColor={sub}
            value={espnS2}
            onChangeText={(t) => {
              // Auto-parse if user pasted a "name=value; name2=value2" blob
              const m = t.match(/espn_s2=([^;\s]+)/i);
              if (m) setEspnS2(m[1]);
              else setEspnS2(t);
              const sm = t.match(/SWID=(\{[^}]+\})/i);
              if (sm) setEspnSwid(sm[1]);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            multiline={false}
          />
          <TextInput
            style={[styles.input, { color: text, borderColor: border, backgroundColor: dark ? '#2c2c2e' : '#f2f2f7' }]}
            placeholder="Paste SWID value (looks like {xxxxxxxx-xxxx-...})"
            placeholderTextColor={sub}
            value={espnSwid}
            onChangeText={(t) => {
              // Strip leading "SWID=" if pasted with the prefix
              const cleaned = t.replace(/^SWID=/i, '').trim();
              setEspnSwid(cleaned);
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {connectError ? (
            <Text style={{ color: '#FF3B30', fontSize: 12, fontFamily: F.regular, marginTop: 2 }}>{connectError}</Text>
          ) : null}
          <Pressable style={[styles.submitBtn, { backgroundColor: '#D00', opacity: connecting ? 0.6 : 1 }]} onPress={connectEspn} disabled={connecting}>
            <Text style={styles.submitBtnText}>{connecting ? 'Verifying…' : 'Connect ESPN Fantasy'}</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Add ESPN League — always visible; cookies only needed for private leagues */}
      <>
        {showAddLeague ? (
            <Animated.View entering={FadeInDown.duration(200)} style={[styles.espnForm, { backgroundColor: card, borderColor: border }]}>
              <Text style={[styles.formTitle, { color: text }]}>Add ESPN League</Text>
              <Text style={[styles.formHint, { color: sub }]}>
                Find your league ID in the ESPN app or website URL:{'\n'}fantasy.espn.com/football/league?leagueId=<Text style={{ fontFamily: F.bold }}>XXXXXX</Text>
              </Text>
              {/* Sport picker */}
              <View style={styles.sportPicker}>
                {(['nfl', 'nba', 'mlb', 'nhl'] as const).map(s => (
                  <Pressable
                    key={s}
                    style={[styles.sportChip, { borderColor: addLeagueSport === s ? '#D00' : border, backgroundColor: addLeagueSport === s ? '#D0011B18' : 'transparent' }]}
                    onPress={() => setAddLeagueSport(s)}
                  >
                    <Text style={[styles.sportChipText, { color: addLeagueSport === s ? '#D00' : sub }]}>{s.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={[styles.input, { color: text, borderColor: border, backgroundColor: dark ? '#2c2c2e' : '#f2f2f7' }]}
                placeholder="League ID  e.g. 336541"
                placeholderTextColor={sub}
                value={addLeagueId}
                onChangeText={setAddLeagueId}
                keyboardType="numeric"
                autoCorrect={false}
              />
              {addLeagueError ? (
                <Text style={{ color: '#FF3B30', fontSize: 12, fontFamily: F.regular, marginTop: 2 }}>{addLeagueError}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable style={[styles.submitBtn, { backgroundColor: dark ? '#2c2c2e' : '#e5e5ea', flex: 1 }]} onPress={() => { setShowAddLeague(false); setAddLeagueError(''); }}>
                  <Text style={[styles.submitBtnText, { color: sub }]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.submitBtn, { backgroundColor: '#D00', flex: 2, opacity: addingLeague ? 0.6 : 1 }]} onPress={addEspnLeague} disabled={addingLeague}>
                  <Text style={styles.submitBtnText}>{addingLeague ? 'Adding…' : 'Add League'}</Text>
                </Pressable>
              </View>
            </Animated.View>
          ) : (
            <Pressable style={[styles.addLeagueBtn, { borderColor: '#D0011B55' }]} onPress={() => setShowAddLeague(true)}>
              <Text style={[styles.addLeaguePlus, { color: '#D00' }]}>＋</Text>
              <Text style={[styles.addLeagueText, { color: '#D00' }]}>Add ESPN League</Text>
            </Pressable>
        )}
      </>

      {/* Leagues */}
      {anyConnected && (
        <>
          <Text style={[styles.sectionTitle, { color: text }]}>Your Leagues</Text>
          {loading ? (
            <ActivityIndicator color={sub} style={{ marginTop: 20 }} />
          ) : allLeagues.length === 0 ? (
            <Text style={[styles.emptyText, { color: sub }]}>
              {espnConnected ? 'Tap "Add ESPN League" above to add your league.' : 'No leagues found.'}
            </Text>
          ) : (
            allLeagues.map((league, i) => {
              const isActive = selectedLeague?.key === league.key && selectedLeague?.provider === league.provider;
              const sportColor = SPORT_COLORS[league.sport] ?? '#555';
              const providerColor = league.provider === 'yahoo' ? '#6001D2' : '#D00';
              return (
                <Animated.View key={league.key + league.provider} entering={FadeIn.delay(i * 50).duration(300)} layout={LinearTransition}>
                  <View style={[styles.leagueCard, { backgroundColor: card, borderColor: isActive ? providerColor : border }]}>
                    <Pressable style={styles.leagueMain} onPress={() => loadRoster(league)}>
                      <View style={[styles.leagueStripe, { backgroundColor: sportColor }]} />
                      <View style={styles.leagueBody}>
                        <View style={styles.leagueTitleRow}>
                          <Text style={[styles.leagueName, { color: text }]} numberOfLines={1}>{league.name}</Text>
                          <View style={[styles.providerChip, { backgroundColor: providerColor + '22', borderColor: providerColor + '44' }]}>
                            <Text style={[styles.providerChipText, { color: providerColor }]}>
                              {league.provider === 'yahoo' ? 'Yahoo' : 'ESPN'}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.leagueMeta, { color: sub }]}>
                          {SPORT_LABELS[league.sport] || league.sport.toUpperCase()}
                          {league.season ? ` · ${league.season}` : ''}
                          {league.num_teams ? ` · ${league.num_teams} teams` : ''}
                        </Text>
                      </View>
                      {isActive && <View style={[styles.activeCheck, { backgroundColor: providerColor }]}><Text style={{ color: '#fff', fontSize: 10 }}>✓</Text></View>}
                    </Pressable>
                    <TouchableOpacity onPress={() => deleteLeague(league)} style={styles.deleteBtn} activeOpacity={0.6}>
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              );
            })
          )}
        </>
      )}

      {/* Roster */}
      {selectedLeague && (
        <>
          {/* Matchup header — me vs opponent score, mirrors ESPN/Yahoo scoreboard */}
          {matchup && (
            <View style={[styles.matchupCard, { backgroundColor: card, borderColor: border }]}>
              {/* Left side: team name + score stacked vertically so long names fit */}
              <View style={styles.matchupSideV}>
                {matchup.myTeam.logo
                  ? <Image source={{ uri: matchup.myTeam.logo }} style={styles.matchupLogoBig} contentFit="contain" />
                  : <View style={[styles.matchupLogoBig, styles.avatarFallback, { backgroundColor: dark ? '#2c2c2e' : '#e5e5ea' }]} />}
                <Text
                  style={[styles.matchupTeamName, { color: text }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {matchup.myTeam.name}
                </Text>
                <Text style={[
                  styles.matchupScore,
                  { color: matchup.myTeam.score >= matchup.opponent.score && matchup.myTeam.score > 0 ? '#34C759' : text },
                ]}>
                  {(matchup.myTeam.score ?? 0).toFixed(1)}
                </Text>
              </View>

              {/* Center VS divider */}
              <View style={styles.matchupCenter}>
                <Text style={[styles.matchupVs, { color: sub }]}>VS</Text>
              </View>

              {/* Right side: opponent */}
              <View style={styles.matchupSideV}>
                {matchup.opponent.logo
                  ? <Image source={{ uri: matchup.opponent.logo }} style={styles.matchupLogoBig} contentFit="contain" />
                  : <View style={[styles.matchupLogoBig, styles.avatarFallback, { backgroundColor: dark ? '#2c2c2e' : '#e5e5ea' }]} />}
                <Text
                  style={[styles.matchupTeamName, { color: text }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {matchup.opponent.name}
                </Text>
                <Text style={[
                  styles.matchupScore,
                  { color: matchup.opponent.score > matchup.myTeam.score ? '#FF3B30' : text },
                ]}>
                  {(matchup.opponent.score ?? 0).toFixed(1)}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.rosterHeader}>
            <Text style={[styles.sectionTitle, { color: text, marginTop: 0 }]}>My Roster</Text>
            <View style={styles.liveBadge}>
              <View style={styles.liveBadgeDot} />
              <Text style={styles.liveBadgeText}>LIVE · TODAY</Text>
            </View>
          </View>
          {rosterLoading ? (
            <ActivityIndicator color={sub} style={{ marginTop: 16 }} />
          ) : roster.length === 0 ? (
            <Text style={[styles.emptyText, { color: sub }]}>No players found</Text>
          ) : (
            (() => {
              // ────────────────────────────────────────────────────────────────
              // Group roster by role so users see STARTERS / PITCHERS / BENCH
              // / INJURED sections — same layout ESPN/Yahoo apps use.
              // ────────────────────────────────────────────────────────────────
              // ESPN lineup-slot IDs differ by sport. The "bench" + "IL" slots
              // we care about are listed below — anything ELSE is an active
              // starter. injuryStatus marks IL even when slot is bench.
              const BENCH_SLOTS: Record<string, Set<number>> = {
                mlb: new Set([16]),                    // BE
                nfl: new Set([20]),                    // BE
                nba: new Set([12, 13]),                // BE
                nhl: new Set([12, 13]),                // BE
              };
              const IL_SLOTS: Record<string, Set<number>> = {
                mlb: new Set([17, 18, 19]),            // IL / IL-10 / IL-60
                nfl: new Set([21, 22]),                // IR / NA
                nba: new Set([14, 15]),                // IR
                nhl: new Set([14, 15]),                // IR
              };

              const groupOf = (p: FantasyPlayer): string => {
                const slot   = p.lineupSlotId ?? 0;
                const pos    = String(p.position ?? '').toUpperCase();
                const sport  = selectedLeague.sport;
                const benchS = BENCH_SLOTS[sport] || new Set([20]);
                const ilS    = IL_SLOTS[sport]    || new Set([21]);
                const injured = p.injuryStatus && /IL|IR|OUT|SUSP/i.test(p.injuryStatus);

                if (ilS.has(slot) || injured) return 'INJURED';
                if (benchS.has(slot))         return 'BENCH';

                if (sport === 'mlb') {
                  if (pos === 'SP' || pos === 'RP' || pos === 'P') return 'PITCHERS';
                  return 'BATTERS';
                }
                if (sport === 'nhl') {
                  if (pos === 'G') return 'GOALIES';
                  return 'SKATERS';
                }
                return 'STARTERS';
              };

              const groupOrder: Record<string, string[]> = {
                mlb: ['BATTERS', 'PITCHERS', 'BENCH', 'INJURED'],
                nhl: ['SKATERS', 'GOALIES', 'BENCH', 'INJURED'],
                nba: ['STARTERS', 'BENCH', 'INJURED'],
                nfl: ['STARTERS', 'BENCH', 'INJURED'],
              };

              const buckets: Record<string, FantasyPlayer[]> = {};
              for (const p of roster) {
                const g = groupOf(p);
                if (!buckets[g]) buckets[g] = [];
                buckets[g].push(p);
              }

              const order = groupOrder[selectedLeague.sport] || ['STARTERS', 'BENCH', 'INJURED'];
              const sections = order
                .filter(n => buckets[n]?.length > 0)
                .map(n => ({ name: n, players: buckets[n] }));

              return (
                <>
                  {sections.map((section, sIdx) => {
                    const sectionTotal = section.players.reduce(
                      (sum, p) => sum + (p.pointsToday ?? 0), 0
                    );
                    return (
                    <View key={section.name} style={{ marginTop: sIdx === 0 ? 0 : 12 }}>
                      {/* Section header */}
                      <View style={styles.rosterSectionHeader}>
                        <View style={styles.rosterSectionLeft}>
                          <Text style={[styles.rosterSectionTitle, { color: sub }]}>
                            {section.name}
                          </Text>
                          <Text style={[styles.rosterSectionCount, { color: sub }]}>
                            · {section.players.length}
                          </Text>
                        </View>
                        <View style={styles.rosterSectionPtsBlock}>
                          <Text style={[styles.rosterSectionPts, {
                            color: sectionTotal < 0 ? '#FF3B30' : sectionTotal > 0 ? text : sub,
                          }]}>
                            {sectionTotal.toFixed(1)}
                          </Text>
                          <Text style={[styles.rosterSectionPtsLabel, { color: sub }]}>PTS</Text>
                        </View>
                      </View>
                      <View style={[styles.rosterGrid, { backgroundColor: card, borderColor: border }]}>
                        {section.players.map((player, i) => (
                          <Animated.View
                            key={String(player.id ?? `${section.name}-${i}`)}
                            entering={FadeIn.delay(i * 20).duration(220)}
                            style={[
                              styles.playerRow,
                              { borderBottomColor: border },
                              i === section.players.length - 1 && { borderBottomWidth: 0 },
                            ]}
                          >
                            {player.image ? (
                              <Image source={{ uri: player.image }} style={styles.playerAvatar} contentFit="cover" />
                            ) : (
                              <View style={[styles.playerAvatar, styles.avatarFallback, { backgroundColor: dark ? '#2c2c2e' : '#e5e5ea' }]}>
                                <IconSymbol name="person.fill" size={18} color={sub} />
                              </View>
                            )}
                            <View style={styles.playerMeta}>
                              <Text style={[styles.playerName, { color: text }]}>{player.name}</Text>
                              <Text style={[styles.playerSub, { color: sub }]}>
                                {player.position ?? '—'}{player.team ? `  ·  ${player.team}` : ''}
                              </Text>
                            </View>
                            {player.injuryStatus && player.injuryStatus !== 'ACTIVE' && (
                              <View style={styles.injuryChip}>
                                <Text style={styles.injuryText}>{player.injuryStatus}</Text>
                              </View>
                            )}
                            {/* TODAY's fantasy points — number color alone tells the story:
                                  • white  → currently playing or has points
                                  • gray   → game hasn't started yet today
                                  • red    → negative points */}
                            <View style={styles.playerPtsBlock}>
                              <Text style={[
                                styles.playerPts,
                                {
                                  color:
                                    (player.pointsToday ?? 0) < 0 ? '#FF3B30' :
                                    (player.isPlaying || (player.pointsToday ?? 0) > 0) ? text :
                                    sub,
                                },
                              ]}>
                                {(() => {
                                  const v = player.pointsToday ?? 0;
                                  return v.toFixed(1);
                                })()}
                              </Text>
                            </View>
                          </Animated.View>
                        ))}
                      </View>
                    </View>
                  );
                  })}
                </>
              );
            })()
          )}
        </>
      )}

      {/* Games Today */}
      {selectedLeague && todayGames.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: text }]}>Your Players Today</Text>
          {gamesLoading ? (
            <ActivityIndicator color={sub} style={{ marginTop: 8 }} />
          ) : (
            todayGames.map(game => {
              const providerColor = selectedLeague.provider === 'yahoo' ? '#6001D2' : '#D00';
              const isLive = game.state === 'in';
              const isFinal = game.state === 'post';
              return (
                <Pressable
                  key={game.id}
                  style={[styles.fantasyGameCard, { backgroundColor: card, borderColor: isLive ? '#FF3B30' : border }]}
                  onPress={() => router.push({ pathname: '/game/[id]', params: { id: game.id, sport: selectedLeague.sport } } as any)}
                >
                  <View style={styles.fantasyGameHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fantasyGameLabel, { color: text }]}>{game.label}</Text>
                      <Text style={[styles.fantasyGameMeta, { color: sub }]}>
                        {game.myPlayers.length} player{game.myPlayers.length !== 1 ? 's' : ''} on your roster
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {isLive && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' }} />
                          <Text style={{ color: '#FF3B30', fontSize: 11, fontFamily: F.bold }}>LIVE</Text>
                        </View>
                      )}
                      {isFinal && <Text style={{ color: sub, fontSize: 11, fontFamily: F.bold }}>FINAL</Text>}
                      {/* Player avatars preview */}
                      <View style={{ flexDirection: 'row' }}>
                        {game.myPlayers.slice(0, 4).map((p, idx) => (
                          p.image ? (
                            <Image
                              key={String(p.id ?? idx)}
                              source={{ uri: p.image }}
                              style={{ width: 24, height: 24, borderRadius: 12, marginLeft: idx > 0 ? -8 : 0, borderWidth: 1.5, borderColor: card }}
                              contentFit="cover"
                            />
                          ) : (
                            <View key={String(p.id ?? idx)} style={{ width: 24, height: 24, borderRadius: 12, marginLeft: idx > 0 ? -8 : 0, backgroundColor: providerColor + '40', borderWidth: 1.5, borderColor: card }} />
                          )
                        ))}
                        {game.myPlayers.length > 4 && (
                          <View style={{ width: 24, height: 24, borderRadius: 12, marginLeft: -8, backgroundColor: sub + '40', borderWidth: 1.5, borderColor: card, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: sub, fontSize: 8, fontFamily: F.bold }}>+{game.myPlayers.length - 4}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                </Pressable>
              );
            })
          )}
        </>
      )}

      {/* Empty state */}
      {!anyConnected && !loading && (
        <Animated.View entering={FadeIn.duration(500)} style={styles.emptyState}>
          <View style={styles.emptyIconRing}>
            <IconSymbol name="trophy.fill" size={30} color="#6001D2" />
          </View>
          <Text style={[styles.emptyTitle, { color: text }]}>Link Your Fantasy Teams</Text>
          <Text style={[styles.emptySub, { color: sub }]}>
            Connect Yahoo or ESPN Fantasy to see your roster and track player stats live inside any game.
          </Text>
        </Animated.View>
      )}

      {/* In-app ESPN login — opens espn.com in a WebView, auto-extracts the
          espn_s2 + SWID cookies the moment the user finishes logging in, and
          posts them to /espn/fantasy/connect. No manual cookie copy-paste. */}
      <EspnLoginWebView
        visible={showEspnWebView}
        dark={dark}
        onClose={() => setShowEspnWebView(false)}
        onConnected={() => {
          setEspnConnected(true);
          fetchEspnLeagues();
        }}
      />
    </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Connect card — no emoji, clean geometric design
// ---------------------------------------------------------------------------

function ConnectCard({ provider, connected, dark, card, border, sub, onPress }: {
  provider: Provider; connected: boolean; dark: boolean;
  card: string; border: string; sub: string; onPress: () => void;
}) {
  const isYahoo = provider === 'yahoo';
  const accent = isYahoo ? '#6001D2' : '#D00';
  const secondaryAccent = isYahoo ? '#9B4DFF' : '#FF3B30';

  return (
    <Pressable
      style={[styles.connectCard, { backgroundColor: card, borderColor: connected ? accent : border }]}
      onPress={onPress}
    >
      {/* Logo mark */}
      <View style={[styles.logoMark, { backgroundColor: accent }]}>
        {isYahoo ? (
          // Yahoo "Y!" mark
          <View style={styles.yahooMark}>
            <View style={[styles.yahooStem, { backgroundColor: '#fff' }]} />
            <View style={[styles.yahooArm, { backgroundColor: '#fff' }]} />
          </View>
        ) : (
          // ESPN "E" bars
          <View style={styles.espnMark}>
            <View style={[styles.espnBar, { backgroundColor: '#fff', width: 18 }]} />
            <View style={[styles.espnBar, { backgroundColor: '#fff', width: 14 }]} />
            <View style={[styles.espnBar, { backgroundColor: '#fff', width: 18 }]} />
          </View>
        )}
        {/* Accent glow strip */}
        <View style={[styles.logoGlow, { backgroundColor: secondaryAccent }]} />
      </View>

      <Text style={[styles.connectName, { color: dark ? '#fff' : '#000' }]}>
        {isYahoo ? 'Yahoo' : 'ESPN'}
      </Text>
      <Text style={[styles.connectSub, { color: isYahoo ? '#9B4DFF' : '#cc0000' }]}>Fantasy</Text>

      <View style={[styles.connectStatus, { backgroundColor: connected ? accent + '22' : (dark ? '#2c2c2e' : '#f2f2f7') }]}>
        <View style={[styles.statusDot, { backgroundColor: connected ? accent : sub }]} />
        <Text style={[styles.statusLabel, { color: connected ? accent : sub }]}>
          {connected ? 'Connected' : 'Connect'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 48 },

  fantHeader: { minHeight: 120, paddingTop: 20, paddingBottom: 24, paddingHorizontal: 22, overflow: 'hidden', position: 'relative' },
  fantHeaderInner: { flexDirection: 'row', alignItems: 'center', gap: 0, position: 'relative', zIndex: 2 },
  fantHeaderAccentBar: { width: 5, height: 52, borderRadius: 3, marginRight: 14, backgroundColor: '#9B4DFF' },
  fantHeaderTitleBlock: { flex: 1 },
  fantHeaderTitle: { fontSize: 56, fontFamily: F.black, color: '#fff', letterSpacing: 6, lineHeight: 74, paddingTop: 6, includeFontPadding: true },
  fantHeaderSub: { fontSize: 10, fontFamily: F.bold, color: 'rgba(255,255,255,0.4)', letterSpacing: 4, marginTop: 4 },
  fantHeaderRingWrap: { position: 'absolute', top: -40, right: -40, zIndex: 1, width: 260, height: 200 },
  fantHeaderRing1: { width: 160, height: 160, borderRadius: 80, borderWidth: 22, borderColor: 'rgba(147,112,219,0.12)', position: 'absolute', top: 0, right: 0 },
  fantHeaderRing2: { width: 90, height: 90, borderRadius: 45, borderWidth: 14, borderColor: 'rgba(147,112,219,0.07)', position: 'absolute', top: 70, right: 100 },
  fantHeaderShimmer: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1.5, backgroundColor: 'rgba(147,112,219,0.2)', zIndex: 3 },
  activeBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 4,
    maxWidth: 140,
  },
  activeBadgeText: { color: '#fff', fontSize: 11, fontFamily: F.bold, numberOfLines: 1 } as any,

  providerRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 4, marginTop: 16 },

  connectCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },

  logoMark: {
    width: 48,
    height: 48,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  logoGlow: {
    position: 'absolute',
    bottom: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    opacity: 0.5,
  },

  // Yahoo mark
  yahooMark: { alignItems: 'center', gap: 2 },
  yahooStem: { width: 4, height: 18, borderRadius: 2 },
  yahooArm: { width: 14, height: 4, borderRadius: 2, marginTop: -14, marginLeft: -10, transform: [{ rotate: '35deg' }] },

  // ESPN mark
  espnMark: { gap: 3, alignItems: 'flex-start' },
  espnBar: { height: 3, borderRadius: 1.5 },

  connectName: { fontSize: 15, fontFamily: F.black, marginTop: 2 },
  connectSub: { fontSize: 11, fontFamily: F.bold, letterSpacing: 0.3, textTransform: 'uppercase', marginTop: -4 },

  connectStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 2,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: 11, fontFamily: F.bold },

  // ESPN form
  espnForm: {
    margin: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  formTitle: { fontSize: 15, fontFamily: F.black },
  formHint: { fontSize: 12, fontFamily: F.regular, lineHeight: 17 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: F.regular,
  },
  submitBtn: { borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 2 },
  helperBtn: {
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  helperBtnText: { fontSize: 13, fontFamily: F.bold },
  submitBtnText: { color: '#fff', fontSize: 15, fontFamily: F.bold },

  sportPicker: { flexDirection: 'row', gap: 8 },
  sportChip: { flex: 1, borderRadius: 8, borderWidth: 1.5, paddingVertical: 7, alignItems: 'center' },
  sportChipText: { fontSize: 12, fontFamily: F.black, letterSpacing: 0.5 },

  addLeagueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 16, marginTop: 8, borderRadius: 12, borderWidth: 1.5,
    paddingVertical: 12, gap: 6, borderStyle: 'dashed',
  },
  addLeaguePlus: { fontSize: 18, fontFamily: F.bold },
  addLeagueText: { fontSize: 14, fontFamily: F.bold },

  sectionTitle: { fontSize: 20, fontFamily: F.black, marginTop: 22, marginBottom: 8, paddingHorizontal: 16 },
  emptyText: { paddingHorizontal: 16, fontSize: 14, fontFamily: F.regular },

  // League cards
  leagueCard: {
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 14,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  leagueMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 13,
  },
  deleteBtn: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 16,
    color: '#FF3B30',
    fontFamily: F.bold,
  },
  leagueStripe: { width: 4, alignSelf: 'stretch' },
  leagueBody: { flex: 1, paddingHorizontal: 12, paddingVertical: 12, gap: 3 },
  leagueTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  leagueName: { fontSize: 15, fontFamily: F.bold, flex: 1 },
  leagueMeta: { fontSize: 12, fontFamily: F.regular },
  providerChip: {
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  providerChipText: { fontSize: 10, fontFamily: F.black },
  activeCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  // Roster
  // Matchup card (me vs opponent scoreboard) — vertical stack per side so full
  // team names always fit on phone widths instead of being truncated to "B..."
  matchupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  matchupSideV: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  matchupLogoBig: { width: 42, height: 42, borderRadius: 21 },
  matchupTeamName: {
    fontSize: 13,
    fontFamily: F.bold,
    textAlign: 'center',
    width: '100%',
  },
  matchupScore: { fontSize: 28, fontFamily: F.black, letterSpacing: 0.5 },
  matchupCenter: { alignItems: 'center', paddingHorizontal: 6 },
  matchupVs: {
    fontSize: 11,
    fontFamily: F.black,
    letterSpacing: 2,
  },

  // Per-player FPTS shown on the right side of each roster row
  playerPtsBlock: {
    alignItems: 'flex-end',
    marginLeft: 8,
    minWidth: 44,
  },
  playerPts: { fontSize: 18, fontFamily: F.black },
  playerPtsLabel: { fontSize: 9, fontFamily: F.bold, letterSpacing: 0.5 },

  // Section headers separating STARTERS / PITCHERS / BENCH / INJURED
  rosterSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 6,
  },
  rosterSectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rosterSectionTitle: {
    fontSize: 11,
    fontFamily: F.black,
    letterSpacing: 1.5,
  },
  rosterSectionCount: {
    fontSize: 11,
    fontFamily: F.bold,
  },
  rosterSectionPtsBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  rosterSectionPts: {
    fontSize: 15,
    fontFamily: F.black,
  },
  rosterSectionPtsLabel: {
    fontSize: 9,
    fontFamily: F.black,
    letterSpacing: 0.8,
  },

  rosterHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    gap: 8,
    marginTop: 22,
    marginBottom: 8,
  },
  rosterHint: { fontSize: 12, fontFamily: F.regular, flex: 1, textAlign: 'right' },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FF3B3060',
    backgroundColor: '#FF3B3015',
  },
  liveBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' },
  liveBadgeText: { color: '#FF3B30', fontSize: 9, fontFamily: F.black, letterSpacing: 1.2 },
  rosterGrid: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  playerAvatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  playerMeta: { flex: 1 },
  playerName: { fontSize: 14, fontFamily: F.bold },
  playerSub: { fontSize: 12, fontFamily: F.regular, marginTop: 1 },
  injuryChip: { backgroundColor: '#FF3B3020', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  injuryText: { color: '#FF3B30', fontSize: 10, fontFamily: F.bold },

  // Games Today
  fantasyGameCard: {
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  fantasyGameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  fantasyGameLabel: { fontSize: 15, fontFamily: F.bold },
  fantasyGameMeta: { fontSize: 11, fontFamily: F.regular, marginTop: 2 },
  fantasyPlayersExpanded: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fantasyPlayerExpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fantasyProviderBar: { width: 3, alignSelf: 'stretch' },
  fantasyPlayerName2: { fontSize: 14, fontFamily: F.bold },
  fantasyPlayerPos2: { fontSize: 11, fontFamily: F.regular, marginTop: 1 },
  fantasyStatRow2: { flexDirection: 'row', gap: 10, marginTop: 6, flexWrap: 'wrap' },
  fantasyStat2: { alignItems: 'center', minWidth: 30 },
  fantasyStatVal2: { fontSize: 14, fontFamily: F.black },
  fantasyStatKey2: { fontSize: 9, fontFamily: F.black, letterSpacing: 0.3, marginTop: 1 },
  fantasyFptsBlock: { alignItems: 'center', paddingLeft: 12 },
  fantasyFpts: { fontSize: 20, fontFamily: F.black },
  fantasyFptsLabel: { fontSize: 9, fontFamily: F.black, letterSpacing: 0.5 },

  // Empty state
  emptyState: { alignItems: 'center', marginTop: 70, paddingHorizontal: 36 },
  emptyIconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: '#FFD70040',
    backgroundColor: '#FFD70012',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyIconText: { fontSize: 40 },
  emptyTitle: { fontSize: 22, fontFamily: F.black, textAlign: 'center', marginBottom: 10 },
  emptySub: { fontSize: 14, fontFamily: F.regular, textAlign: 'center', lineHeight: 21 },
});
