# Nook 1.3 store release handoff

Status: source prepared for Android and iPhone; not submitted or approved.

## Build and signing

Package/bundle ID: `com.immrtldragon.nook`. Version 1.3.0; build 13.
Keep the Android package and signing identity for any existing Play listing.
The existing friends-only APK workflow is debug signed and is not a Play upload.

1. Run `npm ci`, `npm run check`, and `npx expo install --check`.
2. Run `npx eas-cli login` and `npx eas-cli build:configure` to link this repo to the owner's Expo project. Commit the resulting project ID, never credentials.
3. Run `npm run build:android` for the signed AAB. Use the existing upload keystore if one is already registered in Play Console. Otherwise configure Play App Signing and back up the upload key privately.
4. Run `npm run build:ios` with an Apple Developer team to create the signed iOS archive. Register the matching bundle ID and create its App Store Connect record.
5. Upload Android first to internal testing. `npx eas-cli submit --platform android --profile production` uses an internal draft; first upload may need the Play Console UI. Configure a least-privilege service account privately if using automated submission.
6. Upload iOS to TestFlight with `npx eas-cli submit --platform ios --profile production` after selecting the owner's App Store Connect app.

EAS cloud builds may consume account quota; these commands are provided, not automatically purchased or executed here.

## Required before public submission

- Public privacy policy naming Nook and its operator; support contact and terms/community standards. Do not invent an operator address or contact.
- Public account-deletion request URL, in addition to the in-app account deletion flow.
- Accurate Google Data safety and Apple App Privacy declarations based on the deployed backend, storage, retention and subprocessors.
- Working report/block controls, timely moderation, objectionable-content filtering and community-policy acceptance before posting. Existing report/block screens alone do not establish compliance.
- Social/dating category child-safety requirements, published standards, contact and reporting process where applicable. Nook is adults-only; age declaration is not identity verification.
- Complete content/age ratings, app-access reviewer credentials, screenshots from real builds and store listing assets. Never submit fabricated verification/safety claims.
- Confirm Supabase email callback `nook://auth/callback`, email verification, deletion Edge Function and authorization rules are deployed and working.
- Remove or clearly label remaining sample/local-only functionality, simulated trust and moderation indicators before opening public access. Discovery no longer mixes sample activities into cloud results.

## Phone acceptance matrix (not yet executed)

Test narrow Android (320–360 dp), a standard Pixel, gesture and three-button navigation, small iPhone and a notched iPhone. Test default and large text, keyboard on every form, last input/action visibility, camera denial/retry, QR from photo, notifications denied, offline/reconnect and Android hardware back from a detail.

Use two real phones/accounts for signup and confirmation, create plan, discover, request, host approval/rejection, report/block, and deletion. iPhone simulator checks do not replace real camera/notification testing.

## Source validation

Run `npx expo export --platform android --platform ios` to check both JavaScript bundles. This does not create signed native binaries or verify native device behavior.
