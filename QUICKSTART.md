# Quick Start Guide

Get Young Lists running in 15 minutes!

## What You'll Do

1. Set up Firebase (8 min)
2. Configure the code (2 min)
3. Deploy to GitHub Pages (3 min)
4. Create your account (2 min)

## Prerequisites

- [ ] GitHub account
- [ ] Firebase account (create at https://firebase.google.com)
- [ ] Text editor

## Step 1: Firebase Setup (8 minutes)

### Create Project
1. Go to https://console.firebase.google.com/
2. Click "Add project"
3. Name it "young-lists"
4. Disable Analytics (optional)
5. Click "Create project"

### Enable Firestore
1. Click "Firestore Database" in sidebar
2. Click "Create database"
3. Choose "Production mode"
4. Select a location
5. Click "Enable"

### Add Security Rules
1. Go to "Rules" tab
2. Copy rules from `DEPLOYMENT_GUIDE.md` section 1.3
3. Click "Publish"

### Create Allowed Users Document
1. Go to "Data" tab
2. Click "Start collection"
3. Collection ID: `meta`
4. Document ID: `allowedUsers`
5. Add field: `uids` (type: array, value: empty)
6. Click "Save"

### Enable Authentication
1. Click "Authentication" in sidebar
2. Click "Get started"
3. Click "Email/Password"
4. Enable it
5. Click "Save"

### Get Config
1. Click ⚙️ → "Project settings"
2. Scroll to "Your apps"
3. Click web icon `</>`
4. Register app as "young-lists"
5. Copy the `firebaseConfig` object

## Step 2: Configure Code (2 minutes)

1. Open `young-lists/app.js`
2. Find the `firebaseConfig` object (line 29)
3. Replace it with your copied config
4. Save the file

Should look like:
```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  // ... rest of config
};
```

## Step 3: Deploy (3 minutes)

### GitHub Pages
1. Create a GitHub repository
2. Push your code:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```
3. Go to Settings → Pages
4. Source: "Deploy from branch"
5. Branch: "main" / "(root)"
6. Click "Save"
7. Wait 1-2 minutes
8. Copy your URL: `https://username.github.io/repo-name/`

## Step 4: First Use (2 minutes)

1. Open your deployed URL
2. Click "Create Account"
3. Enter email and password
4. You'll see "Access Not Granted" - this is normal!
5. Copy your UID from the screen
6. Go to Firebase Console → Firestore → Data → meta → allowedUsers
7. Edit `uids` array, add your UID
8. Save
9. Refresh your app
10. You're in! 🎉

## What's Next?

- Create your first list
- Add items
- Invite family (add their UIDs)
- Customize templates in `app.js`

## Need Help?

- Full instructions: `DEPLOYMENT_GUIDE.md`
- Security info: `SECURITY.md`
- Troubleshooting: `README.md`

## Common Issues

**"Firebase Config missing"**
- You didn't paste the config in app.js

**"Still seeing Access Denied"**
- Clear browser cache and refresh
- Check your UID is exactly in the array

**"App not loading"**
- Wait for GitHub Pages (can take 2-3 minutes)
- Check that all files are in the repo

---

That's it! You now have a fully functional shared grocery list app! 🛒✅
