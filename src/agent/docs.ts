// Synthetic source documents. The agents read these; the demo never types a conclusion
// the model is supposed to reach. Shared by the browser (for display) and the API (as model input).

export const DOCS: Record<string, string> = {
  'front-desk-hours.csv': `# Opening hours. Kept by the front desk. Last edited 14 August.
day,opens,closes
Monday,8:00,19:00
Tuesday,8:00,19:00
Wednesday,8:00,19:00
Thursday,8:00,19:00
Friday,8:00,19:00
Saturday,9:00,13:00
Sunday,closed,closed`,

  'vets.md': `# Our vets (Willow Lane Vets)

- Dogs and cats vet: checkups, vaccinations, surgery on Tuesdays and Thursdays.
- Small pets vet: rabbits, guinea pigs and other small pets. Checkups and vaccinations.
- Dental vet: cats and dogs. Checkups, vaccinations, dental.

A checkup or a vaccination takes 15 minutes. Surgery always starts with a call from a vet.
Which vet works which day is set by the staff schedule, not here.`,

  'brand-style.md': `# How Willow Lane Vets looks and sounds (Design skill)
- Warm green (#2f6b4f) for actions, cream (#fbf7ef) behind pages.
- Plain words. "Book a visit", never "Schedule an appointment".
- One question per screen on a phone. Big tap targets, at least 44 px.
- Use the pet's name once we know it.`,

  'owner-data.md': `# Owners' data (Practice team skill)
- Collect a phone number only to send the reminder the owner asked for.
- Never write a phone number or a pet's medical notes to the logs.
- Texts go out between 9:00 and 20:00, and every text says how to cancel.
- Outside production, texts go to staging phones only.`,

  'lesson-phone-first.md': `# Lesson: design for phones first (saved from a past harvest)
Most owners book from a phone. Check every page at phone width before the review.`,

  'staff-schedule/schedule.md': `# Staff schedule (Practice team)

Updated 3 November. Which vet works when, week by week.

Weekdays: 8:00 to 19:00, two vets on every day.
Saturdays: no vet works Saturdays from 1 December. The clinic is closed on Saturdays from that date.
Dogs and cats vet: Monday to Thursday. Small pets vet: Tuesday to Friday. Dental vet: Monday, Wednesday, Friday.`,

  'staff-schedule/CHANGELOG.md': `# Staff schedule: changelog (Practice team)

## 3 November
- Winter schedule published. No vet works Saturdays from 1 December.
- Saturday visits already booked after 1 December move to weekdays. The front desk is calling owners.

## 6 October
- The dental vet moves to Monday, Wednesday and Friday.`,
}

// What the neighbouring project (Staff schedule) shares with other farms.
export const NEIGHBOUR_DOCS = ['staff-schedule/schedule.md', 'staff-schedule/CHANGELOG.md']

// A signpost can be a single file or a folder; a folder expands to every document inside it.
export function expandSignposts(names: string[]) {
  const out: string[] = []
  for (const n of names) {
    const hits = n.endsWith('/') ? Object.keys(DOCS).filter((k) => k.startsWith(n)) : DOCS[n] ? [n] : []
    for (const h of hits) if (!out.includes(h)) out.push(h)
  }
  return out
}
