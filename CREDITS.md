# Credits

## tachyonfx

Terminal effects adapted from [tachyonfx](https://github.com/ratatui/tachyonfx)
by [junkdog](https://github.com/junkdog), originally published at
https://github.com/junkdog/tachyonfx. Licensed under MIT.

The TypeScript adaptations use the same per-cell approach: `sweep_in` moves a
sliding gradient window and applies circular easing at its edge; `fade_to`
interpolates foreground colours using eased elapsed time; `hsl_shift` converts
RGB to HSL, shifts hue, then converts back. The sweep takes 400 ms, completion
fade takes 600 ms, and a four-second hue wave follows each running route toward
the orchestrator. These are adaptations for Claude Code's text segments,
not a Rust dependency. Completion uses the colour-preserving `fade_to` variant
rather than randomly erasing glyphs with `dissolve`.

Sources: [sweep_in](https://docs.rs/crate/tachyonfx/latest/source/src/fx/sweep_in.rs),
[fade_to](https://docs.rs/crate/tachyonfx/latest/source/src/fx/fade.rs),
[hsl_shift](https://docs.rs/tachyonfx/latest/tachyonfx/fx/fn.hsl_shift.html).

Copyright (c) 2024 Adrian Papari (junkdog)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Robert Penner

Normalized cubic and circular functions in `hooks/easing.ts` derive from
[Robert Penner's easing equations](https://robertpenner.com/easing/), used under
[their MIT license](https://robertpenner.com/easing_terms_of_use.html).

Copyright (c) 2001 Robert Penner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## cli-spinners, gradient-string and chalk-animation

The pulse theme borrows from three MIT-licensed packages, without depending on
them:

- Spinner frames (`dots`, `arc`, `halves`, `bounce`) copied from
  [cli-spinners](https://github.com/sindresorhus/cli-spinners) by sindresorhus.
- Per-character gradients after
  [gradient-string](https://github.com/bokub/gradient-string) by bokub.
- The pulse (glow), radar (shimmer) and rainbow (scrolling gradient) ideas
  from [chalk-animation](https://github.com/bokub/chalk-animation) by bokub.

They are rewritten in `hooks/pulse.ts` as pure functions of time on Claude
Code's coloured text segments, so motion off simply passes a still clock.
