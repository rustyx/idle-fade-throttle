// Idle Fade Throttle
//
// Workaround for issue https://gitlab.gnome.org/GNOME/mutter/-/work_items/4979
//

import GLib from 'gi://GLib';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Number of opacity levels in the fade, the last one being fully black.
// 3 => 33% / 66% / 100%, i.e. a step every time/3 ms (3.33 s on a 10 s fade).
const STEPS = 3;

// Fades shorter than this keep the stock smooth ease; stepping them would be
// visible for no real saving.
const MIN_FADE_MS = 350;

export default class IdleFadeThrottleExtension extends Extension {
    enable() {
        this._timerId = 0;
        this._shield = Main.screenShield;
        if (!this._shield)
            return;

        const self = this;
        // Own property shadows the prototype method; disable() deletes it.
        this._shield._activateFade = function (lightbox, time) {
            try {
                self._activateFade(this, lightbox, time);
            } catch (e) {
                // Never leave the shield half-activated: fall back to stock.
                logError(e, 'idle-fade-throttle: falling back to the stock fade');
                self._cancelTimer();
                Object.getPrototypeOf(this)._activateFade.call(this, lightbox, time);
            }
        };
    }

    // Note, the fade should also be intercepted while on the lock screen, hence
    // we need the `unlock-dialog` mode in addition to `user`.
    disable() {
        this._cancelTimer();
        if (this._shield) {
            delete this._shield._activateFade;
            this._shield = null;
        }
    }

    _cancelTimer() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }

    _activateFade(shield, lightbox, time) {
        // Short fades (manual lock, 300 ms) are already cheap - leave them
        // alone. Same when the user has animations off: the stock path then
        // collapses the fade to 0 ms, which is cheaper than stepping it.
        if (time < MIN_FADE_MS || !St.Settings.get().enable_animations) {
            Object.getPrototypeOf(shield)._activateFade.call(shield, lightbox, time);
            return;
        }

        Main.uiGroup.set_child_above_sibling(lightbox, null);
        this._cancelTimer();

        lightbox.remove_all_transitions();
        lightbox.opacity = 0;
        lightbox.show();

        const stepMs = Math.max(1, Math.round(time / STEPS));
        let i = 0;

        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, stepMs, () => {
            // User became active and something called lightOff() - stop.
            if (!lightbox.visible) {
                this._timerId = 0;
                return GLib.SOURCE_REMOVE;
            }

            i++;
            if (i >= STEPS) {
                this._timerId = 0;
                // Duration 0: snaps to the final state and fires the Lightbox
                // onComplete, which sets _active and emits notify::active.
                // That is what drives ScreenShield._onLongLightbox().
                lightbox.lightOn(0);
                return GLib.SOURCE_REMOVE;
            }

            lightbox.opacity = Math.round(255 * i / STEPS);
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._timerId, '[idle-fade-throttle] stepped fade');

        // Preserve the original's user-active watch.
        if (shield._becameActiveId === 0) {
            shield._becameActiveId = shield.idleMonitor.add_user_active_watch(
                shield._onUserBecameActive.bind(shield));
        }
    }
}
