# Nook Android

An activity-first friendship app for India. People discover small, intentional plans by activity, approximate place, time and language instead of swiping through profiles.

## Run on Android

1. Install Node.js 20 or newer and the Expo Go app on your Android phone.
2. In this folder, run `npm install`.
3. Run `npx expo start`.
4. Scan the QR code with Expo Go. Phone and computer should be on the same network.

If dependency versions have advanced, create a current Expo project using `npx create-expo-app@latest`, then replace its `App.tsx` with the one here.

## Included in this prototype

- Android-first discovery screen
- Sports, language, games and exploration filters
- Approximate areas rather than public precise locations
- Join-request interaction
- Plans and request state
- Profile and interests
- Safety-first product copy
- Women-only groups with verified-membership indicators
- New-city outings, travel, restaurant hopping and shopping
- Private QR connection concept with no exposed phone number
- Optional private messaging after mutual connection
- Women-led post-meet safety score shown on group cards
- Trusted-member day trips with a separate gated creation flow
- Real create-plan form backed by on-phone SQLite storage
- Parameterized SQLite writes and schema validation
- First-run onboarding stored locally on the phone
- Editable name, city area, languages, interests and bio
- Random internal connection code that never exposes a phone number
- Real QR generation with a five-minute expiry
- Camera QR scanning requested only while the scanner is opened
- Self-scan, expired-code and duplicate-connection protection
- Pending connections stored locally without contact details
- Persistent activity groups and join-approval requests
- Women-only and trusted-member-only group controls
- Women-only local safety ratings
- Host console for approving and rejecting join requests
- Member removal and blocking controls
- Report review state and reversible seven-day restrictions
- Explicit test-request generator for previewing host workflows offline

## Prototype boundary

This build demonstrates the product rules locally. Gender/face verification, cross-device discovery, moderation investigations, bans and private messaging require a secure backend before public release. Self-declared gender must not be treated as verification in production.

## Trust rules

- Face verification confirms that a live person matches their profile photo; raw face media should not be retained by the app.
- Women-only groups require a verified eligible account before requesting entry.
- Only verified women who attended can contribute to the public group safety score.
- Low scores restrict new joins and open a moderator review. They never cause an automatic permanent ban by themselves.
- Confirmed serious violations can suspend or permanently ban the responsible account.

## Trusted trip eligibility

- Adult and verified profile
- At least three successfully attended local plans
- No active safety restriction or unresolved serious report
- Trip host must have successfully hosted or attended local plans
- V0 permits local day trips starting from a public place
- Transport, cost, return time and emergency-sharing agreement are mandatory
- Private stays, international travel and trips with unverified members are deferred

## Next milestone

Add a small secure backend for authentication, cross-device group discovery and verified moderation. Replace the local test request with authenticated incoming requests. Do not add chat or maps until access-control rules are tested.
