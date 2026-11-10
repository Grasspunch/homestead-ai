# Homestead AI interface system

Direction (concept v3): the farm is Sprout Lands pixel art and carries the status at a glance. Wood panels and paper dialogues from the Sprout Lands premium UI pack sit over it, and open only when there is something to read or decide. Desktop only.

## Type
- Two faces, each with one job. The pack's pixel font (px7, px4) for names, titles, tags and buttons. Atkinson Hyperlegible Next for anything you read. JetBrains Mono only for file names, token counts and timestamps.
- Reading text uses three sizes and nothing between them: `--t-meta` 13px (why-lines, hints, column heads, timestamps), `--t-body` 15px (rows, fields, panel text), `--t-lead` 17px (the one sentence a dialogue leads with).
- Hierarchy comes from weight and colour before size: names and values 700 in `--bark`, body 400 in `--bark`, supporting text 400 in `--bark-3`.
- Pixel sizes: button 20px (sm 17, xs 15), dialogue name 21px, panel title 24px, tag 13px. Never set reading text in the pixel font.

## Colour
- Ink ramp: `--bark` (ink), `--bark-2` (secondary), `--bark-3` (meta), `--bark-4` (muted).
- `--leaf` is go and focus. `--berry` is failure only, never emphasis. `--sky` is only for things that reach people outside (shipping, the rollout). `--honey` is cost.

## Controls
- Actions are pack buttons: cream for the main one, tan for the rest, white in the top bar. One main action per dialogue.
- Every value you can change is the same field, a sunk well: `--field-h` 36px, 2px `--field-line` border, `--field-ink` fill, a 2px inner shadow on top, square corners, 15px text. Focus turns the line `--leaf`. Selects add a pixel arrow; limits put the unit in `--bark-3` and the number in 700 tabular figures. Never use a button shape for an editable value.
- Labels sit above a field (`.field-label`, 13px 700), help text below (`.field-help`, 13px). Never a placeholder as the label.
- On or off is the pack's wooden switch. Pass and fail are the pack's check and cross. A spend meter is the pack's tick meter.
- A choice among a few levels is a row of pack buttons, cream for the chosen one.

## Layout
- Rows are flat and ruled with a 1px `rgba(106,74,52,.16)` line, with 8px above and below a field. Columns line up across rows (CSS grid with `display: contents` rows), and everything in a row is vertically centred.
- Spacing steps: 4, 8, 14, 18, 24.
- One raised object at a time: the dialogue or card that needs you. Everything else is flat.

## The plan
- One sentence: the crew's time and price against one agent alone.
- A row per farmer: name, why that model, model, spend limit, drop. Missing roles are links to add them.
- Tasks and done-whens live on the plots. While planning, each plot label shows its done-when, and clicking a plot opens it to edit.
- The foot holds Stops for you, I accept finished work, and Approve with its price.

## Map
- Status lives on the field: a progress bar under each plot's name and at most one emote over it.
- The mailbox is the inbox. It shows a letter when a question or finished work is waiting.
- Accepted work clears its plot and stacks crates by the chest.
- Chickens stand still and peck; clicking one floats a heart. Idle farmers do chores. Nothing on the map is decoration without a job or a reaction.
- No text on the map beyond plot names (and done-whens while planning).
