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

## Checkpoint 16
- Every button inside a dialogue uses the reading font. The pixel font stays on the top bar, titles and tags.
- The top bar status is short: "3 of 6 tasks done" (work tasks, the same count as the pull request), then "Done, live", "Live, 2 of 5 tasks", "Rolled back" or "Not shipped".
- While the run plays and nothing is open, the top bar shows a skip button: "Skip to the next thing that needs you".
- Free-text echoes are clipped to 80 characters.

## Checkpoint 17
- The skip button keeps its place in the top bar, disabled while an ask or a rollback is open, so Play/Pause never moves.
- A grey "Paused" tag sits in the title when you paused the run yourself.
- Plot labels stay on one line, with an ellipsis and the full name on hover; the split task is just "Hard cases".
- Notes you send the crew show at the top of that farmer page under "Your notes".

## Checkpoint 18
- When a run is done, "Run again" appears left of "Pull request". Play and skip stay where they were, disabled, so no button ever takes another's place under the cursor. (Replaces the Checkpoint 15 rule.)
- The title tag says "Simulated" on your farms and "Simulated sample" on the sample, in the open, not only in a tooltip.
- A free-text answer is applied by itself only when it is the suggestion. Anything else is said back first: "I read that as “X”. Go ahead?"
- A proof that pops up pulls the camera to its plot and the pop above it, so it never shows over a hidden plot.
- Farms never share a name: a second "Support assistant" is "Support assistant 2", beside the sample.
- Saved farms that can't be read clear themselves, and you start at Home with a toast.

## Checkpoint 19
- Every free-text answer is said back before it applies, the suggestion included.
- Money asks before the step that would go over are tagged "Heading over budget"; "Over budget" only once it has passed.
- Task costs in the pull request and task panel are to the cent, the same as the ask that named them.
- Both Simulated tags (your farms and the sample) use the gold tag. (Now one `SimTag`; see Visual system pass.)
- Home picks the largest scale (3, 2.5, 2 or 1.5) that shows every farm and the new-farm plot above the dialogue.
- Done's time gain says "assuming one agent runs a third slower".

## Learning and projection on Done
- On run 2 and later, the Planner's first line names what it learned: "Last time “Index the help docs” ran over, so I split it from the start: about $3.51 less, and no ask." The task name is quoted as the plot shows it.
- Done adds one plain body line under the gain line: "Learned from run 1: “…” split from the start, $X less, and no ask." The numbers are the two runs' own costs for that task.
- Last on Done, before the buttons: a "Projection" tag (the Simulated tag, see Visual system pass), then one meta-ink line multiplying this run's numbers across 10 people × 2 crews a day. It never reads as a result: the tag and "at this run's rates" say it's projected.

## Changing the farm
- Ask the Planner in the talk bar, at any time, to change how the farm runs. A request that reads as a change gets one change card in the Planner's bubble; anything else goes to the crew as a note.
- The change card follows the ask: Planner header, an honey urgency tag naming the change ("Incident mode", "Synthetic checks", "Stage alerts"), one question, then one row per change. Every row is checked. An unticked row greys and strikes through.
- A row that removes a safety step has one loss line under it in berry ink, the reading font at meta size. No helper sentences.
- Buttons: "Apply N changes" (cream) and Cancel (tan). The count follows the ticks; at zero Apply is disabled.
- If the browser blocks notifications, the card says so in its question line and Apply becomes "Apply with in-app messages".
- An applied request is a gold chip hanging just under the title, so the title keeps its status. It pops in and carries Undo for 8 seconds, then × to turn it off. There is no toast for it, so nothing covers the plots. Undo of the latest change restores the run exactly.
- A removed plot goes up in the UI pack's own white clouds (cloud_puff, cloud_wisp from the big weather icons): four of them at whole-pixel scale over the plot, the middle one doubling, drifting apart and fading in 600 ms. The earlier hand-drawn circle cloud stays in FarmView behind POOF_STYLE. The rest slide to their places over 400 ms, eased out. A plot whose name, done-when or farmer changed puffs once where it stands. Under prefers-reduced-motion there is no poof and no slide.
- Each row ends in a small two-way choice, "This farm" / "Every farm", the chosen half on cream. The Planner suggests it: incident mode, anything that removes a safety step and the success criteria are this farm; preferences such as stage alerts are every farm. The choice greys with its row.
- Every-farm changes collect under Settings in "Your flow": one switch row per change, with × to take it out. Turning an item off keeps it listed but new farms start without it. Undo of the request that added an item takes it out too.
- A new farm starts with Your flow. The plan's first line names it in a few words ("With your flow: stage alerts."), and once approved the farm carries a "Your flow" chip that turns it off for that farm alone. Chips show only once a plan is approved, so they never sit on the Planner's portrait.
- Under synthetic checks the rollout chart plots tests passing: all of them sits on the top line, labelled "12 of 12 must pass" above the chart, and a dip below it is the berry line that rolls back.
- With the Deployer off, the release plot becomes "Push to main", worked by the Builder, done when "Merged to main and live for everyone". Undo brings back "Ship to users".
- The top bar's "N of M tasks done" counts every plot on the farm, the release included, so it always matches what you see. (Replaces the Checkpoint 16 count of work tasks only.)
- A change the Planner can't make gets one short line, "I can’t change that yet.", then, when something is near, a bold "Closest I can do: …" line, then up to three suggestion chips (cream, small, ruled), nearest first. A chip sends its request and opens the change card. In the talk bar every line sits on its own: yours first, the Planner's under it.

## Changing the screen
- The same card changes the screen: hide or bring back a part, move a top bar button, make a part bigger or smaller, rename a button, or recolour one. One row per change, in plain words: "Move the inbox button to the left", "Rename “Pull request” to “Review”", "Make the plot labels bigger", "Make the spend counter green". Every farm is the suggested scope.
- The top bar is one ordered row: the left group (home), the title, then the right group. A button moves to the start or end of the right group, to the left beside home, or before or after another button. Run again stays just left of Pull request.
- Sizes go two steps each way from as it ships. Top bar buttons are 34, 42, 56, 64 or 72px tall with 16, 16, 32, 32 or 48px icons. Plot labels, speech bubbles and check pop-ups only grow, two steps: labels 15 and 17px, pop-ups at body and lead size, bubbles at 1.5x and 2x. Nothing goes under 13px.
- Colours are the pack's button only: white, cream, tan, brown, and btn_leaf, btn_berry, btn_sky, btn_gold, which are btn_white with its shades swapped for the tokens' ramps (`scripts/tint-buttons.py`). Any other colour gets the list. Never free CSS.
- A renamed icon button shows its name beside the icon, in the pixel font; the aria-label follows. Names are 20 characters at most.
- The latest change per part and property wins; this farm's changes come before Your flow. "Put the inbox back" or "reset the inbox" takes every property of that part back. Play and settings can't be hidden.
- A screen change shows its chip only while it carries Undo: the screen itself shows what changed.

## A mixed crew
- Models are grouped by maker wherever you pick one: "Claude" first, then "OpenAI (Codex)". In the plan's select that's an optgroup; on the farmer page each group has a small bold meta heading over its own grid of model buttons.
- The farmer page names the agent under the farmer's name, in meta ink: "GPT-6.1 Sol on Codex", "Claude Sonnet 5 on Claude Code".
- Settings shows a row under Live mode, "Live: Lovable AI (uses workspace credits)", in bold leaf when it can run, meta ink when it can't, and under it "Out of credits: your Anthropic key, your OpenAI key" for the own keys the server has. Never a key.
- A live plan's sky tag names who answered: "Planned live: Lovable AI", or "Planned live: Your Anthropic key" when credits ran out. A routed message answered by an own key says so in a toast.
- A plan simulated for an expected reason carries a gold tag with it ("Simulated (out of credits)", "Lovable AI rate limit reached, simulated instead") instead of the red "Live call failed". A wrong model id is a failure: red tag, and the line under it names the id to check.

## Ask me, and proof that leads with the task
- How often the crew stops for you is one select-styled field (the soft well with the pixel ▾): "Ask me: When it matters". It replaces the row of three level buttons everywhere: the plan's foot, the Control panel and /kit.
- It opens a custom menu on paper, not a native select: each level on one line in body ink, with what it asks about under it in meta ink, built from the autonomy presets ("Cost, disagreements, failed checks, big changes, merging and shipping again after a rollback" / "Cost, disagreements, big changes and merging" / "Big changes and merging only"). The chosen level has a leaf ✓. In the plan's foot it opens upward.
- Keyboard: Enter, Space or ↓ opens it; ↑ ↓ move; Enter picks; Esc closes and keeps the old level; Tab closes.
- A proof pop-up leads with the task: its name in the small pixel caps, then a green "Done" tag (red "Failed" on a failure). Then the proof itself (the test seeds and "5 of 5 tests pass", the screenshot, or the chart). Last, in meta ink, "Checked by the Tester". No swatch or checker name in the header.

## Talking a disagreement through
- A disagreement's input invites "Ask about either way, think it through, or suggest your own". A question gets an answer from the side it names (both when it names neither), as a short chat line under the options: the side's swatch, its label in bold, one sentence. Your question sits above it in meta ink as "You: …". The ask stays open.
- A way of your own is said back by the Planner before anything changes: "Go with your way: …? The Designer builds it and the Tester checks it." with Yes and No. On Yes it's a decision like any other, logged as "Your way: …", and the pull request lists it as its own commit, "<task>: changed" with "Your way: …" under it.

## One real AI moment
- In Live mode the plan is the one live call. Its sky tag names who answered ("Planned live: Lovable AI"), and one meta line under it says what was live: "Live: the crew, limits and done-whens. Simulated: the run." The title then carries a gold "Simulated run" tag.
- For the demo goals (the sample's and Home's starters) a live plan is kept. If the live call fails, the kept plan stands in with a sky "Planned live earlier" tag and "Live call failed: this is the live plan from 10 Nov. Simulated: the run." Never a kept plan for any other goal, and never one made up.

## What each farmer can see
- The farmer page's right column starts with "What it can see": one switch row per path in its context. A doc shows its name ("Help docs", "Brand guide") with the path under it in mono; code paths show the path alone. Then the add field, then skills.
- A doc the farmer needs and doesn't have (the sample's brand guide for the Designer) is listed as an off row at full strength, not struck through. Once a check failed for it, the line under it ends "· Chat widget failed its check without it" in berry. Its switch adds it.
- A check that failed for missing context says which file and whose context. Its screenshot proof rings the header. The ask that follows offers "Add the brand guide" and "Show me the Designer’s context", which opens the page and leaves the ask open. Adding the guide on the page answers the ask.

## Taking the run with you
- When a run is done, the Planner’s Done dialogue ends its one button row with a quiet download group: "Download" in meta ink, then "PR" and "Run report" as xs tan buttons in the reading font (aria-labels "Download PR", "Download run report"). (Replaces the earlier second row.) Both save markdown built from the run’s own events (src/run/export.ts), and both open by saying what was live and what was simulated.
## Home and the team view
- Home is two sides. Left, vertically centred: one paper with the title, the Mine / Team switch, who it is for (one bold body line) and why (two meta lines), then the Planner. Right: your farms at the largest scale that fits (3 down to 1), centred in the room left, so nothing overflows at 1280x720 and 1920 has no empty half. On screens wider than 1680px the whole of Home sits centred.
- Mine / Team is a choice of two pack buttons (xs), cream for the chosen one. The title follows it: "Your projects" or "Your team".
- The team view is one paper on the right, scrolling inside itself if it must. It shows spend and outliers, never what anyone is doing: no timelines, no activity, no per-person ranking.
- It leads with the gold "Simulated team" tag and one line: people, agents, projects, spent.
- "Worth a look" holds outliers only, at most one of each: Cost spike (honey, coin), Same work twice (bark, star), Agents disagree (bark, chat). A row is the urgency tag, the project in bold with whose in meta ink, one line from the run itself, and an "Open" tan button that opens the project at that moment.
- "Budgets" is a ruled grid by area: the area's row has its budget per project in a soft well; each project under it has its name (a link), whose and how many agents in meta ink, the tick meter (12 ticks) and "$13 of $60". Over its limit, the spend turns berry.
- A new project starts with its area's budget as its spend limit. Changing the budget moves every project still on the old one; a project with a limit of its own keeps it.
- A teammate's project you open carries the gold "Simulated team" tag in the title and stays out of Mine.

## Visual system pass
- Tokens live once in `:root` of hud.css; nothing else sets a literal size, ink or corner.
  - Reading type: `--t-meta` 13, `--t-body` 15, `--t-lead` 17; big numbers `--t-big` 34, `--t-hero` 40.
  - Pixel type: `--px-tag` 13, `--px-xs` 15, `--px-sm` 17, `--px-btn` 20, `--px-name` 21, `--px-title` 24. The top bar's size steps use these only (the largest coin is `--t-big`).
  - Ink and fills: the ramp above plus `--cream` (type on coloured tags, the chosen half of a segment), `--honey-deep` (honey under cream type), `--honey-ink` (honey as text), `--paper-hi`, `--edge`, `--edge-soft`, `--rule` (every 1px row line), `--tint` (a grouped block), `--track` (the empty part of a bar or segment), `--shadow`, `--scrim`. Categorical swatches: `--k-skill`, `--k-tool`, `--k-connector`, `--k-file`, `--k-read`, `--k-write`.
  - Corners: `--r-s` 2 (bars, dots), `--r` 4 (tags, chips, swatches), `--r-m` 6 (segments, inset blocks). The pack's art keeps square pixel corners.
  - kit.css keeps literal fallbacks after each token so it loads anywhere; that is the only exception.
- One Simulated tag: `SimTag` (`.tag.sim`, `--honey-deep` under cream) for "Simulated", "Simulated sample", "Simulated run", "Simulated team", "Simulated (out of credits)" and "Projection". The gold chip (`.tag.gold`) shares the colour; its × or Undo tells it apart.
- Quiet states (`Quiet` in bits.tsx, `.quiet`): an icon, one bold body line, at most one meta line, on `--tint`. A failure is `tone="bad"`: `--berry-wash` behind, the bold line in berry, the error itself in mono. Used for:
  - the inbox with nothing in it ("Nothing yet."); an empty inbox section is left out, not labelled "Nothing yet";
  - Team with no outliers ("Nothing stands out.");
  - a live plan call that failed ("The live call failed, so this plan is simulated." with the error), and a plan that failed ("The Planner couldn’t split this goal into tasks.").
- Home with no projects: the empty plot's tag reads "+ Your first project" with "Tell the Planner what to build" under it.
- Paused: the title tag is bark-2 with a pause glyph, and the farm's canvas drains to 55% saturation (eased 400 ms; none under reduced motion) until you press Play. No other chrome.
- The farm camera centres each axis on its own: the whole farm (house and yard) when it fits, else every plot, else the work happening now or the popped proof. At 1920 the whole farm sits centred; on Done the plot columns stay centred while the rows follow the proof.
- Done is one calm block: the lead (17px), then gain, learned and projection lines 4px apart, then one row of actions with the download group at its end. Its first line counts every plot on the farm, the release and "Hard cases" included, the same as the top bar: "All 7 tasks are in and live for everyone." or "6 of 7 tasks done, rolled back, so nothing is live."
- The title paper is tight (4px padding, 8px gaps, 6px tag padding) so "0 of 6 tasks done", Paused and Simulated sample fit beside six top bar buttons at 1280.
