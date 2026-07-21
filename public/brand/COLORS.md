# Colors

Every color used across the Whats Happenin logo assets and the site UI. The site
uses **only** the colors below — verified against `app/globals.css` and a scan of
`app/` + `components/`.

## Logo — icon mark (sunrise)

| Swatch | Hex | Role |
| --- | --- | --- |
| 🟧 | `#FBE9C5` | Tile background (cream) |
| 🟥 | `#EA4939` | Sun rays (red) |
| 🟨 | `#EF9C1E` | Sun (gold) |
| 🟩 | `#275350` | Ground (deep teal) |
| ⬜ | `#E7D9B8` | Border stroke |

## Logo — wordmark type

| Swatch | Hex | Role |
| --- | --- | --- |
| ⬛ | `#4A6163` | Teal-slate — primary type color |
| 🟥 | `#F17A7E` | Coral — two-tone "HAPPENIN" accent |
| ⬜ | `#F9FAF4` | Cream — type color on dark backgrounds |

## Logo — full ATX badge illustration (15 traced colors)

| Hex | Where |
| --- | --- |
| `#FBE9C5` | Cream base |
| `#F5E0B6` | Cream shadow |
| `#EF9C1E` | Sun gold |
| `#EA4939` | Red (rays / boot / "ATX") |
| `#E25746` | Red mid |
| `#DD3D28` | Red deep (shadow) |
| `#E3AF90` | Warm tan (light) |
| `#DD9869` | Warm tan (mid) |
| `#A4AA91` | Olive (light) |
| `#9C9D5E` | Olive (lettering/cactus) |
| `#656D2B` | Olive (deep) |
| `#619383` | Teal (light) |
| `#5C8B76` | Teal (mid) |
| `#58725D` | Teal (dark) |
| `#275350` | Teal (deep — skyline/ground) |

---

# Site UI palette (`app/globals.css`)

## Semantic tokens

### Light mode
| Token | Hex |
| --- | --- |
| background | `#F9FAF4` |
| foreground | `#4A6163` |
| card / popover | `#FFFFFF` |
| primary | `#F17A7E` |
| primary-foreground | `#1C2929` |
| secondary | `#E7EDEC` |
| secondary-foreground | `#2A3B3C` |
| muted | `#F0EEDF` |
| muted-foreground | `#7C9092` |
| accent | `#4A6163` |
| accent-foreground | `#F9FAF4` |
| destructive | `#D14B4F` |
| destructive-foreground | `#FFF3EE` |
| success | `#7C9A4F` |
| border / input | `#E2E4DA` |
| ring | `#F17A7E` |
| chart 1–5 | `#F17A7E` · `#FFC94B` · `#F9A66C` · `#4A6163` · `#7C9A4F` |

### Dark mode
| Token | Hex |
| --- | --- |
| background | `#1C2929` |
| foreground | `#F3F0E1` |
| card / popover | `#253534` |
| **header surface** | `#262626` (ink-800 — neutral gray, not teal) |
| primary | `#F79599` |
| primary-foreground | `#1C2929` |
| secondary | `#33453F` |
| secondary-foreground | `#E7EDEC` |
| muted | `#2A3B3C` |
| muted-foreground | `#9DB2B1` |
| accent | `#FFC94B` |
| accent-foreground | `#1C2929` |
| destructive | `#E9686C` |
| destructive-foreground | `#2A1416` |
| success | `#9CB56C` |
| border / input | `#3B4E4C` |
| ring | `#F79599` |
| chart 1–5 | `#F79599` · `#FFC94B` · `#FBBC8E` · `#9DB2B1` · `#9CB56C` |

## Palette ramps (Tailwind `@theme` — used for category tags, hovers, charts)

| Ramp | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cream | `#FFFFFF` | `#F9FAF4` | `#F0EEDF` | `#E4E0CC` | — | — | — | — | — | — | — |
| slate | `#EEF2F1` | `#DCE4E3` | `#C3D0CF` | `#9DB2B1` | `#7C9092` | `#5C7274` | `#4A6163` | `#3A4E50` | `#2A3B3C` | `#1C2929` | `#121C1D` |
| coral | `#FDEEEE` | `#FBD9DA` | — | — | `#F5989B` | `#F17A7E` | `#DB5B60` | `#B8454A` | — | — | — |
| amber | `#FFF7E4` | `#FFEDC0` | — | — | `#FFD873` | `#FFC94B` | `#E8AC26` | `#C08A16` | — | — | — |
| tangerine | `#FEF1E6` | `#FCDFC2` | — | — | `#FBBC8E` | `#F9A66C` | `#E8863F` | `#C56B29` | — | — | — |
| moss | — | — | — | — | `#9CB56C` | `#7C9A4F` | `#647D3D` | — | — | — | — |
| mauve | — | — | — | — | — | `#8C4A5E` | `#713A4A` | — | — | — | — |
| steel | — | — | — | — | — | `#3E5A72` | `#2F4759` | — | — | — | — |
| tan | — | — | — | — | — | `#A98F66` | `#8C7550` | — | — | — | — |
| ink | — | — | — | — | — | — | — | — | `#262626` | `#1B1B1B` | — |

---

## Email digest (separate palette)

`lib/email/digest.ts` intentionally uses a distinct warm "postcard" palette for the
subscriber email (`#C1502E`, `#8A6B4D`, `#F2E6D8`, `#6E5138`, `#647353`, `#2A1D15`),
tuned for email-client rendering rather than the on-screen site. Not part of the
site UI palette above.
