import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { F } from '@/constants/fonts';

interface ChatMessage {
  id: string;
  user: string;
  text: string;
  ts: number;             // unix ms
  color: string;          // accent color for the user bubble
}

interface Props {
  gameId: string;
  text: string;
  sub: string;
  cardBg: string;
  border: string;
  bg: string;
}

const HANDLES = [
  'Sportsfan42', 'BleacherCreature', 'StatHead', 'CourtSide', 'ChalkBoard',
  'Underdog', 'BettorLuck', 'ParlayKing', 'BoxScoreBob', 'HotTake',
];

// Pick a stable handle + color the first time the user joins a chat
const PALETTE = ['#34c759', '#0a84ff', '#ff9f0a', '#ff453a', '#bf5af2', '#5e5ce6', '#ff375f', '#30d158'];

async function getOrCreateIdentity(): Promise<{ user: string; color: string }> {
  try {
    const raw = await AsyncStorage.getItem('@chat_identity');
    if (raw) return JSON.parse(raw);
    const user = HANDLES[Math.floor(Math.random() * HANDLES.length)] +
      Math.floor(Math.random() * 999);
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const id = { user, color };
    await AsyncStorage.setItem('@chat_identity', JSON.stringify(id));
    return id;
  } catch {
    return { user: 'Guest' + Math.floor(Math.random() * 999), color: '#888' };
  }
}

function storageKey(gameId: string) { return `@chat:${gameId}`; }

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function GameChat({ gameId, text, sub, cardBg, border, bg }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [me, setMe] = useState<{ user: string; color: string } | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // Load identity + messages
  useEffect(() => {
    getOrCreateIdentity().then(setMe);
    AsyncStorage.getItem(storageKey(gameId)).then(raw => {
      const welcome = {
        id: 'sys-0',
        user: 'EJJS',
        text: "Welcome to game chat! It's game time 🦾🏆",
        ts: Date.now() - 60_000,
        color: '#FFD700',
      };
      if (raw) {
        try {
          const saved = JSON.parse(raw);
          // Upgrade any old welcome message to the new copy
          const upgraded = saved.map((m: ChatMessage) =>
            m.id === 'sys-0' ? { ...m, text: welcome.text } : m
          );
          setMessages(upgraded);
        } catch {
          setMessages([welcome]);
        }
      } else {
        setMessages([welcome]);
      }
    });
  }, [gameId]);

  // Persist messages on change
  useEffect(() => {
    if (messages.length > 0) {
      AsyncStorage.setItem(storageKey(gameId), JSON.stringify(messages)).catch(() => {});
    }
  }, [messages, gameId]);

  const send = () => {
    const t = draft.trim();
    if (!t || !me) return;
    const msg: ChatMessage = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user: me.user,
      text: t,
      ts: Date.now(),
      color: me.color,
    };
    setMessages(prev => [...prev, msg]);
    setDraft('');
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isMine = me?.user === item.user;
    return (
      <Animated.View entering={FadeIn.duration(200)} style={[
        chatStyles.bubbleRow,
        isMine && { flexDirection: 'row-reverse' },
      ]}>
        <View style={[chatStyles.avatar, { backgroundColor: item.color }]}>
          <Text style={chatStyles.avatarText}>{item.user.slice(0, 2).toUpperCase()}</Text>
        </View>
        <View style={[
          chatStyles.bubble,
          { backgroundColor: cardBg, borderColor: border },
          isMine && { backgroundColor: item.color + '30', borderColor: item.color + '60' },
        ]}>
          <View style={chatStyles.bubbleHeader}>
            <Text style={[chatStyles.bubbleUser, { color: item.color }]}>{item.user}</Text>
            <Text style={[chatStyles.bubbleTime, { color: sub }]}>{fmtTime(item.ts)}</Text>
          </View>
          <Text style={[chatStyles.bubbleText, { color: text }]}>{item.text}</Text>
        </View>
      </Animated.View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Live indicator + viewer count (mocked) */}
      <View style={chatStyles.banner}>
        <View style={chatStyles.dot} />
        <Text style={chatStyles.bannerText}>LIVE CHAT</Text>
        <Text style={[chatStyles.viewerCount, { color: sub }]}>
          {Math.max(12, messages.length * 7 + 19)} viewing
        </Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={renderMessage}
        contentContainerStyle={chatStyles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {/* Composer */}
      <View style={[chatStyles.composer, { backgroundColor: cardBg, borderTopColor: border }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Say something about the game…"
          placeholderTextColor={sub}
          style={[chatStyles.input, { color: text, backgroundColor: bg, borderColor: border }]}
          onSubmitEditing={send}
          returnKeyType="send"
          maxLength={240}
        />
        <Pressable onPress={send} style={[chatStyles.sendBtn, !draft.trim() && { opacity: 0.4 }]}>
          <Text style={chatStyles.sendBtnText}>SEND</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const chatStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ff3b30' },
  bannerText: { color: '#ff3b30', fontSize: 10, fontFamily: F.black, letterSpacing: 1.5 },
  viewerCount: { fontSize: 11, fontFamily: F.regular, flex: 1, textAlign: 'right' },

  list: { padding: 12, gap: 8 },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 9, fontFamily: F.black, color: '#fff', letterSpacing: 0.5 },
  bubble: {
    flex: 1,
    maxWidth: '78%',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 2,
  },
  bubbleUser: { fontSize: 11, fontFamily: F.black, letterSpacing: 0.5 },
  bubbleTime: { fontSize: 9, fontFamily: F.regular },
  bubbleText: { fontSize: 13, fontFamily: F.regular, lineHeight: 17 },

  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: F.regular,
  },
  sendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#FFD700',
  },
  sendBtnText: { fontSize: 11, fontFamily: F.black, color: '#000', letterSpacing: 1 },
});
