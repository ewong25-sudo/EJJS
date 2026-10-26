#!/bin/bash
# Double-click this file to launch the EJJS app.
# Uses LAN mode — your phone must be on the SAME Wi-Fi as this Mac.
# A QR code appears below; scan it with the Expo Go app.

cd "$(dirname "$0")/mobile" || exit 1

echo "============================================"
echo "   Starting EJJS App..."
echo "   A QR code will appear below in ~15 sec."
echo "   Scan it with Expo Go on your phone."
echo "   (Phone must be on the same Wi-Fi as this Mac)"
echo "   (Keep this window open while using the app)"
echo "============================================"
echo ""

npx expo start --lan
