# Militia Arena — Friends Multiplayer

This is a real-time browser multiplayer starter built from the character art in the previous Custom Militia Arena HTML project. It uses one shared four-player arena, not public matchmaking or separate rooms.

## Game rules implemented

- Exactly four player slots in one shared lobby.
- Every player chooses one of four characters. The server reserves that character, and other players cannot choose it.
- The match starts only when all four connected players have selected unique characters and pressed **READY UP**.
- Free-for-all: every player is on their own (1 vs 1 vs 1 vs 1).
- Each player starts at 100 HP and has **5 respawns** after their first spawn.
- Reduced weapon damage: Pistol 8, AK-47 5, Sniper 20, P90 3.
- When a match ends, all four players can vote to return to the lobby for a rematch.
- Movement and hit/damage logic run on the server at 20 updates per second.

## Run it locally

1. Install Node.js 18 or newer.
2. Extract this folder.
3. Open a terminal in this folder and run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:10000` in a browser. To test multiplayer on one computer, open the same address in four separate browser profiles/tabs.

Other devices on the same Wi-Fi can try the computer's local IP address with port `10000`.

## Put it online so friends can play

This game requires a running Node.js server; uploading only `public/index.html` to a static file host will **not** make multiplayer work.

One straightforward route is Render:

1. Upload the contents of this project folder to a GitHub repository. The repository can be private if your Render account can access it.
2. In Render, create a **Web Service** connected to that repository.
3. Use `npm install` as the build command and `npm start` as the start command. The included `render.yaml` documents these settings.
4. Wait for deployment, open the Render URL, and share that same URL with your three friends.
5. Have all four players open the URL, enter names, choose different characters, and press **READY UP**.

Keep all four players on the same deployed service URL. The server intentionally allows only four simultaneous players. Anyone who obtains the link may try to take a slot, so share it only with your friends.

## Controls

- Desktop: A/D or ←/→ to move; W/↑ to fly; Space to shoot; Q/E to cycle weapons.
- Mobile: rotate to landscape; use the left joystick and right FIRE button. Tap the weapon button to cycle weapons.

## Notes

This is a first multiplayer conversion package, not a store-published game. It has not been deployed to a public host from this workspace. A public multiplayer URL is available only after the server is deployed.


## Match start rules
- Minimum 2 players; maximum 4 players.
- Each connected player must select a unique character before the match can start.
- The server starts the match automatically once at least 2 players have pressed READY. With 3 or 4 players in the lobby, only 2 need to be ready.
