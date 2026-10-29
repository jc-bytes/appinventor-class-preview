# App Inventor classroom preview

This public GitHub Pages site lets students choose an `.aia` file and run the supported screen and blocks in a sandboxed browser preview. The file is read locally in the browser; the site does not upload or save it. Unsupported features are listed under **Preview limits**.

After testing an app, **Save screenshot** downloads a PNG of the current phone screen and frame. The PNG includes the current selections and result, without the upload controls or other page content.

This is an experimental fork feature, not an MIT App Inventor service. The editable App Inventor editor and Android Companion are separate. The preview currently supports a subset of components and blocks.

The preview code and device artwork come from an Apache-2.0 App Inventor fork. `assets/jszip.min.js` is JSZip 3.10.1, distributed under MIT or GPLv3 as stated in its source header.

The reader excludes the Screen's `BlocksToolkit` setting from the runtime model. This setting controls the App Inventor editor's available blocks and components. Large toolkits therefore do not prevent the screen from opening; runtime property limits still apply.

A browser regression for the rice/chicken LunchApp is available at `tests/verify-lunchapp.cjs`. With Playwright installed and Chrome available, run `node tests/verify-lunchapp.cjs /path/to/LunchApp.aia https://jc-bytes.github.io/appinventor-class-preview/`. It checks import, rice/chicken/rice confirmations, stored selection, compatibility reporting, and the PNG download. The supplied `.aia` remains local.

Cultural Language support (2026-10-21): the viewer now supports the supplied app's Web requests,
email/password Firebase sign-in, audio assets, progress saving, TinyDB and clock events.
Students build in official MIT App Inventor, export a current .aia, and choose it here after
changes. The file stays in the browser; signing in contacts the configured classroom Firebase
project. Preview progress uses a separate namespace from the Android app.
No teacher model or answer project is included in this site.

## Cultural Language practice repair, October 29, 2026

The cloud model reads `/progress/<uid>.json` and saves `/progress/<uid>/bestScore.json`. The preview previously allowed only the simpler model's learned-word paths, so a progress read failed and the cloud model silently ignored practice answers. The transport now permits those two existing model paths within the same classroom Firebase project. Firebase rules continue to enforce access. Explicit component heights also override browser minimum heights so spacer labels retain their App Inventor dimensions.

Run `tests/cloud-practice.html` from a static server. Its 18 checks execute the repaired model's actual blocks with controlled network responses and recording selection. They cover all three questions, feedback, scoring, restart, failed-progress-load practice, queued score recovery, user isolation, and phone answer placement. This does not establish successful live sign-in or Android-device acceptance.

The 2.2 model also keeps Mark as learned available after a progress-read failure. Learned-word leaves remain in per-account local storage and upload after a successful sync. The new regression starts with the progress read returning HTTP 503, marks a word, checks persisted pending data, and verifies queue recovery.
