# Security Policy

## Supported versions

Security fixes are made to the latest release only.

## Reporting a vulnerability

Please do not report security problems in public issues.

Report them privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. That opens a private report only the maintainers can see.

Include, as far as you can:

- what the problem is and what an attacker could do with it,
- the steps to reproduce it, or a proof of concept,
- the Glattice version and your Windows version.

You should get a first response within a week. Once a fix is released, the report is credited to you unless you ask otherwise.

## What Glattice has access to

Knowing this helps judge what counts as a vulnerability:

- **Screen and input.** While recording, Glattice captures the screen (or a selected region) and, if turned on in Settings, mouse clicks, key presses and the default microphone. Recording only happens between pressing Record and pressing Stop.
- **Files.** Recordings are kept in the app's cache folder. Exports are written where you choose in the save dialog. The app can read and write files in your user folder.
- **Network.** Glattice makes no network connections. The only exception is the installer, which downloads Microsoft WebView2 if it is not already installed.

A way to make Glattice record without the user starting it, read or write files outside what the user asked for, or send anything over the network is a vulnerability.
