# Deployment Guide for Young Lists

This guide will walk you through deploying the Young Lists app from start to finish.

## Before You Begin

You'll need:
- [ ] A GitHub account
- [ ] A Firebase account (free tier is fine)
- [ ] About 15-20 minutes

## Step-by-Step Deployment

### Part 1: Firebase Setup (10 minutes)

#### 1.1 Create Firebase Project

1. Go to https://console.firebase.google.com/
2. Click **"Add project"**
3. Enter project name: `young-lists` (or your preferred name)
4. Click **Continue**
5. Disable Google Analytics (optional for this app)
6. Click **Create project**
7. Wait for project creation, then click **Continue**

#### 1.2 Set Up Firestore Database

1. In the left sidebar, click **Build → Firestore Database**
2. Click **"Create database"**
3. Select **"Start in production mode"**
4. Click **Next**
5. Choose your Cloud Firestore location (pick one close to you)
6. Click **Enable**
7. Wait for database creation

#### 1.3 Configure Security Rules

1. Click on the **Rules** tab
2. Delete all existing rules
3. Copy and paste the following:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function to check if user is allowed
    function isAllowed() {
      return request.auth != null && request.auth.uid in get(/databases/$(database)/documents/meta/allowedUsers).data.uids;
    }

    // Meta collection: Only allowed users can read. NO ONE can write from client (admin only).
    match /meta/allowedUsers {
      allow read: if request.auth != null;
      allow write: if false; // Admin console only
    }

    // Lists collection: Only allowed users can read/write
    match /lists/{listId} {
      allow read, write: if isAllowed();
      
      match /items/{itemId} {
        allow read, write: if isAllowed();
      }
    }

    // History collection: Only allowed users
    match /history/{tripId} {
      allow read, write: if isAllowed();
      
      match /items/{itemId} {
         allow read, write: if isAllowed();
      }
    }
  }
}
```

4. Click **Publish**

#### 1.4 Create the Allowed Users Document

This is CRITICAL - the app won't work without this:

1. Click on the **Data** tab (next to Rules)
2. Click **"Start collection"**
3. Collection ID: `meta`
4. Click **Next**
5. Document ID: `allowedUsers` (type this exactly)
6. Click **"Add field"**:
   - Field: `uids`
   - Type: Select **array** from dropdown
   - Value: Leave empty (just create the array)
7. Click **Save**

You should now see: `meta → allowedUsers → uids: []`

#### 1.5 Enable Authentication

1. In the left sidebar, click **Build → Authentication**
2. Click **"Get started"**
3. Click on **Sign-in method** tab
4. Click on **Email/Password** row
5. Toggle **Enable** on
6. Click **Save**

#### 1.6 Get Your Firebase Config

1. Click the gear icon ⚙️ next to "Project Overview"
2. Click **Project settings**
3. Scroll down to **"Your apps"** section
4. Click the web icon **`</>`** (looks like code brackets)
5. App nickname: `young-lists`
6. Do NOT check "Firebase Hosting" checkbox
7. Click **Register app**
8. Copy the entire `firebaseConfig` object (the part that looks like this):

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "young-lists-xxx.firebaseapp.com",
  projectId: "young-lists-xxx",
  storageBucket: "young-lists-xxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

9. Keep this window open - you'll need it in the next section

### Part 2: Code Configuration (2 minutes)

#### 2.1 Update Firebase Config

1. Open the file `young-lists/app.js` in a text editor
2. Find lines 29-35 (the empty `firebaseConfig` object)
3. Replace it with your config from step 1.6
4. Save the file

Your config should look like this:

```javascript
const firebaseConfig = {
    apiKey: "AIza...",  // Your actual key
    authDomain: "young-lists-xxx.firebaseapp.com",
    projectId: "young-lists-xxx",
    storageBucket: "young-lists-xxx.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
};
```

**IMPORTANT**: Do NOT commit this file to a public repository with real keys!

### Part 3: GitHub Pages Deployment (5 minutes)

#### 3.1 Prepare Repository

If you haven't already:

1. Create a new repository on GitHub (can be private or public)
2. Clone it to your computer
3. Copy the `young-lists` folder contents into the repository

#### 3.2 Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** tab
3. Click **Pages** in the left sidebar
4. Under "Build and deployment":
   - Source: Select **"Deploy from a branch"**
   - Branch: Select **main** (or master) and **/ (root)**
   - Click **Save**
5. Alternatively, if you committed the workflow file, go to **Settings → Pages**:
   - Source: Select **"GitHub Actions"**

#### 3.3 Deploy

1. Commit and push your changes:
   ```bash
   git add .
   git commit -m "Configure Firebase and deploy Young Lists"
   git push origin main
   ```

2. Wait 1-2 minutes for GitHub Pages to build

3. Your app will be available at:
   `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`

4. Copy this URL - you'll need it!

### Part 4: First Time Setup (3 minutes)

#### 4.1 Create Your Account

1. Open your deployed app URL
2. Click **"Create Account"**
3. Enter your email and password
4. Click **"Create Account"**

You'll see an "Access Not Granted" screen - this is expected!

#### 4.2 Add Your UID to Allowed Users

1. Copy your UID from the "Access Not Granted" screen
2. Go back to [Firebase Console](https://console.firebase.google.com/)
3. Select your project
4. Go to **Firestore Database → Data**
5. Click on `meta → allowedUsers`
6. Click on the `uids` field
7. Click **"Add item"** in the array
8. Paste your UID
9. Click **Save**

#### 4.3 Verify Access

1. Go back to your app
2. Refresh the page
3. You should now see the main app screen!

Congratulations! Your app is deployed and working! 🎉

### Part 5: Add Family Members

#### 5.1 Have Them Sign Up

1. Share your app URL with family members
2. Have them click "Create Account"
3. They'll see the "Access Not Granted" screen
4. They should copy their UID

#### 5.2 Add Their UID (Two Methods)

**Method A: In the App (Recommended)**

1. Log into your app
2. Go to **Settings** tab
3. Under "Allowed UIDs", paste their UID in the input
4. Click **Add**

**Method B: Firebase Console**

1. Go to Firebase Console → Firestore Database → Data
2. Click on `meta → allowedUsers`
3. Click on the `uids` array field
4. Click "Add item"
5. Paste their UID
6. Click Save

#### 5.3 They Can Now Access

1. They refresh the app
2. They should see the main screen
3. All lists are shared in real-time!

## Verification Checklist

- [ ] Firebase project created
- [ ] Firestore database enabled
- [ ] Security rules published
- [ ] `meta/allowedUsers` document created with empty `uids` array
- [ ] Email/Password authentication enabled
- [ ] Firebase config pasted into `app.js`
- [ ] Code pushed to GitHub
- [ ] GitHub Pages enabled
- [ ] App accessible via GitHub Pages URL
- [ ] You created an account
- [ ] Your UID added to allowed users
- [ ] You can access the main app

## Troubleshooting

### "Firebase Config missing" Alert

- You forgot to paste your Firebase config in `app.js`
- Make sure the config object is not empty

### "Meta document missing" Error

- You didn't create the `meta/allowedUsers` document in Firestore
- Go to Firestore Console → Data and create it

### "Access Not Granted" After Adding UID

- Clear your browser cache and refresh
- Make sure you copied the UID exactly
- Check Firebase Console that the UID is in the array
- Wait 5 seconds and refresh

### App Shows Blank Screen

- Check browser console for errors (F12)
- Verify Firebase config is correct
- Make sure you're accessing via HTTPS (GitHub Pages provides this)

### Changes Not Syncing

- Check internet connection
- Verify Firestore rules are published
- Check browser console for errors

## Next Steps

1. **Create your first list**: Go to Home tab, enter a list name, click Create
2. **Add items**: Open the list, type items in the bottom bar
3. **Invite family**: Add their UIDs in Settings
4. **Customize**: Edit templates in `app.js` to match your shopping habits
5. **Icons**: Use the icon generator to create custom icons

## Security Best Practices

1. **Never commit real Firebase keys to public repos**
   - Use environment variables or keep config in a private file
   - The `.gitignore` file is set up to help with this

2. **Regularly review allowed users**
   - Remove UIDs of people who shouldn't have access
   - Check the list in Settings tab

3. **Use strong passwords**
   - Encourage all users to use unique passwords

4. **Monitor Firestore usage**
   - Check Firebase Console → Usage tab
   - Free tier is generous but watch for unusual activity

## Alternative Deployment Methods

### Netlify

1. Create account at https://netlify.com
2. Drag and drop the `young-lists` folder
3. Copy the provided URL
4. Update Firebase config if needed

### Vercel

1. Install: `npm i -g vercel`
2. Navigate to `young-lists` folder
3. Run: `vercel`
4. Follow prompts

### Your Own Web Server

1. Upload the `young-lists` folder to your web server
2. Ensure HTTPS is enabled (required for Service Workers)
3. Make sure all files are accessible

## Getting Help

If you encounter issues:

1. Check the main README.md file
2. Review Firebase Console for errors
3. Check browser console (F12) for JavaScript errors
4. Verify all steps in this guide were completed
5. Check that all files are uploaded correctly

## Maintenance

### Updating the App

1. Make changes to your local files
2. Test locally using `python3 -m http.server`
3. Commit and push to GitHub
4. GitHub Pages will auto-deploy
5. Users will see "Update available" toast
6. They click "Refresh" to get the new version

### Backing Up Data

Your data is stored in Firebase and automatically backed up by Google. To export:

1. Go to Firebase Console → Firestore Database
2. Click on the ⋮ menu → Export
3. Follow the export wizard

---

**Congratulations on deploying Young Lists!** 

Enjoy your new shared household shopping list app! 🛒✅
