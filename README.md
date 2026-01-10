# Young Lists - Household Grocery List App

A Progressive Web App (PWA) for managing shared household shopping lists with real-time sync, built with vanilla JavaScript and Firebase.

## Features

- 📱 **Progressive Web App** - Install on any device, works offline
- 🔄 **Real-time Sync** - Changes sync instantly across all devices
- 👥 **Multi-user Support** - Secure household access control
- 📝 **Multiple Lists** - Create separate lists for different stores
- ✅ **Smart Checkboxes** - Mark items as you shop
- 📊 **Shopping History** - Track completed shopping trips
- 📋 **Templates** - Quick-start lists for common trips
- 🔍 **Search** - Find items quickly in long lists
- 🎨 **Modern UI** - Clean, mobile-first design

## Quick Start

### Prerequisites

- A Firebase account (free tier works fine)
- A web hosting service (GitHub Pages, Netlify, Vercel, etc.)

### Setup Instructions

#### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" and follow the wizard
3. Once created, click on your project

#### 2. Enable Firestore Database

1. In the Firebase Console, go to **Build → Firestore Database**
2. Click "Create database"
3. Start in **Production mode**
4. Choose a location close to your users
5. Click "Enable"

#### 3. Set Up Firestore Security Rules

1. Go to **Firestore Database → Rules** tab
2. Replace the default rules with:

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
      allow read: if request.auth != null; // Must read to check permissions
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

3. Click "Publish"

#### 4. Enable Authentication

1. Go to **Build → Authentication**
2. Click "Get started"
3. Click on **Sign-in method** tab
4. Enable **Email/Password**
5. Click "Save"

#### 5. Configure the App

1. In Firebase Console, go to **Project Settings** (gear icon)
2. Scroll down to "Your apps" section
3. Click the web icon `</>` to add a web app
4. Register your app with a nickname (e.g., "Young Lists")
5. Copy the `firebaseConfig` object
6. Open `young-lists/app.js` in your code editor
7. Replace the empty `firebaseConfig` object (lines 29-35) with your config:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

#### 6. Create the Allowed Users Document (CRITICAL)

This step is required for the security system to work:

1. Go to **Firestore Database → Data** tab
2. Click "Start collection"
3. Collection ID: `meta`
4. Click "Next"
5. Document ID: `allowedUsers`
6. Add a field:
   - Field name: `uids`
   - Type: **array**
   - Value: Leave empty for now (you'll add your UID after first sign-up)
7. Click "Save"

#### 7. Deploy the App

Choose one of these deployment methods:

**Option A: GitHub Pages (Recommended)**

1. Create a new repository on GitHub
2. Push the `young-lists` folder contents to the repository
3. Go to repository **Settings → Pages**
4. Select the branch and root folder
5. Save and wait for deployment
6. Your app will be available at `https://yourusername.github.io/repository-name/`

**Option B: Netlify**

1. Create a Netlify account
2. Drag and drop the `young-lists` folder to Netlify
3. Your app will be deployed instantly

**Option C: Vercel**

1. Install Vercel CLI: `npm i -g vercel`
2. Navigate to the `young-lists` folder
3. Run `vercel` and follow prompts

#### 8. First Time Setup

1. Open your deployed app
2. Click "Create Account" and sign up with your email
3. You'll see "Access Not Granted" screen with your UID
4. Copy your UID
5. Go back to Firebase Console → Firestore Database
6. Open the `meta/allowedUsers` document
7. Click on the `uids` array field
8. Add your UID to the array
9. Save
10. Refresh your app - you should now have access!

#### 9. Add Family Members

1. Have them sign up in the app
2. They'll see their UID on the "Access Not Granted" screen
3. In the app Settings tab (once you're logged in), you can add their UID
4. Or add it directly in Firebase Console

## Usage

### Creating Lists

1. On the Home tab, enter a list name (e.g., "Groceries", "Target", "Costco")
2. Click "Create"
3. Tap the list card to open it

### Adding Items

- Type items in the quick-add bar at the bottom
- Separate multiple items with commas (e.g., "Milk, Eggs, Bread")
- Press Enter or tap the + button to add

### Shopping

- Check off items as you add them to your cart
- Use the search bar to find specific items
- Tap the menu (…) to complete the trip or rename the list

### Completing a Trip

1. Open the list
2. Tap the menu button (…)
3. Select "complete"
4. Checked items will be moved to History
5. Unchecked items remain on the list

### Templates

- Use pre-made templates for common shopping trips
- Tap a template to create a new list with those items
- Customize the templates in `app.js` (search for "renderTemplates")

### Managing Lists

- Tap the (…) button on a list card for actions:
  - **Archive**: Remove from home view (still accessible in History tab)
  - **Delete**: Permanently remove the list
  - **Rename**: Change the list name

## Offline Support

The app works offline thanks to Service Worker caching:

- View cached lists and items
- Changes sync automatically when back online
- Update notifications appear when new versions are deployed

## Security Notes

- **Never commit your Firebase config with real keys to public repositories**
- The allowedUsers system ensures only household members can access data
- All Firestore operations require authentication
- The `meta/allowedUsers` document can only be modified from Firebase Console (admin)
- Consider enabling App Check for additional security

## Customization

### Changing Templates

Edit the `renderTemplates()` function in `app.js`:

```javascript
const templates = [
    { name: "Weekly Staples", items: ["Milk", "Eggs", "Bread", "Bananas"] },
    { name: "Your Custom Template", items: ["Item 1", "Item 2"] }
];
```

### Styling

Modify `styles.css` to change colors, fonts, or layout:

```css
:root {
    --primary-color: #4F46E5; /* Change to your preferred color */
    --secondary-color: #10B981;
    /* ... */
}
```

### App Name and Branding

1. Edit `index.html` - change `<title>` and header text
2. Edit `manifest.json` - update `name` and `short_name`
3. Replace icons (see Icons section below)

### Icons

The app currently uses placeholder icons. To add real icons:

1. Create icons in these sizes: 192x192 and 512x512
2. Save them in the `young-lists` folder as `icon-192.png` and `icon-512.png`
3. Update `manifest.json`:

```json
"icons": [
  {
    "src": "./icon-192.png",
    "sizes": "192x192",
    "type": "image/png"
  },
  {
    "src": "./icon-512.png",
    "sizes": "512x512",
    "type": "image/png"
  }
]
```

## Development

### Local Testing

1. Use a local server (required for Service Workers):
   ```bash
   # Using Python 3
   cd young-lists
   python3 -m http.server 8000
   
   # Using Node.js
   npx serve young-lists
   
   # Using PHP
   php -S localhost:8000 -t young-lists
   ```

2. Open `http://localhost:8000` in your browser

### Service Worker Updates

When developing:

- Open DevTools → Application → Service Workers
- Check "Update on reload" to see changes immediately
- Or use Incognito mode to bypass cache

### Debugging

- Check browser console for Firebase auth/database errors
- Verify Firestore rules are published
- Confirm UID is in the allowedUsers array
- Check Network tab for failed requests

## Troubleshooting

### "Firebase Config missing" error
- Make sure you've pasted your Firebase config in `app.js`
- Check that all fields are filled in

### "Access Not Granted" screen
- Copy your UID from the screen
- Add it to `meta/allowedUsers.uids` array in Firestore
- Refresh the app

### "Meta document missing" error
- Create the `meta/allowedUsers` document in Firestore Console
- Add a `uids` field of type array

### Service Worker not updating
- Check for console errors
- Try clearing site data in DevTools → Application
- Force refresh with Ctrl+Shift+R (or Cmd+Shift+R on Mac)

### Changes not syncing
- Check your internet connection
- Verify Firestore rules are correct
- Check browser console for permission errors

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+)
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth
- **Offline**: Service Workers & Cache API
- **PWA**: Web App Manifest
- **Hosting**: Static (GitHub Pages, Netlify, Vercel, etc.)

## Browser Support

- Chrome/Edge 90+
- Safari 14+
- Firefox 88+
- Mobile browsers (iOS Safari, Chrome Mobile)

## License

This project is provided as-is for personal and household use.

## Contributing

This is a personal household app, but feel free to fork and customize for your own needs!

## Support

For issues or questions:
1. Check the Troubleshooting section
2. Review Firebase Console for configuration issues
3. Check browser console for error messages

---

Built with ❤️ for the Young household
