import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { F } from '@/constants/fonts';
import { SPORT_CONFIG } from '@/constants/sport-config';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FavoritePlayer, FavoriteTeam, useFavorites } from '@/hooks/use-favorites';
import { SportKey } from '@/types/sports';

import { API } from '@/constants/api';
const SPORTS: SportKey[] = ['nba', 'nfl', 'mlb', 'nhl'];
const NAME_KEY = 'ejjs:displayName';

interface BrowseTeam {
  id: string;
  abbreviation: string;
  displayName: string;
  logo: string;
  color: string;
}

export default function ProfileScreen() {
  const dark = useColorScheme() === 'dark';
  const router = useRouter();
  const bg = dark ? '#000' : '#f2f2f7';
  const cardBg = dark ? '#1c1c1e' : '#fff';
  const border = dark ? '#2c2c2e' : '#e5e5e5';
  const text = dark ? '#fff' : '#000';
  const sub = dark ? '#8e8e93' : '#6e6e73';

  const { teams, players, toggleTeam, togglePlayer, isTeamFav, isPlayerFav } = useFavorites();
  const [showPlayerSearch, setShowPlayerSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSport, setSearchSport] = useState<SportKey>('nba');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; headshot: string; position: string; team: string; sport: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('EJJS Fan');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [notifications, setNotifications] = useState(true);
  const [showTeamBrowser, setShowTeamBrowser] = useState(false);
  const [browseSport, setBrowseSport] = useState<SportKey>('nba');
  const [browseTeams, setBrowseTeams] = useState<BrowseTeam[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(NAME_KEY).then(n => { if (n) setDisplayName(n); });
    AsyncStorage.getItem('ejjs:notifications').then(v => { if (v !== null) setNotifications(v === 'true'); });
    AsyncStorage.getItem('ejjs:avatarUri').then(u => { if (u) setAvatarUri(u); });
  }, []);

  async function pickAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      const uri = result.assets[0].uri;
      setAvatarUri(uri);
      AsyncStorage.setItem('ejjs:avatarUri', uri);
    }
  }

  async function fetchBrowseTeams(sport: SportKey) {
    setBrowseLoading(true);
    setBrowseTeams([]);
    try {
      const r = await axios.get<{ teams: BrowseTeam[] }>(`${API}/sports/${sport}/teams`);
      setBrowseTeams(r.data.teams || []);
    } catch {}
    setBrowseLoading(false);
  }

  function openTeamBrowser() {
    setShowTeamBrowser(true);
    fetchBrowseTeams(browseSport);
  }

  function switchBrowseSport(s: SportKey) {
    setBrowseSport(s);
    fetchBrowseTeams(s);
  }

  async function searchPlayers(q: string, sport: string) {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const data = await fetch(`${API}/sports/search/players?q=${encodeURIComponent(q)}&sport=${sport}`).then(r => r.json());
      setSearchResults(data.players || []);
    } catch { setSearchResults([]); }
    finally { setSearchLoading(false); }
  }

  function onSearchChange(q: string) {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchPlayers(q, searchSport), 400);
  }

  function onSearchSportChange(s: SportKey) {
    setSearchSport(s);
    if (searchQuery.length >= 2) searchPlayers(searchQuery, s);
  }

  function saveName() {
    const name = nameInput.trim() || 'EJJS Fan';
    setDisplayName(name);
    AsyncStorage.setItem(NAME_KEY, name);
    setEditingName(false);
  }

  function toggleNotifs(v: boolean) {
    setNotifications(v);
    AsyncStorage.setItem('ejjs:notifications', String(v));
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* HEADER */}
        <Animated.View entering={FadeInUp.duration(400).springify()} style={[styles.header, { backgroundColor: '#000' }]}>
          <View style={styles.avatarWrap}>
            <View style={[styles.avatar, { backgroundColor: '#1c1c1e', borderColor: '#FF3B30' }]}>
              {avatarUri
                ? <Image source={{ uri: avatarUri }} style={styles.avatarImg} contentFit="cover" />
                : <IconSymbol name="person.crop.circle.fill" size={64} color="#636366" />
              }
            </View>
            <Pressable onPress={pickAvatar} style={styles.cameraBtn}>
              <IconSymbol name="camera.fill" size={13} color="#fff" />
            </Pressable>
          </View>
          {editingName ? (
            <View style={styles.nameEditRow}>
              <TextInput
                style={[styles.nameInput, { color: '#fff', borderColor: '#636366' }]}
                value={nameInput}
                onChangeText={setNameInput}
                autoFocus
                placeholder="Your name"
                placeholderTextColor="#636366"
                onSubmitEditing={saveName}
              />
              <Pressable onPress={saveName} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>SAVE</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => { setNameInput(displayName); setEditingName(true); }} style={styles.nameRow}>
              <Text style={styles.displayName}>{displayName}</Text>
              <IconSymbol name="gearshape.fill" size={16} color="#636366" />
            </Pressable>
          )}
          <Text style={styles.headerSub}>NEVER FORGET LOYALTY</Text>
        </Animated.View>

        {/* FAVORITE TEAMS */}
        <Animated.View entering={FadeInDown.delay(80).duration(400).springify()} style={styles.section}>
          <View style={styles.sectionHeader}>
            <IconSymbol name="star.fill" size={16} color="#FFD700" />
            <Text style={[styles.sectionTitle, { color: text }]}>Favorite Teams</Text>
            <Pressable onPress={openTeamBrowser} style={[styles.addBtn, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[styles.addBtnText, { color: sub }]}>+ ADD</Text>
            </Pressable>
          </View>

          {teams.length === 0 ? (
            <Pressable onPress={openTeamBrowser} style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <IconSymbol name="star" size={28} color={sub} />
              <Text style={[styles.emptyText, { color: sub }]}>Tap to add your favorite teams</Text>
            </Pressable>
          ) : (
            <View style={styles.teamGrid}>
              {teams.map((team, i) => (
                <Animated.View key={`${team.sport}-${team.id}`} entering={FadeInDown.delay(i * 40).duration(350).springify()}>
                  <Pressable
                    onPress={() => router.push(`/team/${team.id}?sport=${team.sport}` as any)}
                    onLongPress={() => Alert.alert('Remove', `Remove ${team.displayName}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => toggleTeam(team) },
                    ])}
                    style={[styles.teamCard, { backgroundColor: cardBg, borderColor: border }]}
                  >
                    <View style={[styles.teamCardBar, { backgroundColor: `#${team.color}` }]} />
                    {team.logo
                      ? <Image source={{ uri: team.logo }} style={styles.teamCardLogo} contentFit="contain" />
                      : <View style={[styles.teamCardLogo, { backgroundColor: `#${team.color}30` }]} />}
                    <Text style={[styles.teamCardAbbr, { color: text }]}>{team.abbreviation}</Text>
                    <Text style={[styles.teamCardSport, { color: sub }]}>{team.sport.toUpperCase()}</Text>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          )}
        </Animated.View>

        {/* FAVORITE PLAYERS */}
        <Animated.View entering={FadeInDown.delay(160).duration(400).springify()} style={styles.section}>
          <View style={styles.sectionHeader}>
            <IconSymbol name="star.fill" size={16} color="#FFD700" />
            <Text style={[styles.sectionTitle, { color: text }]}>Favorite Players</Text>
            <Pressable onPress={() => { setShowPlayerSearch(true); setSearchQuery(''); setSearchResults([]); }} style={[styles.addBtn, { backgroundColor: '#007AFF', borderColor: '#007AFF' }]}>
              <Text style={[styles.addBtnText, { color: '#fff' }]}>+ SEARCH</Text>
            </Pressable>
          </View>

          {players.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <IconSymbol name="person.fill" size={28} color={sub} />
              <Text style={[styles.emptyText, { color: sub }]}>Tap + SEARCH to add your favorite players</Text>
            </View>
          ) : (
            <View style={[styles.playerList, { backgroundColor: cardBg, borderColor: border }]}>
              {players.map((player, i) => (
                <Pressable
                  key={player.id}
                  style={[styles.playerRow, i < players.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}
                  onPress={() => router.push({ pathname: '/player/[id]', params: { id: player.id, sport: player.sport } } as any)}
                >
                  {player.headshot
                    ? <Image source={{ uri: player.headshot }} style={styles.playerHeadshot} contentFit="cover" />
                    : <View style={[styles.playerHeadshot, { backgroundColor: sub + '30' }]} />}
                  <View style={styles.playerInfo}>
                    <Text style={[styles.playerName, { color: text }]}>{player.name}</Text>
                    <Text style={[styles.playerMeta, { color: sub }]}>{player.teamAbbr} · {player.position} · {player.sport.toUpperCase()}</Text>
                  </View>
                  <Pressable onPress={(e) => { e.stopPropagation?.(); togglePlayer(player); }} hitSlop={12}>
                    <IconSymbol name="star.fill" size={18} color="#FFD700" />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )}
        </Animated.View>

        {/* SETTINGS */}
        <Animated.View entering={FadeInDown.delay(240).duration(400).springify()} style={styles.section}>
          <View style={styles.sectionHeader}>
            <IconSymbol name="gearshape.fill" size={16} color={sub} />
            <Text style={[styles.sectionTitle, { color: text }]}>Settings</Text>
          </View>
          <View style={[styles.settingsCard, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={[styles.settingRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
              <IconSymbol name="bell.fill" size={18} color="#FF3B30" />
              <Text style={[styles.settingLabel, { color: text }]}>Game Notifications</Text>
              <Switch value={notifications} onValueChange={toggleNotifs} trackColor={{ true: '#FF3B30' }} thumbColor="#fff" />
            </View>
            <View style={styles.settingRow}>
              <IconSymbol name="star.fill" size={18} color="#FFD700" />
              <Text style={[styles.settingLabel, { color: text }]}>Following</Text>
              <Text style={[styles.settingValue, { color: sub }]}>{teams.length} teams · {players.length} players</Text>
            </View>
          </View>
          <Text style={[styles.versionText, { color: sub }]}>EJJS v1.0 · Never Forget Loyalty</Text>
        </Animated.View>
      </ScrollView>

      {/* PLAYER SEARCH MODAL */}
      <Modal visible={showPlayerSearch} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPlayerSearch(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: border }]}>
            <Text style={[styles.modalTitle, { color: text }]}>Search Players</Text>
            <Pressable onPress={() => setShowPlayerSearch(false)} hitSlop={12}>
              <Text style={[styles.modalClose, { color: sub }]}>DONE</Text>
            </Pressable>
          </View>

          {/* Sport tabs */}
          <View style={[styles.sportTabs, { borderBottomColor: border }]}>
            {SPORTS.map(s => (
              <Pressable key={s} onPress={() => onSearchSportChange(s)} style={[styles.sportTab, searchSport === s && { borderBottomColor: SPORT_CONFIG[s].color, borderBottomWidth: 3 }]}>
                <Text style={[styles.sportTabText, { color: searchSport === s ? SPORT_CONFIG[s].color : sub }]}>{s.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          {/* Search bar */}
          <View style={[styles.searchBar, { backgroundColor: dark ? '#2c2c2e' : '#f2f2f7', borderColor: border }]}>
            <IconSymbol name="magnifyingglass" size={18} color={sub} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.searchInput, { color: text }]}
              placeholder="Player name…"
              placeholderTextColor={sub}
              value={searchQuery}
              onChangeText={onSearchChange}
              autoFocus
              autoCapitalize="words"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => { setSearchQuery(''); setSearchResults([]); }} hitSlop={8}>
                <Text style={{ color: sub, fontSize: 14 }}>✕</Text>
              </Pressable>
            )}
          </View>

          <ScrollView keyboardShouldPersistTaps="always" style={{ flex: 1 }}>
            {searchLoading && <ActivityIndicator color={sub} style={{ marginTop: 24 }} />}
            {!searchLoading && searchQuery.length >= 2 && searchResults.length === 0 && (
              <Text style={[styles.emptyText, { color: sub, textAlign: 'center', marginTop: 32 }]}>No players found</Text>
            )}
            {searchResults.map(p => {
              const fav = isPlayerFav(p.id);
              const sportColor = SPORT_CONFIG[p.sport as SportKey]?.color ?? '#007AFF';
              return (
                <Pressable
                  key={p.id}
                  onPress={() => togglePlayer({ id: p.id, name: p.name, headshot: p.headshot, position: p.position, teamAbbr: p.team, sport: p.sport })}
                  style={[styles.playerRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}
                >
                  {p.headshot
                    ? <Image source={{ uri: p.headshot }} style={styles.playerHeadshot} contentFit="cover" />
                    : <View style={[styles.playerHeadshot, { backgroundColor: sub + '30' }]} />}
                  <View style={styles.playerInfo}>
                    <Text style={[styles.playerName, { color: text }]}>{p.name}</Text>
                    <Text style={[styles.playerMeta, { color: sub }]}>{p.sport.toUpperCase()}{p.position ? ` · ${p.position}` : ''}{p.team ? ` · ${p.team}` : ''}</Text>
                  </View>
                  <View style={[styles.favToggle, { borderColor: fav ? '#FF3B30' : sportColor, backgroundColor: fav ? '#FF3B3022' : sportColor + '22' }]}>
                    <Text style={{ color: fav ? '#FF3B30' : sportColor, fontSize: 14, fontFamily: F.bold }}>{fav ? '✓' : '+'}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* TEAM BROWSER MODAL */}
      <Modal visible={showTeamBrowser} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowTeamBrowser(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: border }]}>
            <Text style={[styles.modalTitle, { color: text }]}>Browse Teams</Text>
            <Pressable onPress={() => setShowTeamBrowser(false)} hitSlop={12}>
              <Text style={[styles.modalClose, { color: sub }]}>DONE</Text>
            </Pressable>
          </View>

          {/* Sport selector */}
          <View style={[styles.sportTabs, { borderBottomColor: border }]}>
            {SPORTS.map(s => (
              <Pressable key={s} onPress={() => switchBrowseSport(s)} style={[styles.sportTab, browseSport === s && { borderBottomColor: SPORT_CONFIG[s].color, borderBottomWidth: 3 }]}>
                <Text style={[styles.sportTabText, { color: browseSport === s ? SPORT_CONFIG[s].color : sub }]}>{s.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          {browseLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} size="large" color={SPORT_CONFIG[browseSport].color} />
          ) : (
            <ScrollView contentContainerStyle={styles.browseGrid}>
              {browseTeams.map((team, i) => {
                const fav = isTeamFav(team.id, browseSport);
                return (
                  <Animated.View key={team.id} entering={FadeInDown.delay(i * 20).duration(300).springify()}>
                    <Pressable
                      onPress={() => toggleTeam({ ...team, sport: browseSport })}
                      style={[styles.browseCard, { backgroundColor: cardBg, borderColor: fav ? SPORT_CONFIG[browseSport].color : border, borderWidth: fav ? 2 : 1 }]}
                    >
                      {team.logo
                        ? <Image source={{ uri: team.logo }} style={styles.browseLogoImg} contentFit="contain" />
                        : <View style={[styles.browseLogoImg, { backgroundColor: `#${team.color}30` }]} />}
                      <Text style={[styles.browseTeamAbbr, { color: text }]}>{team.abbreviation}</Text>
                      {fav && <View style={styles.favCheck}><IconSymbol name="star.fill" size={12} color="#FFD700" /></View>}
                    </Pressable>
                  </Animated.View>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 48 },

  header: { alignItems: 'center', paddingTop: 28, paddingBottom: 24, paddingHorizontal: 20, gap: 10 },
  avatarWrap: { position: 'relative' },
  avatar: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%', borderRadius: 45 },
  cameraBtn: { position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  displayName: { fontSize: 22, fontFamily: F.black, color: '#fff', letterSpacing: 1 },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: { flex: 1, fontSize: 18, fontFamily: F.bold, borderBottomWidth: 1, paddingVertical: 4, paddingHorizontal: 0 },
  saveBtn: { backgroundColor: '#FF3B30', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  saveBtnText: { fontSize: 11, fontFamily: F.black, color: '#fff', letterSpacing: 1 },
  headerSub: { fontSize: 10, fontFamily: F.regular, color: 'rgba(255,255,255,0.35)', letterSpacing: 2 },

  section: { marginTop: 24, marginHorizontal: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { flex: 1, fontSize: 18, fontFamily: F.black, letterSpacing: 0.5 },
  addBtn: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  addBtnText: { fontSize: 10, fontFamily: F.black, letterSpacing: 1 },

  emptyCard: { borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 32 },
  emptyText: { fontSize: 13, fontFamily: F.regular, textAlign: 'center', paddingHorizontal: 20 },

  teamGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  teamCard: { width: 80, borderRadius: 14, borderWidth: 1, alignItems: 'center', paddingBottom: 10, overflow: 'hidden' },
  teamCardBar: { width: '100%', height: 4 },
  teamCardLogo: { width: 52, height: 52, marginTop: 8 },
  teamCardAbbr: { fontSize: 12, fontFamily: F.black, marginTop: 4 },
  teamCardSport: { fontSize: 9, fontFamily: F.regular, letterSpacing: 0.5 },

  playerList: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  playerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, gap: 12 },
  playerHeadshot: { width: 44, height: 44, borderRadius: 22 },
  playerInfo: { flex: 1 },
  playerName: { fontSize: 15, fontFamily: F.bold },
  playerMeta: { fontSize: 11, fontFamily: F.regular, marginTop: 2 },

  settingsCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  settingLabel: { flex: 1, fontSize: 15, fontFamily: F.bold },
  settingValue: { fontSize: 13, fontFamily: F.regular },
  versionText: { fontSize: 11, fontFamily: F.regular, textAlign: 'center', marginTop: 16, letterSpacing: 0.5 },

  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { fontSize: 20, fontFamily: F.black, letterSpacing: 0.5 },
  modalClose: { fontSize: 13, fontFamily: F.black, letterSpacing: 1 },
  sportTabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  sportTab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  sportTabText: { fontSize: 12, fontFamily: F.black, letterSpacing: 1 },
  browseGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 12, paddingHorizontal: 12, gap: 10, justifyContent: 'space-evenly' },
  browseCard: { width: 76, borderRadius: 14, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, gap: 4, position: 'relative' },
  browseLogoImg: { width: 48, height: 48 },
  browseTeamAbbr: { fontSize: 11, fontFamily: F.black, letterSpacing: 0.5 },
  favCheck: { position: 'absolute', top: 6, right: 6 },
  searchBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, marginBottom: 4, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: F.regular },
  favToggle: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
