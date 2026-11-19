# Security Policy

## Supported versions

Only the latest version on `main` (the live site) is supported.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub private vulnerability reporting: open the repository's
[Security tab](https://github.com/Gitguy268/vinyl-shelf/security) and choose
"Report a vulnerability". You will get a reply in that private advisory thread.

## Scope

Vinyl Shelf runs entirely in the browser. It reads the music folder you pick; it keeps only tags,
file sizes and small covers in IndexedDB on your computer. There is no server and no account.

An album you play is sent with `postMessage` to the player page you chose, and only to that
page's origin (see [docs/PROTOCOL.md](docs/PROTOCOL.md)). Reports about the hand-off, about what
is stored, or about a page that could make the shelf send files elsewhere are especially welcome.
