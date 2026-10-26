import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const TEAMS_KEY = 'ejjs:favoriteTeams';
const PLAYERS_KEY = 'ejjs:favoritePlayers';

export interface FavoriteTeam {
  id: string;
  sport: string;
  abbreviation: string;
  displayName: string;
  logo: string;
  color: string;
}

export interface FavoritePlayer {
  id: string;
  name: string;
  headshot: string;
  position: string;
  teamAbbr: string;
  sport: string;
}

export function useFavorites() {
  const [teams, setTeams] = useState<FavoriteTeam[]>([]);
  const [players, setPlayers] = useState<FavoritePlayer[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(TEAMS_KEY),
      AsyncStorage.getItem(PLAYERS_KEY),
    ]).then(([t, p]) => {
      if (t) setTeams(JSON.parse(t));
      if (p) setPlayers(JSON.parse(p));
      setLoaded(true);
    });
  }, []);

  const toggleTeam = useCallback((team: FavoriteTeam) => {
    setTeams(prev => {
      const exists = prev.some(t => t.id === team.id && t.sport === team.sport);
      const next = exists
        ? prev.filter(t => !(t.id === team.id && t.sport === team.sport))
        : [...prev, team];
      AsyncStorage.setItem(TEAMS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const togglePlayer = useCallback((player: FavoritePlayer) => {
    setPlayers(prev => {
      const exists = prev.some(p => p.id === player.id);
      const next = exists ? prev.filter(p => p.id !== player.id) : [...prev, player];
      AsyncStorage.setItem(PLAYERS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isTeamFav = useCallback((id: string, sport: string) =>
    teams.some(t => t.id === id && t.sport === sport), [teams]);

  const isPlayerFav = useCallback((id: string) =>
    players.some(p => p.id === id), [players]);

  return { teams, players, toggleTeam, togglePlayer, isTeamFav, isPlayerFav, loaded };
}
