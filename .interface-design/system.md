# Homestead AI interface system

Direction: the farm is Sprout Lands pixel art and carries the status. The panel is a clean white sheet beside it that holds the hierarchy and opens when there is something to decide.

## Type and colour
- One sans, Atkinson Hyperlegible Next, for all UI text (titles 700 to 800). JetBrains Mono only for file names, the diff, token counts and timestamps. The Sprout Lands pixel font only on the map.
- White panel, neutral ink greys (--ink #241d33), --sprout #4f8f3f as the action accent.
- Outbound is blue: --out #2d5da8, --out-deep #1f4682, --out-wash #e8eefa. It is used only for things that reach people outside the company (the outbox, the send button, the recipient list). Outbound items lead with their audience ("Goes to 42 people at 6 pilot customers") and an envelope. No "Irreversible" or "Can't be undone" labels.
- Red means failure only (a failed check, a failed call). Never for emphasis.
- No eyebrows, kicker labels, middot chains or em dashes in copy.

## Naming
- Each farm is named after its project, and that one name is used on the farm sign, the panel title and the valley card.
- The owning team shows only on a farm's detail. No person's name appears anywhere; crews are named by role.

## Panel
- Level 1 is a five-step overview (Brief, Clarify, Plan, Grow, Harvest), one line per step. Finished steps fold to a one-line summary; the current step is open with its single action inside its row. No footer.
- Drill-down goes step or task, then entry (a file, a skill, an activity line, an output). A trail ("Overview / Task / File") replaces a back button, and Esc goes up one level.
- One raised object at a time: the card that needs you (an ask, the re-plan, the harvest-ready card). Everything else is flat, ruled rows.
- The panel is open for Brief, Clarify and Plan. When Grow starts it folds into a 48px rail with the five step dots and a "needs you" count. Click the rail or press Tab to open it; the header has a close button. It opens itself only for an ask (the camera leans toward that plot) or when the harvest is ready. Dragging the map folds it too.
- Files and skills: every item is marked F or S with a one-line description and a token cost, and each has its own page (what it is, owner team, last updated, preview, used by, cost). The chest on the map opens the whole library.

## Harvest
- The harvest plays on the map first (the crew carries crops to the shipping chest, about 6 s, skippable), then the panel review.
- The outbox (blue) lists Announcement, Webinar invite and Recipient list. Each output shows the first draft against the final, and each "Done when" check sits beside its evidence as a tick. Failed or blocked checks can't be ticked and offer "Send back".
- Approve unlocks only when every check is ticked, and approving never sends. Send is a separate confirm that names the recipients and says a mistake would mean sending a correction.
- "Stays with you" holds your decisions and the lessons saved. Energy and call counts sit behind a Details toggle.

## Map
- Status lives on the field: each plot has a progress bar under its sign and at most one emote (check for done, alert for needs you, cross for failed, sleep for waiting). Hovering a plot shows one line.
- Map and panel stay in sync: hovering or opening a plot highlights its row, and the reverse.
- Farmhands never show work that isn't happening. Waiting on a task: stand at that plot's top edge and glance around on random timers. Waiting for you: on the farmhouse porch facing the door. Paused: frozen, facing down, dimmed. Done: chores away from the plots (feeding chickens, watering flowers, chopping wood, picking apples, napping, the pond, chatting in pairs), switching every 8 to 15 s. No two move in sync.
- Things to click: chickens (a heart; three clicks and it runs off), trees, pond, well, bushes, sunflower, house, chest, signs and idle farmhands. Each reaction is under 600 ms, never changes the work, and is one frame under reduced motion.
- Cursors: the Sprout Lands paw on the map, the pointing paw over anything clickable, the holding paw while dragging.
- The opening is three camera beats with a one-line caption each; Enter moves on, Esc skips. The glossary lives in the "?" sheet.
