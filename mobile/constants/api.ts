// API base URL. Set EXPO_PUBLIC_API_URL in eas.json (per build profile) to
// point at your deployed server when building beta. Falls back to your LAN
// IP for on-device dev via Expo Go.
//   Local dev:   ipconfig getifaddr en0  →  http://<your-ip>:3001
//   Beta build:  https://<your-app>.up.railway.app
export const API =
  process.env.EXPO_PUBLIC_API_URL ||
  'http://100.115.252.59:3001';
