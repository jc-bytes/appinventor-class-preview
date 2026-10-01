# App Inventor classroom preview

This public GitHub Pages site lets students choose an `.aia` file and run the supported screen and blocks in a sandboxed browser preview. The file is read locally in the browser; the site does not upload or save it. Unsupported features are listed under **Preview limits**.

After testing an app, **Save screenshot** downloads a PNG of the current phone screen and frame. The PNG includes the current selections and result, without the upload controls or other page content.

This is an experimental fork feature, not an MIT App Inventor service. The editable App Inventor editor and Android Companion are separate. The preview currently supports a subset of components and blocks.

The preview code and device artwork come from an Apache-2.0 App Inventor fork. `assets/jszip.min.js` is JSZip 3.10.1, distributed under MIT or GPLv3 as stated in its source header.

The reader excludes the Screen's `BlocksToolkit` setting from the runtime model. This setting controls the App Inventor editor's available blocks and components. Large toolkits therefore do not prevent the screen from opening; runtime property limits still apply.

A browser regression for the rice/chicken LunchApp is available at `tests/verify-lunchapp.cjs`. With Playwright installed and Chrome available, run `node tests/verify-lunchapp.cjs /path/to/LunchApp.aia https://jc-bytes.github.io/appinventor-class-preview/`. It checks import, rice/chicken/rice confirmations, stored selection, compatibility reporting, and the PNG download. The supplied `.aia` remains local.
