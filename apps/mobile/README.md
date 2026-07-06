# Fxl Sales — mobile

Expo Router + React Native + NativeWind + Clerk Expo. **Standalone — not part of the root pnpm workspace.**

## Why standalone?

Expo SDK 54 + React Native 0.81 + React 19.1 conflict with React 18 pinned by `apps/web`. Sharing a pnpm scope causes hoist battles. The mobile app has its own `pnpm-lock.yaml`.

## Setup

```bash
cd apps/mobile
pnpm install
cp .env.example .env  # fill in EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY + EXPO_PUBLIC_API_URL
pnpm start            # opens Expo dev tools
```

## Run on device

- **iOS Simulator**: press `i` in Expo CLI
- **Android Emulator**: press `a`
- **Expo Go (phone)**: scan QR code (limited features — for full Clerk flow, use a dev build)
- **Dev build**: `pnpm ios` / `pnpm android` (requires Xcode / Android Studio)

## Layout

```
app/
├── _layout.tsx           ClerkProvider + QueryClient + Stack
├── index.tsx             /              → redirect to (auth) or (tabs)
├── (auth)/
│   ├── _layout.tsx
│   └── sign-in.tsx       email + password sign-in (replaceable with social)
└── (tabs)/
    ├── _layout.tsx       Tab navigator (Home / Settings)
    ├── index.tsx         Home — 2 KPICards (placeholder values)
    └── settings.tsx      Logged-in user + sign-out
components/
└── KPICard.tsx           Native version of the web KPICard
lib/
└── clerk-token-cache.ts  expo-secure-store wrapper for Clerk JWT cache
```

## NativeWind

Tailwind classes work via `className=`. Tokens live in `tailwind.config.js`. The shared theme tokens in `packages/shared-utils/src/theme.ts` are NOT imported here directly (different pnpm scope) — keep `tailwind.config.js` in sync manually.
