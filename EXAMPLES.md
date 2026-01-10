# Example Configuration

This document shows example configurations for deploying Young Lists.

## Firebase Configuration Example

After following the Firebase setup steps, your config will look like this:

```javascript
// In young-lists/app.js (lines 29-35)
const firebaseConfig = {
  apiKey: "AIzaSyC1xxxxxxxxxxxxxxxxxxxxxxxxxxx",
  authDomain: "young-lists-12345.firebaseapp.com",
  projectId: "young-lists-12345",
  storageBucket: "young-lists-12345.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456789012345"
};
```

## Directory Structure

After setup, your project should look like this:

```
grocery-list/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions deployment
├── young-lists/
│   ├── app.js                  # Main application (with YOUR Firebase config)
│   ├── index.html              # HTML structure
│   ├── styles.css              # Styling
│   ├── sw.js                   # Service Worker
│   ├── manifest.json           # PWA manifest
│   ├── firebase.config.template.json  # Template (don't use in production)
│   └── icon-generator.html     # Icon generator tool
├── .gitignore                  # Git ignore rules
├── README.md                   # Main documentation
├── DEPLOYMENT_GUIDE.md         # Detailed deployment steps
├── QUICKSTART.md               # Quick start guide
├── SECURITY.md                 # Security documentation
└── EXAMPLES.md                 # This file
```

## Firestore Data Structure

After creating lists and items, your Firestore will look like this:

```
firestore/
├── meta/
│   └── allowedUsers
│       └── uids: ["abc123...", "def456..."]
│
├── lists/
│   ├── list-id-1
│   │   ├── name: "Groceries"
│   │   ├── createdAt: timestamp
│   │   ├── updatedAt: timestamp
│   │   ├── isArchived: false
│   │   └── items/
│   │       ├── item-id-1
│   │       │   ├── text: "Milk"
│   │       │   ├── checked: false
│   │       │   └── createdAt: timestamp
│   │       └── item-id-2
│   │           ├── text: "Eggs"
│   │           ├── checked: true
│   │           ├── checkedAt: timestamp
│   │           └── createdAt: timestamp
│   │
│   └── list-id-2
│       ├── name: "Target"
│       └── ...
│
└── history/
    ├── trip-id-1
    │   ├── listId: "list-id-1"
    │   ├── listName: "Groceries"
    │   ├── completedAt: timestamp
    │   ├── completedBy: "abc123..."
    │   ├── itemCount: 5
    │   └── items/
    │       ├── item-id-1
    │       │   ├── text: "Milk"
    │       │   ├── note: ""
    │       │   └── checkedAt: timestamp
    │       └── ...
    └── ...
```

## Usage Examples

### Example 1: Weekly Grocery Shopping

1. **Monday**: Create list "Groceries"
2. Throughout the week, family members add items:
   - "Milk"
   - "Eggs"
   - "Bread"
   - "Apples"
   - "Chicken"
3. **Saturday**: Go shopping
   - Check off items as you add them to cart
4. After shopping: Tap menu → "complete"
   - Checked items move to History
   - Unchecked items stay on the list for next time

### Example 2: Multiple Store Lists

Create separate lists:
- "Groceries" - for weekly supermarket trips
- "Costco" - for bulk purchases
- "Pharmacy" - for medications and personal care
- "Hardware Store" - for home improvement items

Each list maintains its own items independently.

### Example 3: Using Templates

1. Go to Templates tab
2. Tap "Weekly Staples"
3. Creates a new list with pre-filled items:
   - Milk
   - Eggs
   - Bread
   - Bananas
4. Customize the list as needed

### Example 4: Family Collaboration

**Setup:**
- Parent creates account first
- Parent's UID added to allowedUsers
- Kids create accounts
- Parent adds their UIDs in Settings

**Usage:**
- Mom adds "Milk" to Groceries list
- Dad sees it immediately (real-time sync)
- Kid checks it off while shopping
- Everyone sees the update instantly

## Customization Examples

### Example 1: Custom Templates

Edit `app.js`, find the `renderTemplates()` function:

```javascript
const templates = [
    { name: "Weekly Staples", items: ["Milk", "Eggs", "Bread", "Bananas"] },
    { name: "Costco Run", items: ["Paper Towels", "Water", "Snacks", "Meat"] },
    { name: "Pharmacy", items: ["Toothpaste", "Soap", "Vitamins"] },
    
    // Add your own:
    { name: "Breakfast Items", items: ["Cereal", "Yogurt", "Orange Juice", "Bagels"] },
    { name: "Party Supplies", items: ["Chips", "Soda", "Cups", "Plates"] },
    { name: "Baby Essentials", items: ["Diapers", "Wipes", "Formula", "Baby Food"] }
];
```

### Example 2: Custom Colors

Edit `styles.css`, change the root variables:

```css
:root {
    --primary-color: #10B981;  /* Green instead of Indigo */
    --primary-dark: #059669;
    --secondary-color: #F59E0B;  /* Amber */
    /* ... */
}
```

### Example 3: Custom App Name

**In `index.html`:**
```html
<title>Our Family Lists</title>  <!-- Line 8 -->
<h1>Our Family Lists</h1>        <!-- Line 95 -->
```

**In `manifest.json`:**
```json
{
  "name": "Our Family Shopping Lists",
  "short_name": "Family Lists",
  ...
}
```

**In `app.js`:**
```javascript
// Line 251
if (tabName === 'home') dom.nav.title.textContent = "Our Family Lists";
```

## Testing Examples

### Local Testing

```bash
# Start a local server
cd young-lists
python3 -m http.server 8000

# Open in browser
# http://localhost:8000
```

### Test with Different Browsers

```bash
# Chrome
google-chrome http://localhost:8000

# Firefox
firefox http://localhost:8000

# Safari (Mac)
open -a Safari http://localhost:8000
```

### Test Offline Mode

1. Open the app in Chrome
2. Open DevTools (F12)
3. Go to Application tab
4. Check "Offline" checkbox
5. Refresh the page
6. App should still load (from cache)

### Test Service Worker Updates

1. Make a code change
2. Increment CACHE_NAME in `sw.js`:
   ```javascript
   const CACHE_NAME = 'young-lists-v2';  // Was v1
   ```
3. Deploy the change
4. Open the app
5. You should see "Update available" toast
6. Click "Refresh" to get the new version

## Deployment Examples

### Example 1: GitHub Pages (Static)

```bash
# One-time setup
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/username/grocery-list.git
git push -u origin main

# Enable GitHub Pages in repo Settings

# For updates
git add .
git commit -m "Update app"
git push
```

### Example 2: Netlify Drag & Drop

1. Go to https://app.netlify.com/drop
2. Drag the `young-lists` folder
3. Wait for deployment
4. Copy the URL
5. (Optional) Set up custom domain

### Example 3: Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd young-lists
vercel

# Follow prompts
# Copy deployment URL
```

## Firestore Security Rules Testing

### Test 1: Unauthenticated Access (Should Fail)

```javascript
// In browser console, without logging in
firebase.firestore().collection('lists').get()
  .then(() => console.log('FAIL: Should not access'))
  .catch(() => console.log('PASS: Access denied'));
```

### Test 2: Authenticated but Not Allowed (Should Fail)

```javascript
// After signing in but UID not in allowedUsers
firebase.firestore().collection('lists').get()
  .then(() => console.log('FAIL: Should not access'))
  .catch(() => console.log('PASS: Access denied'));
```

### Test 3: Allowed User (Should Succeed)

```javascript
// After UID is added to allowedUsers
firebase.firestore().collection('lists').get()
  .then(() => console.log('PASS: Access granted'))
  .catch(() => console.log('FAIL: Should have access'));
```

## Common Workflows

### Workflow 1: Adding a New User

1. User creates account in app
2. User sees "Access Not Granted" screen
3. User copies UID and sends to admin
4. Admin logs in
5. Admin goes to Settings tab
6. Admin pastes UID and clicks "Add"
7. User refreshes app and gains access

### Workflow 2: Creating a Shopping List

1. User logs in
2. Goes to Home tab
3. Enters list name (e.g., "Whole Foods")
4. Clicks "Create"
5. Taps the new list card
6. Adds items using quick-add bar
7. Items sync to all family members instantly

### Workflow 3: Completing a Shopping Trip

1. User opens the list
2. Checks off items while shopping
3. After shopping, taps menu button (…)
4. Selects "complete"
5. Confirms the action
6. Checked items move to History tab
7. Unchecked items remain for next trip

### Workflow 4: Using History

1. Go to History tab
2. See completed shopping trips
3. Review what was purchased and when
4. Use insights for future shopping planning

## Troubleshooting Examples

### Example: "Firebase Config missing" Alert

**Problem:** App shows alert about missing config

**Solution:**
```javascript
// Check app.js line 29-35
const firebaseConfig = {
  apiKey: "AIza...",  // Make sure this is filled in
  // ... all fields must be present
};
```

### Example: Stuck on "Access Not Granted"

**Problem:** UID added but still denied

**Steps to fix:**
1. Clear browser cache (Ctrl+Shift+Del)
2. Clear site data in DevTools → Application → Storage
3. Verify UID in Firebase Console:
   - Go to Firestore → Data
   - Open `meta/allowedUsers`
   - Check `uids` array contains exact UID
4. Refresh the app
5. If still failing, check browser console for errors

### Example: Service Worker Not Updating

**Problem:** Code changes not appearing

**Solution:**
```bash
# Option 1: Hard refresh
Ctrl + Shift + R (Windows/Linux)
Cmd + Shift + R (Mac)

# Option 2: Clear service worker
# DevTools → Application → Service Workers → Unregister

# Option 3: Use Incognito mode for testing
```

## Performance Examples

### Example: Batch Adding Items

Instead of:
```javascript
// Bad: Multiple individual writes
items.forEach(item => {
  addDoc(collection(db, 'lists', listId, 'items'), item);
});
```

Use batch:
```javascript
// Good: Single batch write
const batch = writeBatch(db);
items.forEach(item => {
  const ref = doc(collection(db, 'lists', listId, 'items'));
  batch.set(ref, item);
});
await batch.commit();
```

This is already implemented in the quick-add feature!

## Best Practices

1. **Regular Backups**: Export Firestore data monthly
2. **Review Allowed Users**: Quarterly audit of who has access
3. **Update Dependencies**: Check for Firebase SDK updates
4. **Monitor Usage**: Watch Firestore quota in Firebase Console
5. **Use Templates**: Save time with common shopping lists
6. **Complete Trips**: Regularly complete trips to move items to history
7. **Archive Old Lists**: Keep Home tab clean by archiving unused lists

---

For more information, see:
- `README.md` - Full documentation
- `DEPLOYMENT_GUIDE.md` - Step-by-step deployment
- `QUICKSTART.md` - Get started in 15 minutes
- `SECURITY.md` - Security considerations
