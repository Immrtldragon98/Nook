# Nook release checklist

Before each public release:

1. Run `npm run check` and create the standalone Android APK.
2. Check Supabase Security and Performance Advisors; resolve new warnings.
3. Test signup, email confirmation, username/email login, password reset and account deletion with separate accounts.
4. Test plan request, host approval, notification, QR connection, report, block and moderator workflow.
5. Confirm no service-role key is packaged in the APK and review the app's publishable environment values.
6. Verify the release has a higher Android version code and installs as an update.
7. Review database usage and create/export a recovery copy before material schema changes. Free Supabase projects do not provide downloadable automated backups.
8. Review user reports daily during beta; document any account restriction decisions.
9. Before Play Store launch, obtain reviewed external Terms of Service and Privacy Policy and configure a support contact.

Current deferred items: phone OTP, remote push notifications and partner booking/payment integrations.
