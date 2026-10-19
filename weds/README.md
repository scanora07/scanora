# Wedding invitation template

This is the original Scanora Love template, copied locally with its layout, CSS,
illustrations and shared calendar behavior preserved. The opening video has been
replaced with the supplied Radha-Krishna animation, served as `assets/weds.mp4`.
`assets/end-frame.png` is its exact final frame, shown after playback and in
reduced-motion or playback-fallback mode. The video is contained without cropping
inside the existing layout. On the opening screen, its portrait surface spans
the mobile viewport width with no top inset; the smaller keepsake layout is
retained after playback. The folder
is named `weds`, directly in the project root; scripts and assets use that name.
Only the standalone sample in [gift.js](./gift.js) uses a future wedding date
and the `wedding` occasion.

Production invitations receive their two names and wedding date from
[render.cjs](../server/render.cjs), not the local sample file.
The production catalog offers only Wedding invitation.

The opening animation, keepsake layout, relationship timer, heartbeat estimate,
anniversary countdown and default quote are intentionally preserved for now.
Wedding-specific layout/content changes will be made separately.

From the Scanora Celebrates root, run `npm run preview` and open
http://127.0.0.1:4173/weds/.
The loopback-only preview server is for development; use `npm start` for the
admin and activation workflow. Reduced motion and video playback fallbacks
remain available. Google Fonts are optional, with local font fallbacks.

Run `npm test` for the copied template/calendar tests and platform tests.
