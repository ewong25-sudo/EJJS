import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { F } from '@/constants/fonts';
import { API } from '@/constants/api';

// Lazy-import WebView + native CookieManager so the app still bundles when
// running in Expo Go (which doesn't support these native modules). In a real
// EAS build they render/work normally.
let WebView: any = null;
try { WebView = require('react-native-webview').WebView; } catch {}
// NOTE: @react-native-cookies/cookies uses `module.exports = { get, set, ... }`
// — there is NO `.default`. Grabbing `.default` left CookieManager undefined,
// which made the whole flow report "not available". Fall back to the module
// object itself so we get the real native binding.
let CookieManager: any = null;
try {
  const mod = require('@react-native-cookies/cookies');
  CookieManager = mod?.default ?? mod;
} catch {}

// NOTE: espn_s2 is an HttpOnly cookie, so document.cookie CANNOT read it — only
// the native cookie store can. We use CookieManager (below) to read both
// espn_s2 and SWID after login. The injected JS just nudges us to re-check the
// native store whenever the page navigates (e.g. after a successful sign-in).
const PING_ON_NAV_JS = `
  (function() {
    try { window.ReactNativeWebView.postMessage('nav'); } catch (e) {}
    true;
  })();
`;

interface Props {
  visible: boolean;
  onClose: () => void;
  onConnected: () => void;
  dark: boolean;
}

export function EspnLoginWebView({ visible, onClose, onConnected, dark }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const claimedRef = useRef(false);    // prevent double-submit

  const webRef = useRef<any>(null);
  const navNudgedRef = useRef(false);  // only auto-route to fantasy once

  // Reset state every time the modal opens
  useEffect(() => {
    if (visible) { claimedRef.current = false; navNudgedRef.current = false; }
  }, [visible]);

  // Poll the cookie store every 2s while the modal is open. ESPN sets the
  // session cookies a moment after login completes, and there may be no further
  // navigation event to trigger capture — so we actively check.
  useEffect(() => {
    if (!visible || !CookieManager) return;
    const t = setInterval(() => { tryCaptureFromCookieStore(); }, 2000);
    return () => clearInterval(t);
  }, [visible]);

  async function submitCookies(s2: string, swid: string) {
    if (claimedRef.current || submitting) return;
    claimedRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/espn/fantasy/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ espn_s2: s2, swid }),
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Could not connect', data.error || 'ESPN rejected the cookies.');
        claimedRef.current = false;
      } else {
        onConnected();
        onClose();
      }
    } catch {
      Alert.alert('Network error', 'Could not reach the app server.');
      claimedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  // Read both ESPN cookies (incl. HttpOnly espn_s2) from the native cookie
  // store. ESPN sets espn_s2 on .espn.com and SWID on both .espn.com and
  // .go.com (Disney auth), so we sweep several domains AND both cookie stores
  // (WKWebView store via useWebKit=true, and the legacy NSHTTPCookieStorage via
  // useWebKit=false) because iOS versions differ on where WebView cookies land.
  async function readEspnCookies(): Promise<{ s2: string; swid: string }> {
    if (!CookieManager) return { s2: '', swid: '' };
    const domains = [
      'https://fantasy.espn.com',
      'https://www.espn.com',
      'https://espn.com',
      'https://a.espncdn.com',
      'https://go.com',
      'https://registerdisney.go.com',
    ];
    const calls: Promise<any>[] = [];
    for (const d of domains) {
      calls.push(CookieManager.get(d, true).catch(() => ({})));   // WKWebView store
      calls.push(CookieManager.get(d, false).catch(() => ({})));  // legacy store
    }
    const stores = await Promise.all(calls);
    let s2 = '', swid = '';
    for (const c of stores) {
      if (c?.espn_s2?.value) s2 = c.espn_s2.value;
      if (c?.SWID?.value) swid = c.SWID.value;
    }
    return { s2, swid };
  }

  // Auto-poll path: silently submit once both cookies appear.
  async function tryCaptureFromCookieStore() {
    if (!CookieManager || claimedRef.current) return;
    const { s2, swid } = await readEspnCookies();
    if (s2 && swid) submitCookies(decodeURIComponent(s2), swid);
  }

  // Manual "Connect" tap: report exactly what we found so the user isn't stuck
  // guessing. If cookies aren't set yet, nudge to the fantasy page (which forces
  // ESPN to write espn_s2/SWID) and let the poller catch them.
  async function manualConnect() {
    if (!CookieManager) {
      Alert.alert('Not available', 'In-app login needs the installed app build.');
      return;
    }
    const { s2, swid } = await readEspnCookies();
    if (s2 && swid) {
      submitCookies(decodeURIComponent(s2), swid);
      return;
    }
    // Force ESPN to mint the session cookies by loading the fantasy home.
    webRef.current?.injectJavaScript?.(
      `window.location.href='https://fantasy.espn.com/';true;`
    );
    const found = [s2 ? 'espn_s2 ✓' : 'espn_s2 ✗', swid ? 'SWID ✓' : 'SWID ✗'].join('   ');
    Alert.alert(
      'Finishing sign-in…',
      `Opening your ESPN fantasy page to capture the session.\n\nDetected so far:\n${found}\n\nIf it doesn't connect in ~5 seconds, make sure you're fully logged in (you should see your teams), then tap Connect again.`
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: dark ? '#000' : '#fff' }]}>
        <View style={[styles.header, { borderBottomColor: dark ? '#2c2c2e' : '#e5e5ea' }]}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={[styles.cancel, { color: dark ? '#fff' : '#000' }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.title, { color: dark ? '#fff' : '#000' }]}>Log into ESPN</Text>
          {/* Manual "Connect" — tap after logging in if auto-detect misses. */}
          <Pressable onPress={manualConnect} hitSlop={10} disabled={submitting}>
            <Text style={[styles.connect, { color: submitting ? '#8e8e93' : '#0a84ff' }]}>
              {submitting ? '…' : 'Connect'}
            </Text>
          </Pressable>
        </View>

        {/* Helper banner so the user knows what to do */}
        <View style={[styles.banner, { backgroundColor: dark ? '#1c1c1e' : '#f2f2f7' }]}>
          <Text style={[styles.bannerText, { color: dark ? '#aeaeb2' : '#3a3a3c' }]}>
            Log into ESPN below, then tap <Text style={{ fontFamily: F.bold }}>Connect</Text> at the top right.
          </Text>
        </View>

        {!WebView ? (
          // Fallback when WebView is unavailable (Expo Go, web)
          <View style={styles.fallback}>
            <Text style={[styles.fallbackTitle, { color: dark ? '#fff' : '#000' }]}>
              In-app ESPN login isn't available here
            </Text>
            <Text style={[styles.fallbackBody, { color: dark ? '#8e8e93' : '#666' }]}>
              This works in the installed app build. In Expo Go / web preview,
              use the manual cookie entry instead.
            </Text>
          </View>
        ) : (
          <WebView
            ref={webRef}
            // Start directly on the fantasy login — after auth ESPN lands you on
            // fantasy.espn.com and writes espn_s2/SWID on .espn.com immediately,
            // instead of the generic homepage which may not set them.
            source={{ uri: 'https://www.espn.com/fantasy/' }}
            // Re-check the native cookie store on every navigation + page load.
            // After a successful sign-in ESPN sets espn_s2 (HttpOnly) + SWID,
            // which CookieManager can read even though page JS cannot.
            injectedJavaScript={PING_ON_NAV_JS}
            onLoadEnd={() => { tryCaptureFromCookieStore(); }}
            onNavigationStateChange={(s: any) => {
              tryCaptureFromCookieStore();
              // Once the user is back on an espn.com page (post-login) but not on
              // a fantasy page yet, auto-route to fantasy once so cookies mint.
              const url: string = s?.url || '';
              if (!navNudgedRef.current && /(^|\.)espn\.com/.test(url) && !/fantasy\.espn\.com/.test(url) && !/login|register|disney/i.test(url)) {
                navNudgedRef.current = true;
                setTimeout(() => {
                  webRef.current?.injectJavaScript?.(`window.location.href='https://fantasy.espn.com/';true;`);
                }, 500);
              }
            }}
            onMessage={() => { tryCaptureFromCookieStore(); }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            originWhitelist={['*']}
            startInLoadingState
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancel: { fontSize: 16, fontFamily: F.regular },
  connect: { fontSize: 16, fontFamily: F.bold },
  title:  { fontSize: 16, fontFamily: F.black, letterSpacing: 0.5 },
  banner: { paddingHorizontal: 16, paddingVertical: 8 },
  bannerText: { fontSize: 12, fontFamily: F.regular, textAlign: 'center' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  fallbackTitle: { fontSize: 16, fontFamily: F.black, textAlign: 'center' },
  fallbackBody:  { fontSize: 13, fontFamily: F.regular, textAlign: 'center', lineHeight: 18 },
});
