# Security Guide for Young Lists

## Overview

Young Lists implements a multi-layered security approach to protect your household data:

1. **Firebase Authentication** - Only authenticated users can access the system
2. **Firestore Security Rules** - Database-level access control
3. **Allowed Users List** - Household-specific whitelist
4. **HTTPS Only** - Encrypted communication (enforced by hosting)

## Security Architecture

### Layer 1: Firebase Authentication

All users must sign up with email/password. This provides:
- Secure credential storage (handled by Firebase)
- Password hashing and salting
- Brute force protection
- Session management

**Best Practices:**
- Use strong, unique passwords
- Don't share account credentials
- Each family member should have their own account

### Layer 2: Firestore Security Rules

The database rules enforce:
- No anonymous access
- No access without valid authentication token
- All operations require allowed UID check

```javascript
function isAllowed() {
  return request.auth != null && 
         request.auth.uid in get(/databases/$(database)/documents/meta/allowedUsers).data.uids;
}
```

This means:
1. User must be authenticated (`request.auth != null`)
2. User's UID must be in the allowed list
3. Rules are evaluated server-side (cannot be bypassed)

### Layer 3: Allowed Users Whitelist

The `meta/allowedUsers` document:
- Can only be modified from Firebase Console (admin access)
- Client-side code can only read it
- Provides household-level isolation

**Important:** The `write: if false` rule prevents any client from modifying the allowed users list.

### Layer 4: HTTPS Transport

All communication is encrypted:
- Firebase SDKs require HTTPS
- GitHub Pages provides free HTTPS
- Service Workers require HTTPS

## Security Checklist

### Initial Setup
- [ ] Security rules are published in Firestore
- [ ] `meta/allowedUsers` document exists
- [ ] Email/Password authentication is enabled
- [ ] App is served over HTTPS
- [ ] Firebase config keys are not exposed in public repo

### Ongoing Maintenance
- [ ] Regularly review allowed users list
- [ ] Remove access for users who should no longer have it
- [ ] Monitor Firebase Console for unusual activity
- [ ] Keep Firebase SDKs updated
- [ ] Review Firestore security rules after any changes

## Common Security Questions

### Q: Is it safe to expose Firebase API keys in client code?

**A:** Yes, for this use case. Firebase API keys are not secret - they identify your Firebase project. The security comes from:
1. Firestore Security Rules (server-side)
2. Authentication requirements
3. Allowed users whitelist

However, you should still:
- Limit API key permissions in Firebase Console
- Enable App Check for additional protection (optional)
- Monitor usage to detect abuse

### Q: Can someone access my data if they have the Firebase config?

**A:** No. They would need:
1. A valid account (email/password)
2. Their UID in your allowed users list
3. Both requirements must be met

### Q: How do I revoke someone's access?

**A:** Two steps:
1. Remove their UID from `meta/allowedUsers` in Firebase Console
2. (Optional) Delete their auth account in Firebase Console → Authentication

### Q: What if someone gets my Firebase Console access?

**A:** Firebase Console access is protected by your Google account. Use:
- Strong Google account password
- Two-factor authentication on Google account
- Review authorized devices regularly

### Q: Can users see each other's email addresses?

**A:** No. The app only stores UIDs in the allowed list. Email addresses are stored in Firebase Authentication and are not accessible to other users.

## Firestore Rules Explained

### Meta Collection

```javascript
match /meta/allowedUsers {
  allow read: if request.auth != null;
  allow write: if false;
}
```

- **read**: Any authenticated user can read (needed to check permissions)
- **write**: No client can write (admin console only)

### Lists Collection

```javascript
match /lists/{listId} {
  allow read, write: if isAllowed();
  
  match /items/{itemId} {
    allow read, write: if isAllowed();
  }
}
```

- Only allowed users can read or write lists
- Only allowed users can read or write items
- Applies to all lists and all items

### History Collection

```javascript
match /history/{tripId} {
  allow read, write: if isAllowed();
  
  match /items/{itemId} {
    allow read, write: if isAllowed();
  }
}
```

- Same protection for history data
- Completed trips are also protected

## Advanced Security (Optional)

### Firebase App Check

For additional protection against abuse:

1. Go to Firebase Console → App Check
2. Enable App Check
3. Register your web app
4. Add reCAPTCHA or other provider
5. Enforce App Check in Firestore rules

### API Key Restrictions

1. Go to Google Cloud Console
2. Find your Firebase API keys
3. Restrict to:
   - Specific websites (your GitHub Pages domain)
   - Specific APIs (Firestore, Auth only)

### Audit Logging

Monitor access:

1. Enable Firestore audit logs in Google Cloud Console
2. Review Cloud Logging for unusual patterns
3. Set up alerts for suspicious activity

## Data Privacy

### What data is stored:

**In Firestore:**
- List names
- Item names
- Item notes
- Completion timestamps
- User IDs (UIDs)

**In Firebase Auth:**
- Email addresses
- Password hashes (encrypted by Firebase)

**NOT stored:**
- Physical addresses
- Payment information
- Personal details beyond email

### Data location:

- Stored in the Firestore region you selected during setup
- Backed up by Google automatically
- Subject to Google Cloud's security and compliance

### Data access:

- You (the project owner) via Firebase Console
- Allowed users via the app
- No one else (including Google employees, except for system maintenance)

## Incident Response

### If you suspect unauthorized access:

1. **Immediately:**
   - Go to Firebase Console → Firestore
   - Check `meta/allowedUsers` for unexpected UIDs
   - Remove any unauthorized UIDs

2. **Review:**
   - Firebase Console → Authentication → Users
   - Look for unfamiliar accounts
   - Delete unauthorized accounts

3. **Check activity:**
   - Firestore → Data
   - Look for unexpected lists or items
   - Check History for unusual activity

4. **Secure:**
   - Change your Google account password
   - Enable 2FA on Google account
   - Review Firestore rules are correct

5. **Notify:**
   - Tell household members to change passwords
   - Verify all allowed UIDs are legitimate

### If Firebase config is exposed publicly:

1. **Don't panic** - API keys alone don't grant access
2. **Verify** - Check that security rules are correct
3. **Optional** - Regenerate API keys in Firebase Console
4. **Monitor** - Watch usage for unusual patterns
5. **Consider** - Enable App Check for additional protection

## Compliance Notes

### GDPR (European Users)

If you have users in the EU:
- Inform them about data collection (email, usage data)
- Provide a way to delete their data
- Respect data subject rights
- Consider a privacy policy

### To delete a user's data:

1. Remove their UID from allowed users
2. Delete their auth account
3. (Optional) Search Firestore for any data they created and delete it

### CCPA (California Users)

Similar requirements to GDPR for California residents.

## Security Updates

### Keeping the app secure:

1. **Firebase SDKs:**
   - Currently using CDN version 10.7.1
   - Check for updates: https://firebase.google.com/support/release-notes/js
   - Update version numbers in `index.html` and `app.js`

2. **Security Rules:**
   - Review quarterly
   - Test with Firebase Emulator
   - Keep documentation updated

3. **Browser Security:**
   - Modern browsers auto-update
   - Encourage users to keep browsers current
   - Test on latest browser versions

## Testing Security

### Manual testing:

1. **Create a test account** (not in allowed list)
2. **Verify access denied** screen appears
3. **Check browser console** for Firestore permission errors
4. **Add UID to allowed list**
5. **Verify access granted**

### Automated testing:

Use Firebase Emulator Suite (advanced):

```bash
npm install -g firebase-tools
firebase init emulators
firebase emulators:start
```

Test rules without affecting production data.

## Reporting Security Issues

If you discover a security vulnerability:

1. Do NOT post publicly
2. Contact the repository owner directly
3. Provide details of the vulnerability
4. Allow time for a fix before disclosure

## Additional Resources

- [Firebase Security Documentation](https://firebase.google.com/docs/rules)
- [Firestore Security Rules Guide](https://firebase.google.com/docs/firestore/security/get-started)
- [Firebase Authentication Best Practices](https://firebase.google.com/docs/auth/best-practices)
- [OWASP Web Security](https://owasp.org/www-project-web-security-testing-guide/)

---

**Remember:** Security is a continuous process, not a one-time setup. Regularly review and update your security practices.
