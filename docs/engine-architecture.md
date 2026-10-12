# Engine Architecture

Source root: `tapankaikki4/src/`. Shared code in `src/common/`.

## High-level object map

```
main()  (src/main.cpp)
 └─ CSplash::ShowSplash            (splash.bmp, ~1 frame)
 └─ CGameApp                       (src/CGameApp.cpp)
     ├─ CSoundPlayer               (SDL_mixer, wavs)
     ├─ CMessageBoard              (on-screen log, semaphore-guarded FIFO)
     ├─ CNetworkDevice             (SDL_net; only used for HTTP version check)
     ├─ COptions                   (options.cfg, episode/music lists)
     ├─ CGameData                  (menu sprites, palettes, game modes, click sfx)
     ├─ CGameGraphicsInterface     (CGraphicsDevice + CGraphicsFader + CColorTable + CFonts)
     │    └─ CGraphicsDevice       (SDL video mode, palette, blit-to-screen)
     ├─ CEventHandler              (SDL events → key/mouse state)
     ├─ CEventFilter               (maps raw events; window close/active)
     ├─ CGameSystem                (per-game subsystem container)
     │    ├─ CDynGameData          (players, level runtime, statistics, shop, timers)
     │    ├─ CGameDrawManager      (per-frame game rendering)
     │    ├─ CDynShopData          (shop inventory/prices)
     │    └─ CGameSubState*        (OnGoing, Shop, Statistics, Victory, NextLevel, LevelInfo, Quit)
     ├─ CGameState                 (main+sub state, maps to GUI state objects)
     └─ CGUIState*                 (Logo, Game proxy, Quit, Menu container)
```

## Main loop (`CGameApp::Loop`)

```
iState->Start();
while (iState->MainState() != EMainStateConfirmedQuit) {
    if (no screen effect) {
        iMBoard->Run(dirty);                       // expire messages
        if (state->First() || iFullUpdate) dirty = fullscreen;
        draw = iState->RunFrame();                 // simulate one *display* frame
        if (draw || dirty) iState->Draw(dirty, updated);
        iMBoard->Draw(...);
        GD->ShowBuf(DrawBuffer, updated);          // blit dirty rects to screen
    } else {
        // fade/zoom transition: fader writes PostProBuffer, ShowBuf(PostProBuffer)
    }
    if (!active) SDL_Delay(10);
    if (iEventHandler->HandleEvents() == 1) return;
}
```

Key points:

- **Presentation is event-driven per display frame**, not per simulation tick.
- `RunFrame` for an in-game state runs a **fixed-tick catch-up loop** (see [Simulation & Physics](simulation-and-physics.md)).
- Output only blits dirty rectangles (`CDrawArea`), but in-game the whole buffer is
  marked dirty every frame, so effectively full-screen presentation.
- Screen transitions (`StartFadeIn`/`StartFadeOut`/`StartZoomOut`) replace normal
  drawing with a full-screen fader effect for `KTimerFreq/2` ticks, then apply the
  queued state change. This is the classic fade-to-black/zoom between menu and game.

## The clock (`src/Timer.cpp`, `timer.h`)

- An SDL timer fires every `1000/KTimerFreq = 10 ms`, incrementing the global
  `volatile unsigned TimerCounter` (and `TimerUpdated`).
- `saveTimer`/`restoreTimer` snapshot/restore `TimerCounter` for screen effects.
- Timers throughout the game are stored as `TimerCounter` snapshots and compared by
  subtraction; `TIMER_SECS(t) = (TimerCounter - t) / KTimerFreq`.

The port replaces the SDL timer with a fixed-step accumulator ([Web Port Architecture](web-port-architecture.md)).

## States

`CState` packs `{ mainState, subState }` into one int (`MAINSTATEMASK 0xff00`).

Main states (`CState.h`): `Logo1, Logo2, Menu, Game, Quit, ConfirmedQuit`.

`CGameState` maps main states to GUI state objects:

| Main state | GUI object | Notes |
|-----------|-----------|-------|
| Logo1 | `CGUIStateLogo(EFLogo, startMusic=true, next=Logo2)` | First logo |
| Logo2 | `CGUIStateLogo(TKLogo, next=Menu)` | Second logo |
| Menu | `CGameMenuContainer` | All menus |
| Game | `CGUIStateGame` | Proxies `CGameSystem` |
| Quit | `CGUIStateQuit` | "Quit TK? (Y/N)" |
| ConfirmedQuit | (null) | loop exit sentinel |

Game sub-states (`CGameState.h`): `None=-1, OnGoing, Shop, Victory, Statistics,
NextLevel, LevelInfo, Quit`.

Legal sub-state transitions (asserted in `CGameState.cpp`):

```
NextLevel  -> LevelInfo | OnGoing
LevelInfo  -> Shop | OnGoing
Shop       -> Shop | OnGoing
OnGoing    -> Statistics
Statistics -> NextLevel | Victory | Statistics
```

`SetState` calls `ExitSubState → ExitState → EnterState → EnterSubState` and saves/
restores the prior state when opening the in-game quit overlay (`SetStateAndSave`).

## Per-frame update order inside `OnGoing`

`CGameSubStateOngoing::RunFrame` (the heart of gameplay):

```
if (TimerCounter > LastFrame) {
    for (i = 0; i < LowFramerate(); i++) {         // catch-up, low-framerate mode
        CheckUserInput();                          // queues shots as NewBullet
        LevelRuntime()->PerFrameCalc();            // effects propagation, sort, move bullets/bodyparts/crate texts
        PushPlayers();                             // knockback from iPushPower
        CheckBurn();                               // burning damage + burn FX
        if (CrateRespawn() && !client) ChkWakeUps();
        per local player: MoveScr(); LoadWeapons();
        AnimatePlayers();
        if (!client) EnemyUpdate();
        DecHits();                                 // damage-flash counters
        ShowSteam();                               // steam vent particles
        if (iNextLevel) iNextLevel++;
        RollEffects();                             // advance effects, iSteamAnimationCount++
    }
}
if (ObjectiveFulfilled() && iNextLevel<=0) iNextLevel = 1;      // coop: enemies empty
if (AllPlayersDead()) { iCompleteTime = timeLimit; NextLevel(); StartZoomOut(Statistics); }
if (iNextLevel >= KLevelCompleteDelay || iUserQuit) { ... StartFadeOut(Statistics); }
```

`LowFramerate()` is `1` normally and >1 only when the display frame took many ticks
(the game "catches up"), so wall-clock slowness consumes more ticks and more RNG per
displayed frame. The port should mimic the *same* catch-up semantics for parity.

## Rendering ownership

- `CGameGraphicsInterface` owns the virtual 8-bit buffers: `iVirBuf` (draw buffer) and
  `iPostBuf` (post-process/fader target), both sized to the current video mode.
- `CGraphicsDevice` owns the SDL 16-bit surface and the current palette; it converts
  the 8-bit buffer to a paletted 8-bit surface and blits to screen.
- `CColorTable` owns `TransparencyTable[256][256]`, `ShadowTable[256][16]`, the four
  light tables `[256][16]`, and 10 `CLightMap`s (radial light masks).
- `CGameDrawManager` composes the game frame into `iVirBuf` (+ `iDarkBuffer` for
  shadow casts) using `CGameDrawer`'s low-level blitters.

## Object lifetimes & reset

- `CGameSystem::Init` creates `CDynGameData`, `CGameDrawManager`, `CDynShopData` and
  the sub-states, then `CDynGameData::Setup` + `SetLevels`, then triggers a fade-out
  to the `NextLevel` sub-state.
- `CDynGameData::Reset()` (called on level start) deletes and recreates
  `CLevelRuntimeData`; the level `CLevel` lives *inside* the runtime data by value and
  is loaded in place.
- Level transitions keep player loadout (money/weapons/shield); `TotalReset` (full
  wipe) happens only once at game init.

## Exceptions

`CCriticalException`, `CFailureException`, `CGameException`. The main loop catches a
`CGameException` thrown during gameplay, logs it to the message board, and bounces to
the main menu.

## Constants hub

`src/common/defines.h` is the central constant list: `KTimerFreq=100`,
`KBitDepth=16`, `KLevelCompleteDelay=940`, `KMaxPlayers=16`, `KMaxLocalPlayers=4`,
`KMaxEffectsInGame=4000`, `KCrateWakeupDelay=1250`, `KMessageTimeOnScreen=500`,
`KEnemyRotationSpeed=3.4f`, `KPlayerColor[]`, and all the enum lists
(`TGameSprite`, `TDirection`, `TBodyPart`, `TEffect`, `TEnemy`, `TWeapon`, `TBullet`,
`TLightTable`, `TSoundEffect…`).
