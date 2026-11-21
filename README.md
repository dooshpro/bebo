# bebo

a period tracker pwa like flo. built with html, css and vanilla js. 

<img src="https://cdn.hackclub.com/01a1dd63-e528-73d6-b23e-4df820171063/journal-1794715673113.png">

## features

- **cycle dashboard:** calculates your cycle day and phase (menstrual, follicular, ovulating, luteal, or late) based on ur logged dates, updating the theme accents, messages, and phase-specific cat illustrations accordingly.

- **smart averages:** automatically averages your cycle and period lengths across your previously logged cycles (its better than flo)

- **calendar & week strip:** a home screen week strip and a separate monthly calendar displaying logged period days alongside predicted period and fertile windows.

- **settings & date logging:** add your usual cycle and period lengths and log past period dates. input data is auto sanitized and clamped on load to prevent invalid dates or out of range numbers

- **local backup & restore:** all data stay in your browser's localStorage. you can also export your history to a `.json` file and import it.

- **offline support (pwa):** includes a `manifest.json` and `sw.js` using a network first, cache strategy so the app works offline once loaded.

- **daily reminders:** reminders for upcoming periods and fertile windows.

- **partner feature:** can share e2ee link for partner view. 

## tech and assets

- **stack:** html, css, and js
- **artwork:** ibis paint

## run locally
bebo uses a service worker (`sw.js`) and browser api for offline caching and notifications, serve the project folder using any local static server rather than opening `index.html` directly via `file://:`
```py
# example using python
python3 -m http.server 8000

# or using node/npx
npx serve .
```
then open `http://localhost:8000` in your browser.

this project is licensed under the MIT license - see the `LICENSE.md` file for details