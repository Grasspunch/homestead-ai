# Homestead AI interface system

Direction (concept v3): the farm is Sprout Lands pixel art and carries the status at a glance. Wood panels and paper dialogues from the Sprout Lands premium UI pack sit over it, and open only when there is something to read or decide. Desktop only.

## Type
- Two faces, each with one job. The pack's pixel font (px7, px4) for names, titles, tags and buttons. Atkinson Hyperlegible Next for anything you read. JetBrains Mono only for file names, token counts and timestamps.
- Reading text uses three sizes and nothing between them: `--t-meta` 13px (why-lines, hints, column heads, timestamps), `--t-body` 15px (rows, fields, panel text), `--t-lead` 17px (the one sentence a dialogue leads with).
- Hierarchy comes from weight and colour before size: names and values 700 in `--bark`, body 400 in `--bark`, supporting text 400 in `--bark-3`.
- Pixel sizes: button 20px (sm 17, xs 15), dialogue name 21px, panel title 24px, tag 13px. Never set reading text in the pixel font.
- Big numbers and page titles: 34px or 40px, nothing else. Nothing anywhere under 13px, including plot labels and chart axes.
- One font per button row: if one label is too long for the pixel font, the whole row switches to the body font.
- Ink is only the tokens: `--bark`, `--bark-2`, `--bark-3`, `--bark-4`, `--leaf`, `--berry`, `--sky`, `--honey`, and cream on coloured tags. Buttons use `--bark`.
- A spend overrun reads "Over its limit by $X" in `--berry`.

## Colour
- Ink ramp: `--bark` (ink), `--bark-2` (secondary), `--bark-3` (descriptions, placeholders, meta). No lighter grey for text.
- `--leaf` is go and focus. `--berry` is failure only, never emphasis. `--sky` is only for things that reach people outside (shipping, the rollout). `--honey` is cost.

## Controls
- Actions are pack buttons: cream for the main one, tan for the rest, white in the top bar. One main action per dialogue.
- Every value you can change is the same soft well (`kit.css`): a pixel nine-slice one shade darker than the paper (`--field-ink`), a soft outline, a lip on top, square pixel corners, 15px text. Height `--field-h` 36px; the talk bar and goal are 44px. Hover darkens the outline, focus turns it `--leaf`. Selects add a pixel arrow; limits put the unit in `--bark-3` and the number in 700 tabular figures. Never use a button shape for an editable value.
- Labels sit above a field (`.field-label`, 13px 700), help text below (`.field-help`, 13px). Never a placeholder as the label.
- On or off is the pack's wooden switch. Pass and fail are the pack's check and cross. A spend meter is the pack's tick meter.
- A choice among a few levels is a row of pack buttons, cream for the chosen one.

## Surfaces
- Paper is the one surface: the pack's text box with straight edges and no tail.
- A bubble is paper with a tail, used only when someone speaks. The tail points at the speaker (`.bubble[data-tail=left|right|up|down]`, moved along its side with `--tail-at`). Panels, the inbox and cards have no speaker, so no tail.
- Inside paper, a grouped block is a flat tint (`rgba(106,74,52,.07)`), never a white card with a rounded border.
- The live kit at `/kit` is drawn by the app's own CSS; the `/design` library frames it.

## Layout
- No helper sentences that restate what the screen already shows.
- Rows are flat and ruled with a 1px `rgba(106,74,52,.16)` line, with 8px above and below a field. Columns line up across rows (CSS grid with `display: contents` rows), and everything in a row is vertically centred.
- Spacing steps: 4, 8, 14, 18, 24.
- One raised object at a time: the dialogue or card that needs you. Everything else is flat.

## The plan
- One sentence: the crew's time and price against one agent alone.
- A row per farmer: name, why that model, model, spend limit, drop. Missing roles are links to add them.
- Tasks and done-whens live on the plots. While planning, each plot label shows its done-when, and clicking a plot opens it to edit.
- The foot holds Stops for you and Approve with its price.

## Map
- Status lives on the field: a progress bar under each plot's name and at most one emote over it.
- The mailbox is the inbox. It shows a letter when a question or finished work is waiting.
- A task commits when its check passes: its crop stands ripe and crates stack by the chest. The chest stays shut until the first commit. After the merge the plots are harvested bare.
- The pull request review is the one ask with a list: each commit with its check line, scrolling inside the bubble. Send back opens a task picker and a note in one row.
- Chickens stand still and peck; clicking one floats a heart. Idle farmers do chores. Nothing on the map is decoration without a job or a reaction.
- No text on the map beyond plot names (and done-whens while planning).

## Checkpoint 14
- The plan docks on the left, full height, with the Planner's portrait above it and the tail pointing up. The farm fills the rest at the largest scale (3, 2.5 or 2) that shows every plot.
- Plot names wrap rather than truncate. Labels never grow wider than their column.
- The rollout chart draws one unit to a pixel, so its labels are real 13px type. Labels that would collide stack upward.
- Digits never sit in px4: a count in a section head is in the body font.
- "Not yet" holds without taking the other answers away. A long commit list shows three and "+N more".
- The top bar has a labelled Pull request button. Roll back sits under the pull request's title whenever anything is live.

## Checkpoint 15
- Asks show how sure the farmer is: one line under the impact, "Sure" (leaf) / "Fairly sure" / "Unsure" (ink) in bold, then the basis in meta size. No tag, no icon.
- Every ask dialogue ends with the same talk bar as the Planner's: a field "Or answer in your own words" and a Send button in the reading font. A reply the Planner can't place keeps the ask open and says so in one line.
- The PR review lists stopped tasks under the commits with a red cross and "Stopped, left out of this pull request".
- When a run is done, the top bar's Play becomes a labelled "Run again" button, like "Pull request".
- Plot labels size to their text (width: max-content) and wrap only at the plot's width.
