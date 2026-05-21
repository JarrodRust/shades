# Semantic Gradient — Setup & Deployment Guide

A real-time classroom vocabulary game. Students join on their own devices; 
the host screen shows live word placement and scores on the big screen.

---

## Running locally (to test before deploying)

**Requirements:** Node.js v18 or later — download from https://nodejs.org

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in your browser
#    Host screen: http://localhost:3000/host.html
#    Player view: http://localhost:3000/player.html
```

Students on the same WiFi network can join at your computer's local IP address,
e.g. `http://192.168.1.42:3000/player.html`

---

## Deploying to Render (free, recommended)

Render is free for low-traffic apps and takes about 5 minutes to set up.

1. Create a free account at https://render.com
2. Push this folder to a GitHub repository (also free)
3. In Render: New → Web Service → connect your GitHub repo
4. Settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment: Node
5. Click Deploy — Render gives you a URL like `https://semantic-gradient.onrender.com`

Students visit `https://your-app.onrender.com/player.html` on their devices.
The host opens `https://your-app.onrender.com/host.html` on the big screen.

**Note:** Free Render services "spin down" after 15 minutes of inactivity 
and take ~30 seconds to wake up. To avoid this at the start of class, 
open the host screen a minute before students join.

---

## Adding your own word scales

Open `data/scales.js` in any text editor. Each scale looks like this:

```js
{
  id: 'my-scale',          // unique, no spaces
  category: 'Emotion',     // shown as a label in the game
  type: 'adj',             // 'adj' or 'verb'
  left: 'furious',         // left anchor word
  right: 'serene',         // right anchor word
  words: [
    { w: 'angry',      z: 1, r: 1 },   // z = zone 1-5, r = rarity 1-5
    { w: 'irate',      z: 1, r: 2 },
    { w: 'irritated',  z: 2, r: 2 },
    { w: 'annoyed',    z: 2, r: 1 },
    { w: 'indignant',  z: 2, r: 4 },
    { w: 'neutral',    z: 3, r: 1 },
    { w: 'composed',   z: 3, r: 2 },
    { w: 'calm',       z: 4, r: 1 },
    { w: 'peaceful',   z: 4, r: 1 },
    { w: 'tranquil',   z: 4, r: 3 },
    { w: 'placid',     z: 5, r: 3 },
    { w: 'unruffled',  z: 5, r: 4 },
    { w: 'imperturbable', z: 5, r: 5 },
  ]
},
```

**Zone guide (z):**
- 1 = closest to the left anchor
- 5 = closest to the right anchor
- 3 = middle of the scale

**Rarity guide (r) — affects points scored:**
- 1 = very common word (10 pts)
- 2 = common (20 pts)
- 3 = uncommon (30 pts)
- 4 = impressive (40 pts)
- 5 = exceptional / rare (50 pts)

Save the file and restart the server — changes take effect immediately.

---

## Spelling tolerance

The game uses Levenshtein distance to accept near-correct spellings:
- Words of 5–7 letters: 1 spelling error accepted
- Words of 8+ letters: up to 2 errors accepted
- Very short words (1–4 letters): must be exact

When a spelling is corrected, players see a note: `accepted as "galloping"`
This is intentional — it's a teaching moment showing the correct spelling.

---

## How the game works

1. **Host** opens `/host.html`, configures settings, clicks "Create room"
2. A 5-character **room code** appears on the big screen
3. **Students** go to `/player.html` on their devices, enter the code and their name
4. Host clicks **Start game** when everyone has joined
5. Each round:
   - The scale appears (e.g. *whispering → shouting*)
   - Students type words that fit somewhere on the scale
   - Each valid word appears live in the correct zone on the host screen
   - Once a word is used, no one else can use it (blocking)
   - Timer runs down (or host can end early)
6. **Results screen** shows the full scale with all found words
   (unfound words appear faded — great discussion starter)
7. **Scoreboard** persists across rounds — champion crowned at the end

---

## Scoring

| Rarity | Points |
|--------|--------|
| 1 — common     | 10 pts |
| 2 — uncommon   | 20 pts |
| 3 — notable    | 30 pts |
| 4 — impressive | 40 pts |
| 5 — exceptional| 50 pts |

Common words like "big" or "fast" score 10 pts.
Rare words like "indomitable" or "effulgent" score 50 pts.
This directly rewards students who use precise, sophisticated vocabulary.
