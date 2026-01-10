# Contributing to Young Lists

Thank you for your interest in contributing to Young Lists! This document provides guidelines for contributing to the project.

## Getting Started

### Prerequisites

- Basic knowledge of JavaScript (ES6+)
- Understanding of Firebase (Firestore and Authentication)
- Familiarity with Progressive Web Apps (PWAs)
- Git for version control

### Development Setup

1. **Fork the repository**
   ```bash
   # Fork on GitHub, then clone your fork
   git clone https://github.com/YOUR-USERNAME/grocery-list.git
   cd grocery-list
   ```

2. **Set up Firebase for testing**
   - Create a test Firebase project (separate from production)
   - Follow the setup steps in `DEPLOYMENT_GUIDE.md`
   - Use this test project for development

3. **Run locally**
   ```bash
   cd young-lists
   python3 -m http.server 8000
   # Open http://localhost:8000
   ```

## Development Guidelines

### Code Style

**JavaScript:**
- Use ES6+ syntax
- 4-space indentation
- Semicolons required
- Descriptive variable names
- Comments for complex logic

**CSS:**
- Use CSS variables for theming
- Mobile-first responsive design
- BEM-like naming for clarity
- Keep specificity low

**HTML:**
- Semantic HTML5 elements
- Accessible markup (ARIA labels where needed)
- Keep structure clean and logical

### File Organization

```
young-lists/
├── app.js          # All JavaScript logic
├── styles.css      # All styles
├── index.html      # HTML structure
├── sw.js           # Service Worker
└── manifest.json   # PWA manifest
```

Keep all code organized within these files. Don't add new files unless absolutely necessary.

## Making Changes

### Before You Start

1. **Check existing issues** to avoid duplicate work
2. **Open an issue** to discuss major changes
3. **Create a branch** for your work
   ```bash
   git checkout -b feature/your-feature-name
   ```

### Types of Contributions

#### 🐛 Bug Fixes

1. Reproduce the bug
2. Identify the root cause
3. Fix with minimal changes
4. Test thoroughly
5. Document the fix

#### ✨ New Features

1. Discuss in an issue first
2. Keep features small and focused
3. Ensure mobile compatibility
4. Test offline functionality
5. Update documentation

#### 📝 Documentation

1. Fix typos, improve clarity
2. Add examples
3. Update outdated information
4. Keep formatting consistent

#### 🎨 UI/UX Improvements

1. Maintain the simple, clean aesthetic
2. Ensure accessibility
3. Test on multiple devices
4. Keep mobile-first approach

## Testing Your Changes

### Manual Testing Checklist

- [ ] App loads without errors
- [ ] Authentication works (sign up, sign in, sign out)
- [ ] Lists can be created, edited, deleted
- [ ] Items can be added, checked, deleted
- [ ] Real-time sync works (test with multiple browser windows)
- [ ] Offline mode works
- [ ] Service Worker updates properly
- [ ] Mobile responsive (test on phone or use DevTools device mode)
- [ ] Works in Chrome, Firefox, Safari
- [ ] PWA installable

### Browser Testing

Test in:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

### Testing Service Worker

```javascript
// In DevTools → Application → Service Workers
// 1. Check "Update on reload" during development
// 2. Increment CACHE_NAME when making changes
// 3. Test update flow
```

### Testing Security

1. Test without authentication - should fail
2. Test with auth but not in allowed list - should fail
3. Test with auth and in allowed list - should succeed
4. Verify Firestore rules are enforced

## Pull Request Process

### Before Submitting

1. **Test thoroughly** on your local setup
2. **Update documentation** if needed
3. **Check for console errors**
4. **Verify Firebase rules** still work
5. **Test on mobile** device if possible

### Submitting a PR

1. **Push your branch**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create Pull Request** on GitHub

3. **PR Title**: Clear and descriptive
   - Good: "Add dark mode toggle"
   - Bad: "Update app.js"

4. **PR Description**: Include:
   - What changed
   - Why it changed
   - How to test it
   - Screenshots for UI changes
   - Related issue number

5. **PR Template**:
   ```markdown
   ## Description
   Brief description of changes
   
   ## Motivation
   Why is this change needed?
   
   ## Changes Made
   - Change 1
   - Change 2
   
   ## Testing
   How to test these changes
   
   ## Screenshots (if applicable)
   [Add screenshots]
   
   ## Checklist
   - [ ] Code tested locally
   - [ ] Documentation updated
   - [ ] Mobile responsive
   - [ ] No console errors
   - [ ] Firestore rules still work
   ```

### Review Process

1. Maintainer reviews the PR
2. Address any feedback
3. Update your branch as needed
4. Once approved, it will be merged

## Code Review Guidelines

### As a Reviewer

- Be constructive and kind
- Explain the "why" behind suggestions
- Appreciate the contributor's effort
- Test the changes locally
- Check for security implications

### As a Contributor

- Be open to feedback
- Ask questions if unclear
- Make requested changes promptly
- Thank reviewers for their time

## Feature Ideas

Some areas where contributions would be welcome:

### High Priority
- Dark mode support
- Better offline indicators
- Export/import lists functionality
- Search across all lists
- Item categories/tags

### Medium Priority
- List sharing with specific users
- Custom item notes/details
- Price tracking
- Shopping list optimization (by store layout)
- Undo/redo functionality

### Low Priority
- Desktop app (Electron wrapper)
- Browser extension
- Siri/Google Assistant integration
- Barcode scanning
- Recipe integration

## Security Considerations

### Never Commit
- Real Firebase API keys (use template instead)
- Personal data
- Test account credentials
- Firebase service account keys

### Always Check
- Firestore security rules are maintained
- No XSS vulnerabilities
- No data leaks in console logs
- Sensitive data is properly protected

### Report Security Issues
- Email maintainer directly (don't open public issue)
- Include details of the vulnerability
- Allow time for a fix before disclosure

## Documentation

### When to Update Documentation

Update docs when you:
- Add a new feature
- Change existing behavior
- Fix a bug that might confuse users
- Add new configuration options

### Which Files to Update

- `README.md` - Main documentation, features list
- `DEPLOYMENT_GUIDE.md` - Setup steps
- `SECURITY.md` - Security-related changes
- `EXAMPLES.md` - Usage examples
- Code comments - Complex logic

## Versioning

We follow Semantic Versioning (SemVer):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features, backwards compatible
- **PATCH** (0.0.1): Bug fixes, backwards compatible

Update version in:
- `manifest.json` (optional, for reference)
- `index.html` (Settings → App → Version)
- `sw.js` (CACHE_NAME)

## Release Process

1. Update version numbers
2. Update CHANGELOG (if exists)
3. Test thoroughly
4. Create GitHub release
5. Update deployment

## Community Guidelines

### Be Respectful
- Treat everyone with respect
- Welcome newcomers
- Value diverse perspectives
- Be patient with questions

### Be Constructive
- Provide helpful feedback
- Suggest improvements
- Share knowledge
- Help others learn

### Be Collaborative
- Work together
- Share ideas
- Ask for help when needed
- Celebrate successes

## Getting Help

### Questions?
- Check existing documentation
- Search existing issues
- Open a new issue with "Question" label

### Stuck?
- Describe what you tried
- Share error messages
- Provide code snippets
- Include browser/environment details

### Need Clarification?
- Ask in the issue or PR
- Tag the maintainer
- Be specific about what's unclear

## Resources

### Learning Resources
- [MDN Web Docs](https://developer.mozilla.org/) - Web platform reference
- [Firebase Documentation](https://firebase.google.com/docs) - Firebase guides
- [PWA Guide](https://web.dev/progressive-web-apps/) - PWA best practices

### Tools
- [Firebase Console](https://console.firebase.google.com/) - Manage Firebase
- [Chrome DevTools](https://developer.chrome.com/docs/devtools/) - Debug and test
- [Lighthouse](https://developers.google.com/web/tools/lighthouse) - Audit PWA

## License

By contributing, you agree that your contributions will be subject to the same license as the project.

## Thank You!

Your contributions make Young Lists better for everyone. Thank you for taking the time to contribute! 🙏

---

Questions? Open an issue or reach out to the maintainers.
