# 06 — UI and menus

New screens hang off the existing `MenuContainer` tree. All of this is
non-parity; single-player/split-screen menus keep their current paths.

## 1. New menu states

`src/app/menu.ts` `MenuState` gains (inserted before `Amount`):

```
MultiplayMode,   // online vs split-screen
Online,          // host vs join
HostSetup,       // host settings + "start hosting"
Join,            // enter a 5-char room code
Lobby,           // waiting room (host + clients)
```

`MenuContainer`'s `menus[]` array is populated for each new state.

## 2. Flow

```
Main
 └─ start multiplayer game ─► MultiplayMode
      ├─ split-screen multiplayer ─► Multiplay  (existing screen, unchanged)
      └─ online multiplayer ─► Online
            ├─ host game ─► HostSetup ─► start hosting ─► Lobby
            └─ join game ─► Join ─► join ─► Lobby
```

`MultiplayMenu.prevMenu()` changes from `Main` to `MultiplayMode`.

## 3. Menu trees

### 3.1 `MultiplayModeMenu`
- Title "multiplayer"
- `StartMenuItem("online multiplayer", Online)`
- `StartMenuItem("split-screen multiplayer", Multiplay)`
- spacer, `ExitItem("previous menu")` → `Main`

### 3.2 `OnlineMenu`
- Title "online multiplayer"
- `StartMenuItem("host game", HostSetup)`
- `StartMenuItem("join game", Join)`
- spacer, `ExitItem("previous menu")` → `MultiplayMode`

### 3.3 `HostSetupMenu`
- Title "host game"
- `GameModeSelectItem` (reuse; coop/DM)
- `EpisodeSelectOptionItem` (reuse)
- `LevelSelectItem` (reuse; coop only — DM starts at 0)
- `PlayerCountItem` (new; 2–4, reuse `OptionsData.multiPlayers`)
- `FragLimitItem` (new; 5–50 step 5, only enabled for deathmatch; new
  `OptionsData.dmFragLimit`, default 20)
- `StartHostingItem("start hosting")` → reads the current settings and calls
  `host.startHosting(settings)`; on `c.hosted` the App switches to `Lobby`.
- spacer, `ExitItem("previous menu")` → `Online`

`StartHostingItem` stays on the screen until the server confirms
(`handleKeyPress` returns `Processed`, and the App performs the state change on
`c.hosted`/`c.error`; errors surface on the message board and keep the screen).

### 3.4 `JoinMenu`
- Title "join game"
- `JoinCodeItem` — a `StringItem` variant: uppercase A–Z only, max length 5,
  shows the cursor like the existing player-name field.
- `JoinGameItem("join")` → `host.joinGame(code, name)`; on `c.joined` → `Lobby`,
  on `c.error` stay and show the message.
- spacer, `ExitItem("previous menu")` → `Online`

The display name is `options.data.name[0]` (locked decision), sent with `s.host`
/ `s.join`.

### 3.5 `LobbyMenu`
A status screen rather than a choice list, but reuses `MenuBase`:

- Title "lobby"
- **Code item** (`LobbyCodeItem`, display-only): `code: KQZAB` in the big light
  font.
- **Roster items** (`TitleItem`, `notActiveItem`): one line per
  `RoomInfo.players`, e.g. `John (host)`, `Paul`, `— waiting —` for empty seats.
- **Status line**: `waiting for players 2/4…`.
- `ExitItem("leave lobby")` → `host.leaveNet()` → `Online`.

`LobbyMenu.draw()` rebuilds its item list from `host.netLobby()` each frame, so
joins/leaves/settings/host-migration appear without a state change. The active
item index is clamped to the (single) exit item.

## 4. `MenuHost` additions

```ts
startHosting(settings: NetSettings): void;
joinGame(code: string, name: string): void;
leaveNet(): void;
netLobby(): NetLobbyInfo | null;   // null when not connected
netStatus(): NetStatus;            // idle|connecting|lobby|playing|error|closed
```

`NetLobbyInfo` carries `{ code, hostSeat, mySeat, settings, players: PlayerSlot[] }`.

## 5. App-side transitions (polled, not menu-driven)

`App.tick()` (or a `net.poll()` call) drains `NetClient` events and performs the
state changes the menus can't:

| Event | App action |
| --- | --- |
| `c.hosted` / `c.joined` | `menuContainer.changeState(MenuState.Lobby)` |
| `c.lobby` | force lobby redraw (items are rebuilt on draw) |
| `c.levelStart` | leave the lobby, `startOnlineGame(levelStart)` (04 §5) |
| `c.matchEnded` | stop the match, `menuContainer.changeState(MenuState.Lobby)` |
| `c.hostChanged` | lobby redraw; host-only items un-grey |
| `c.peerLeft` | mark seat idle (no client-visible roster change mid-match) |
| `c.error` | message board + `menuContainer.changeState(MenuState.Online)` |
| socket `close` (unexpected) | message board + `changeState(MenuState.Online)` |

Menu-driven actions that need async server confirmation (`start hosting`, `join`)
are initiated from the items but completed by these transitions.

## 6. Rendering notes

- Lobby uses the menu background sprite and palette, like every other menu.
- Long roam lists (roster) use `TitleItem` so they never take selection.
- The join-code field reuses `StringItem`'s input mode; only the accepted
  character set differs (A–Z, uppercased).

## 7. Options additions

`src/app/options.ts` `OptionsData`:

- `dmFragLimit = 20` (clamped 5..50 by `validate()` and the storage loader).

`src/app/options-storage.ts`: add `dmFragLimit` to serialise/parse and clamp it
like the other numerics.

`multiPlayers` is reused for the online target player count (2–4).

## 8. Files touched

- `src/app/menu.ts` — states, trees, items, `MenuHost` methods.
- `src/app/app.ts` — net polling, `startOnlineGame`, transitions, host methods.
- `src/app/options.ts`, `src/app/options-storage.ts` — `dmFragLimit`.
- `src/globals.d.ts` — `window.tk4Net` dev hook.
- `src/app/menu.ts` — `LabelItem` (lobby lines), `NetCodeItem`,
  `StartHostingItem`, `StartJoinItem`, `FragLimitItem`.

## 9. Implementation notes (deltas from the design above)

- **Item reuse**: the player count reuses the existing `SplitSelectItem`
  (`OptionsData.multiPlayers`); the code field is `NetCodeItem` and the join
  button is `StartJoinItem`. The earlier names `PlayerCountItem`/`JoinCodeItem`/
  `JoinGameItem` were not needed.
- **`FragLimitItem` is always selectable**, not DM-only (dynamic enable/disable
  fights the tree's active selection); it is simply ignored by cooperative rooms.
- **`MenuHost` signatures** ended up as `startHosting(): void`,
  `joinGame(code: string): void` (the name comes from `options.data.name[0]`
  inside `App`), `netLobby(): RoomInfo | null`, `netStatus(): NetStatus` and
  `netSeat(): number`.
- **`LobbyMenu` keeps a fixed item list** (title, code, four roster rows, status,
  exit) and refreshes each label's text in `draw()`; it does not rebuild items.
  `mySeat` (for the self marker) comes from `netSeat()`.
- **Leaving the lobby** is centralised in `App.changeState`: transitioning from
  `MenuState.Lobby` to anything else calls `leaveNet()`, so the `ExitItem`/
  Escape paths both leave the room.
- **`c.error`** is shown on the message board but does not force a state change
  (the user retries); an unexpected socket close returns to `Online`.
