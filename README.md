# Texas 42 table

A private browser table for 42 dominoes. Four seats, bots fill empty ones, and the server
keeps the table so friends can join from a link on any phone or computer.

* The server runs the bots and sends each player **only their own dominoes**.
* Set a **table password** so only people you give it to can join.
* House rules (Nello, Sevens, Splash, Plunge, Follow me, marks to win) are toggled by the host in the lobby.

## Put it online with Render (free)

### 1. Put these files on GitHub
1. Make a free account at github.com and create a **new repository** (private is fine).
2. Click **Add file, then Upload files**, open the unzipped folder, select **all the files inside it**
   (`index.html`, `server.js`, `engine.js`, `package.json`, `package-lock.json`, `render.yaml`, and the rest)
   and drag them in. There are no sub-folders, so nothing can get skipped. Check that `index.html` and
   `server.js` both appear in the list before you commit.
3. Click **Commit changes**.

### 2. Create the service on Render
1. Make a free account at render.com and sign in with GitHub.
2. Click **New, then Blueprint**, pick your repository, and continue.
3. Render asks for **TABLE_PASSWORD**. Type the password your friends will use.
4. Click **Deploy Blueprint** and wait a few minutes until the service says **Live**.
5. Open the service and copy its address. It looks like `https://texas-42.onrender.com`.

(Prefer clicking through it yourself? Choose **New, then Web Service** instead. Build command `npm install`,
start command `node server.js`, instance type **Free**, and add an environment variable `TABLE_PASSWORD`.)

### 3. Play
Send your friends the address and the password. Everyone takes a seat. The first person to sit down becomes the host,
chooses the rules, and deals. Empty seats get bots.

## Good to know
* **Waking up.** Render's free plan puts the server to sleep after 15 minutes without traffic. The next
  visitor waits up to about a minute while it wakes. Have one person open the link a minute before game night.
* **Restarts lose the game.** The table lives in memory. If Render restarts the service, the current game
  is gone and the table starts empty. Finished hands and scores are not saved anywhere.
* **Changing the password:** Render dashboard, your service, **Environment**, edit `TABLE_PASSWORD`, save.
  Everyone will be asked for the new password.
* **Updating the game:** change files in the GitHub repository and Render redeploys automatically.
* **Privacy:** the address is not listed anywhere, search engines are told to ignore it, and the password
  keeps strangers out. Anyone you give the password to can play.

## If something looks wrong
* **Which version is running?** Scroll to the bottom of the page: the footer says `Build 1.0.5` and how you're
  connected. You can also open `your-address/healthz`, which shows the build number. If the build is missing or
  older, Render is still running old files. Open `server.js` in your GitHub repository and check it mentions
  `BUILD`; if it doesn't, upload the files again. Then in Render open your service and use
  **Manual Deploy, then Deploy latest commit**.
* **Connection.** The page tries a WebSocket first. If that doesn't hold (some networks and proxies block it),
  it switches to plain HTTP by itself within a few seconds. The footer says which one is in use.
* **"Waking the table".** The free server was asleep. It connects on its own, usually within a minute.

## Running it on your own computer
```
npm install
TABLE_PASSWORD=secret npm start      # then open http://localhost:3000
```
`npm run build` rebuilds `index.html` from `template.html`, `style.css`, `engine.js` and `app.js`
(needs Python 3). The prebuilt `index.html` is included, so you only need this if you edit those files.
