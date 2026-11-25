# Vaulthropic brand

Vaulthropic is independent non-custodial policy software. The mark, type, and palette are original.

## Palette

The brand is built from saturated **Harbor** and **Verdigris**, with a vivid
accent set of green, yellow, red, blue, and magenta. Pair these colors with the
deep Harbor-ink canvas and crisp white reading and control surfaces. Use solid
fills, avoid pastels and gradients, and keep foreground text at accessible
contrast.

| Token | Hex | Use |
| --- | --- | --- |
| Primary, Harbor | `#0C3B4C` | Wordmark, navigation, primary panels |
| Secondary, Verdigris | `#176B57` | Actions, links, focus |
| Secondary bright | `#1F8A70` | Large fills with dark ink `#062821`, and the limit bar in the mark |
| Field | `#062821` | Deep page canvas |
| Surface | `#FFFFFF` | Cards |
| Ink | `#102027` | Body text |
| Muted | `#4E646C` | Secondary text |

Vivid accents use dark Harbor ink on solid fills:

| Accent | Hex | Use |
| --- | --- | --- |
| Green | `#34DB89` | Primary actions and allow states |
| Yellow | `#FFD33D` | Step-up / pending states and secondary actions |
| Red | `#FF5B67` | Block and error states |
| Blue | `#4D9CFF` | Network, focus, and protocol accents |
| Magenta | `#EE5DF2` | AP2, identity, and documentation accents |

Always pair a status with its text label; color alone must not carry a decision.
Keep the reading surface white, and do not set the wordmark in an editorial
serif. Preserve Vaulthropic's own visual identity.

Bricolage Grotesque carries the wordmark and headings. The console wordmark is title case: Vaulthropic. Public Sans carries body copy, labels, and controls. IBM Plex Mono carries addresses, hashes, amounts, and reason codes.

## Web application composition

The marketing header is a fixed 60px bar, flush to the viewport edges, in light gray `#f1f1f1`, with dark Harbor type. The footer uses that same gray. The guide keeps its own edge-to-edge bar on a white reading surface. The landing page is one viewport on pure white. The robot illustration is separate from the words, so the figures can sit a small gap from both window edges while the type stays at its design size: “Empowering AI-to-AI payment systems.”, the policy-gate label, “On-chain guardrails for autonomous agent payments,” and the settlement lines. Cartoon notes cross the open center, between the label and the headline. On a shorter window the picture can crop around the waist, and the words stay in the visible band. A taller window shows the legs and feet. The yellow Decision Lab button and the green Create session button sit under “Try a decision.” The footer is two left-aligned lines, centered as a block: Decision Lab, What’s Vaulthropic, and the four rails on the first line; the faucet, the non-custodial model, and “© 2026 vaulthropic” on the second. It does not cover the buttons. The non-affiliation notice lives on the first docs page, What’s Vaulthropic. The Decision Lab is its own screen. Testnet is the rehearsal. Mainnet holds a live endpoint and a public payTo in that screen only. The lab’s three stages form a vertical stack and collapse their fields at narrower widths. Use Verdigris and the vivid accent colors for strong actions. Sign-in, the console, and the Decision Lab keep the deep canvas. Favor clear fills and purposeful spacing.

The `/docs` route is a standalone white reading surface with a fixed top bar, an
independently scrolling reading pane, a responsive section menu, and no sign-in
or wallet actions. The marketing site and guide share the Harbor / Verdigris
palette and type system, while the guide prioritizes long-form reading and keeps
in-guide section navigation in the current tab.

## Mark

The mark is a harbor square, a verdigris limit bar, and a pale stroke that stops at the bar. It is a gate, not a letterform and not a spark. Use the SVG in `brand/logo.svg` and `apps/web/public/mark.svg` as the favicon. Keep the two files identical. The header wordmark stands alone, without the square beside it.

## Voice

Use the product lines:

- Empowering AI-to-AI payment systems.
- On-chain guardrails for autonomous agent payments.
- Blockchain settlement. Non-custodial caps. Verifiable proof.
- Enforce the limit before the transaction lands.

Describe the product as policy software. Do not describe it as a bank, custodian, wallet host, or money transmitter.

## Domains

The product domain is `vaulthropic.com`. Wallet sign-in messages use that domain, or `localhost` for the local console.
