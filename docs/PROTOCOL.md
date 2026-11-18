# The vinyl-shelf/1 protocol

Vinyl Shelf hands one album to a player page with `postMessage`. The player runs in an iframe in the shelf page, or in a tab the shelf opened. Any player can take part by adding a small receiver.

## Opening a player

The shelf loads the player's address with `?shelf` added: `https://gitguy268.github.io/realistic-vinyl-player/?shelf`. Without `?shelf` the receiver does nothing.

In shelf mode a player is a guest:

- It never opens or writes its saved library. A shelf album plays beside the library, not in it.
- Start-up writes nothing to storage. Settings the listener changes during the session (volume, EQ, theme) are saved as usual.
- It does not load its own demo tracks.
- It takes one album per page life. For the next album the shelf reloads the page.

## Messages

Every message is a plain object with `v: 1` and a `type`. Each side checks `event.source`: the player accepts messages only from `window.parent` (or `window.opener` when it is not framed), and the shelf only from the frame or window it opened. The origin is not checked, because a shelf can run from `gitguy268.github.io`, from another host, or from a `file://` page. The player only plays what it is sent and stores nothing, so an untrusted sender gains nothing it could not do with its own page.

### Player → shelf: `vinyl-shelf:hello`

```js
{ type: 'vinyl-shelf:hello', v: 1, player: 'realistic-vinyl-player' }
```

Sent once the player's listener is installed. The shelf sends nothing before it, so no message is lost to a page that is still starting.

### Shelf → player: `vinyl-shelf:load`

```js
{
  type: 'vinyl-shelf:load', v: 1,
  autoplay: true,
  album: { title: 'Kind of Blue', artist: 'Miles Davis', year: 1959, genre: 'Jazz', cover: Blob },
  tracks: [
    { file: File, title: 'So What', artist: 'Miles Davis', trackNo: 1, disc: 1, durationSec: 562 },
    // … in disc and track order
  ]
}
```

- `tracks[].file` is the audio `File` from the listener's folder (`File` objects survive structured cloning). The player reads its own tags from it, so the other track fields are hints.
- `album.cover` is optional: the folder's cover image or a generated one. Players use it for tracks without embedded art.
- Strings are shown with `textContent`, never as HTML.

### Player → shelf: `vinyl-shelf:loaded`

```js
{ type: 'vinyl-shelf:loaded', v: 1, tracks: 9 }
```

### Player → shelf: `vinyl-shelf:state`

```js
{ type: 'vinyl-shelf:state', v: 1, playing: true, track: 0, title: 'So What',
  position: 12.5, duration: 562, sound: 'running', blocked: false }
```

Sent at most twice a second, and only when something changed. `sound` is the state of the player's `AudioContext` (`running`, `suspended`, or `none`).

### Player → shelf: `vinyl-shelf:blocked`

Some browsers (Safari, and WebKit generally) keep sound off in a framed page from another site until a click lands inside the frame. If the record is not playing 1.2 s after the load, the player shows a full-page "Tap to drop the needle" button and sends this message. The shelf then tells the listener to click the player.

## Players that speak it

| Player | Page |
|---|---|
| Realistic Vinyl Player | https://gitguy268.github.io/realistic-vinyl-player/ |
| Ultra-Realistic Vinyl Player | https://gitguy268.github.io/ultra-realistic-vinyl-player/ |
| 8-bit Vinyl Player | https://gitguy268.github.io/8-bit-vinyl-player/ |
| Vinyl Player | https://gitguy268.github.io/Vinyl-Player/ |
| 8-bit Player, turntable | https://gitguy268.github.io/8bit-player/vinyl-8bit.html |
| 8-bit Player, chiptune stage | https://gitguy268.github.io/8bit-player/ |

## Testing a receiver

`tests/protocol/` in this repository holds a bare shelf page (`stub.html`) and two Playwright checks:

```sh
bash tests/protocol/site.sh                          # a local copy of gitguy268.github.io in .scratch/site
node tests/protocol/gate0.mjs realistic-vinyl-player/index.html          # plays from 3 kinds of parent page
node tests/protocol/storage.mjs                      # the saved library is byte-identical afterwards
```
