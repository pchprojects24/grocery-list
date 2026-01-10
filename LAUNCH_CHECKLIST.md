# Launch Checklist

Use this checklist to ensure everything is ready before and after launching Young Lists.

## Pre-Launch Checklist

### Firebase Setup
- [ ] Firebase project created
- [ ] Firestore database enabled
- [ ] Security rules published
- [ ] `meta/allowedUsers` document created with empty `uids` array
- [ ] Email/Password authentication enabled
- [ ] Firebase config copied from console
- [ ] Firebase config pasted into `young-lists/app.js`

### Code Configuration
- [ ] Firebase config in `app.js` is complete (all fields filled)
- [ ] No placeholder values remain in config
- [ ] Firebase config NOT committed to public repository (if public)
- [ ] `.gitignore` file is present

### Deployment
- [ ] Repository created on GitHub (or chosen hosting platform)
- [ ] Code pushed to repository
- [ ] GitHub Pages enabled (or alternative hosting configured)
- [ ] Deployment URL confirmed and working
- [ ] HTTPS is enabled (required for PWA)
- [ ] Service Worker registers successfully

### Testing
- [ ] App loads without errors
- [ ] No console errors on load
- [ ] Service Worker registers (check DevTools)
- [ ] Firebase connection established
- [ ] Can see auth screen (login/signup)

### Documentation
- [ ] README.md reviewed and accurate
- [ ] Deployment URL added to documentation (if applicable)
- [ ] Contact information updated (if applicable)

## Launch Checklist

### First User Setup
- [ ] Create first account via the app
- [ ] Note the UID from "Access Not Granted" screen
- [ ] Log into Firebase Console
- [ ] Navigate to Firestore → Data → meta → allowedUsers
- [ ] Add first UID to the `uids` array
- [ ] Save the document
- [ ] Refresh the app
- [ ] Confirm access granted
- [ ] Test creating a list
- [ ] Test adding items
- [ ] Test checking off items

### PWA Testing
- [ ] App can be installed (install prompt appears)
- [ ] App works after installation
- [ ] App icon appears correctly
- [ ] App name appears correctly
- [ ] Splash screen shows during launch

### Offline Testing
- [ ] App works offline (after initial load)
- [ ] Lists are accessible offline
- [ ] Changes sync when back online
- [ ] Service Worker caches resources

### Multi-User Testing
- [ ] Second user can create account
- [ ] Second user sees "Access Not Granted"
- [ ] Add second user's UID to allowed list
- [ ] Second user gains access after refresh
- [ ] Changes sync between users in real-time
- [ ] Both users see same data

### Feature Testing
- [ ] Create multiple lists
- [ ] Rename lists
- [ ] Archive lists
- [ ] Delete lists (if needed for testing)
- [ ] Add single items
- [ ] Add multiple items (comma-separated)
- [ ] Search items
- [ ] Check/uncheck items
- [ ] Delete items
- [ ] Complete a trip
- [ ] View history
- [ ] Restore archived list
- [ ] Use templates

### Mobile Testing
- [ ] Test on iOS Safari
- [ ] Test on Android Chrome
- [ ] Install as PWA on phone
- [ ] Test touch interactions
- [ ] Test keyboard on mobile
- [ ] Test in portrait orientation
- [ ] Test in landscape orientation
- [ ] Bottom navigation works correctly

### Security Testing
- [ ] Cannot access without login
- [ ] Cannot access with login but no allowed UID
- [ ] Can access with login and allowed UID
- [ ] Firestore rules are enforced
- [ ] Cannot modify allowed users from client
- [ ] Logout works correctly

## Post-Launch Checklist

### Monitoring
- [ ] Check Firebase Console → Usage tab for activity
- [ ] Monitor Firestore read/write counts
- [ ] Check Authentication → Users for new sign-ups
- [ ] Review any error logs in Firebase

### User Onboarding
- [ ] Share app URL with family
- [ ] Provide quick start instructions
- [ ] Add new users' UIDs as they sign up
- [ ] Verify all users can access the app

### Maintenance
- [ ] Bookmark Firebase Console for easy access
- [ ] Note the project ID for reference
- [ ] Keep a backup of Firebase config
- [ ] Document any customizations made

## Ongoing Checklist (Monthly)

### Security Review
- [ ] Review allowed users list
- [ ] Remove access for anyone who should no longer have it
- [ ] Check for unusual activity in Firebase Console
- [ ] Verify Firestore rules are still correct

### Usage Review
- [ ] Check Firebase usage (reads/writes/storage)
- [ ] Ensure within free tier limits
- [ ] Review authentication users list
- [ ] Check for orphaned accounts

### Performance
- [ ] Test app performance on various devices
- [ ] Check for console errors
- [ ] Verify offline functionality still works
- [ ] Test service worker updates

### Updates
- [ ] Check for Firebase SDK updates
- [ ] Review security advisories
- [ ] Update documentation if needed
- [ ] Test updates before deploying

## Troubleshooting Checklist

If something goes wrong, check:

### App Won't Load
- [ ] Check browser console for errors
- [ ] Verify Firebase config is complete
- [ ] Confirm deployment URL is correct
- [ ] Check that all files are uploaded
- [ ] Verify HTTPS is enabled
- [ ] Try clearing browser cache

### "Access Not Granted" Persists
- [ ] Verify UID is exactly correct in Firestore
- [ ] Check that UID is in the `uids` array
- [ ] Confirm Firestore document is `meta/allowedUsers`
- [ ] Try logging out and back in
- [ ] Clear browser cache and cookies
- [ ] Check browser console for errors

### Data Not Syncing
- [ ] Check internet connection
- [ ] Verify Firestore rules are published
- [ ] Check browser console for permission errors
- [ ] Confirm all users have allowed UIDs
- [ ] Try refreshing the app

### Service Worker Issues
- [ ] Unregister service worker in DevTools
- [ ] Clear cache in DevTools → Application
- [ ] Hard refresh (Ctrl+Shift+R)
- [ ] Try incognito/private browsing
- [ ] Check that sw.js is accessible

### Installation Issues
- [ ] Verify manifest.json is valid
- [ ] Check that app is served over HTTPS
- [ ] Confirm icons are loading
- [ ] Try different browser
- [ ] Check PWA criteria in Lighthouse

## Emergency Contacts

### Key Resources
- Firebase Console: https://console.firebase.google.com/
- GitHub Repository: [Your repo URL]
- Deployment URL: [Your app URL]

### Important IDs
- Firebase Project ID: _______________
- GitHub Repo: _______________
- First Admin UID: _______________

### Access
- Firebase Owner Email: _______________
- GitHub Account: _______________
- Hosting Account: _______________

## Notes

Space for deployment-specific notes:

_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________

---

**Completion:**
- Pre-Launch: _____ / _____ items
- Launch: _____ / _____ items
- Post-Launch: _____ / _____ items

**Launched by:** _______________
**Launch Date:** _______________
**App URL:** _______________

---

**Status:** 
- [ ] Pre-Launch Phase
- [ ] Launch Phase
- [ ] Post-Launch Phase
- [ ] Live and Monitored

🎉 **Congratulations on launching Young Lists!** 🎉
