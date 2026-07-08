# Hidden Gold — Phase 1: Project Setup & Base Scene

Unity 6.3 LTS, C#, target: Google Play. All comments/UI text: English only.

## Concept recap

A pile of transparent glass stones with realistic 3D physics. Some stones
hide a gold ball (visually identical to a plain glass stone — no tell), some
are pearl-colored electric traps that shock the player on touch. The player
drags stones apart and taps individual stones to search for gold.

## 1. Repository / folder structure (done)

```
Assets/
  Scripts/
    Managers/GameManager.cs
    Stones/StoneType.cs
    Stones/StoneController.cs
  Prefabs/
    Stones/            <- Stone.prefab goes here
  Materials/
    Glass/              <- transparent glass material(s)
    Pearl/               <- pearl/trap material
  Physics/                <- physic material asset goes here
  Scenes/                <- MainScene.unity goes here
  UI/
    Sprites/
  Audio/
  Textures/
```

`.gitkeep` placeholders keep the empty folders tracked in git until real
assets land in them.

## 2. Scripts included in this phase

- **`GameManager.cs`** — simple singleton. Holds `CurrentScore` and exposes
  `AddScore(amount)` plus a `System.Action<int> OnScoreChanged` event that
  the UI subscribes to in code (e.g. from a `ScoreDisplay` script) to update
  the score label. Score is clamped to never go below zero.
- **`StoneType.cs`** — enum `Empty / Gold / Trap`, the hidden content of a
  stone. Purely data — never drives which material/mesh is shown, so stones
  stay visually identical.
- **`StoneController.cs`** — drag + tap input for a single stone.
  - `[RequireComponent(typeof(Rigidbody))]` and
    `[RequireComponent(typeof(SphereCollider))]` — this is what guarantees
    every stone gets the **3D** Rigidbody (not Rigidbody2D) and a
    SphereCollider automatically the moment the script is added, and Unity
    won't let either be removed while the script is present.
  - `Awake()` calls `ConfigurePhysicsForRealisticRolling()`, which forces:
    `useGravity = true`, `isKinematic = false`,
    `interpolation = Interpolate` (smooths visual rolling),
    `collisionDetectionMode = ContinuousDynamic` (stops fast/small stones
    from tunneling through each other), and `sphereCollider.isTrigger = false`
    (so it physically collides instead of just detecting overlap).
  - Tap vs. drag is distinguished by press duration + pointer travel
    distance; a tap calls `Reveal()`, a drag releases the stone with an
    outward force so it rolls away naturally.
  - `Reveal()` calls `GameManager.Instance.AddScore(goldScoreValue)` when the
    stone holds gold, and fires a `UnityEvent` per outcome (`onGoldRevealed`,
    `onTrapTriggered`, `onEmptyRevealed`) for VFX/SFX/UI hookup without
    touching code.

Input uses the legacy `OnMouseDown/Drag/Up` events (via `SphereCollider` +
`Camera.main`), which Unity's Input Manager already maps from touch on
mobile (`Simulate Mouse With Touches`, on by default). This keeps phase 1
simple; swapping to the new Input System touch API is a drop-in change
later if needed.

## 3. Scene setup — do this in the Unity Editor

I don't have Unity installed in this environment, so the scene itself has to
be assembled in the Editor. Steps:

1. **Create the scene**: `Assets/Scenes/MainScene.unity` (3D URP template,
   matching whatever render pipeline the project already uses).
2. **Hierarchy**:
   - `Main Camera` — perspective, angled down over the stone pile.
   - `Directional Light`.
   - `Table` — a flat plane/cube as the play surface, with a (non-trigger)
     `Box Collider` so stones rest and roll on it.
   - `StonePile` (empty GameObject) — parent for spawned stone instances.
   - `Canvas` (Screen Space – Overlay):
     - `ScoreText` (TMP) — a small `ScoreDisplay` script subscribes to
       `GameManager.Instance.OnScoreChanged` in code and updates the label.
     - `ShockFeedback` panel — shown from each trap stone's own
       `onTrapTriggered` UnityEvent.
   - `GameManager` — empty GameObject with the `GameManager` component.
3. **Stone prefab** (`Assets/Prefabs/Stones/Stone.prefab`):
   - 3D **Sphere** primitive as the base.
   - Confirm the auto-added **Rigidbody** (not Rigidbody 2D) and
     **Sphere Collider** are present — `StoneController`'s
     `[RequireComponent]` attributes add them automatically, just verify in
     the Inspector after dropping the script on.
   - Assign a **Physic Material** for realistic rolling (Editor menu:
     `Assets > Create > Physics Material`, named `StonePhysicMaterial`):
     `Dynamic Friction 0.15`, `Static Friction 0.15`, `Bounciness 0.1`,
     `Friction Combine: Minimum`, `Bounce Combine: Minimum`. Drop it onto the
     Sphere Collider's `Material` slot.
   - Assign the transparent glass material (`Assets/Materials/Glass`) to the
     mesh renderer.
   - Add `StoneController`, set `Stone Type` per-instance (`Empty` for most,
     `Gold`/`Trap` for the hidden ones) — the Inspector field is the only
     place this differs; the mesh/material stay identical.
4. **Populate the pile**: duplicate the Stone prefab under `StonePile` at
   slightly randomized spawn positions/rotations above the table and let
   physics settle them on `Play` — this is what produces the "stacked
   together" look with real collisions instead of hand-placed positions.

## 4. Next (phase 2 preview)

- Randomized gold/trap distribution per level instead of hand-set types.
- Electric shock VFX/SFX + brief input-lock, driven by each stone's
  `onTrapTriggered` event.
- Gold-found / win tracking (`GameManager` currently only holds score; a
  total-gold and found-gold count can be added once level generation needs it).
- Save/progress persistence.
- Google Play build settings (package name, icons, target API level).
