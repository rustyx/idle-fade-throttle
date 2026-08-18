# Idle Fade Throttle

A GNOME Shell extension that removes the ~10 seconds of high CPU that
gnome-shell burns every time the screen blanks on idle.

Workaround for issue https://gitlab.gnome.org/GNOME/mutter/-/work_items/4979

## What it fixes

`ScreenShield.activate()` fades a full-screen black `Lightbox` in over
`STANDARD_FADE_TIME` = 10000 ms (`js/ui/screenShield.js:45`). The overlay is
*translucent* for the whole ramp, so nothing beneath it can be occlusion-culled
and every frame recomposites the entire stage — once per frame, for ten seconds.
The problem is that clutter frame clock dispatch keeps running over and over
multiple times per display refresh cycle, recomposing over and over again.

This extension keeps the fade and its duration but cuts its **frame rate**:
it overrides `ScreenShield._activateFade()` and steps the lightbox opacity a
fixed number of times across the fade (default 3: 33% / 66% / 100%, so a step
every 3.33 s on the stock 10 s fade — 3 repaints), then calls
`lightbox.lightOn(0)` to snap to the final state so the `notify::active`
handoff into `_onLongLightbox()` is unchanged.

**The stepping is visible, deliberately so.** The idle fade runs on a lit
screen — it is GNOME's warning that the session is about to blank, cancellable
by moving the mouse — and the panel only powers off once the fade *completes*
(`_onLongLightbox()` → `activate()` → `ActiveChanged(true)` → gsd blanks).
So at `STEPS = 3` you get a visible staircase: nothing, then 33% black at
t≈3.3 s, 66% at t≈6.7 s, full black at t≈10 s.

That is a deliberate trade of smoothness for CPU. Raise `STEPS` to 50 if you
would rather have the smooth dim back, which is still going to be better than
the stock 600 (or even more on more modern hardware with VRR).

Measured on Ubuntu 26.04 / GNOME 50.1, single internal panel (2560×1600 @
60 Hz, logical scale 1.25), Intel Iris Xe:

| | gnome-shell CPU per blank | peak |
|---|---|---|
| stock | 10.14 s | 112% |
| with this extension | 0.05 s | 6% |

Shield activation timing is unchanged: with and without the extension the
screensaver reaches `Active=true` and the displays reach `PowerSaveMode=3` at
the same moment.
