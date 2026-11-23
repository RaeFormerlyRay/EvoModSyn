# Daily module research regimen

Runs once a day at 7:43 AM Chicago time and posts a short digest in the "Research modules musicians want" project thread.

## Each day (about 15 minutes of searching)

1. **New releases (every day).** Synth Anatomy Eurorack category, MatrixSynth "New Modules" label, Gearnews and Perfect Circuit Signal. Note every new module or major firmware update since the last run.
2. **Trend check (every day).** ModularGrid "Popular modules in racks" (last 12 months, top 100). Record rank changes and new entries against yesterday's snapshot.
3. **One forum deep dive (rotating by weekday).**
   - Monday: ModularGrid forum (rack advice and "what's missing" threads)
   - Tuesday: r/modular and r/eurorack (via search, "what should I get", "end-game modules")
   - Wednesday: lines (llllllll.co), especially norns/crow/teletype and generative threads
   - Thursday: ModWiggler (via search snippets, since the site refuses automated reading)
   - Friday: VCV Rack community and library (software modular, the closest audience to PatchMind)
   - Saturday: Elektronauts Eurorack threads and YouTube demo channels (DivKid, Loopop, Mylar Melodies, Red Means Recording)
   - Sunday: manuals. Read the manual of one module on the wishlist or one rising in the trend check, and write down the controls and behaviours worth modelling.
4. **Score every finding** from 0 to 3 on each of: demand (how often people ask for or buy it), gap (PatchMind has nothing like it), AI value (gives the performer new moves), and build cost (inverted: 3 is easy in Web Audio). Anything scoring 9 or more is a candidate for the wishlist.
5. **Write it down.**
   - Append the day's findings to `/mnt/project-files/research/daily/YYYY-MM-DD.md`.
   - Add each new module name to `/mnt/project-files/research/seen.md` so it is not reported twice.
   - When a finding changes the priorities, update `docs/research/module-wishlist.md` on the research branch and say so in the digest.
6. **Post the digest.** Five bullets or fewer: what is new, what is trending, and any recommended change to the wishlist. If nothing new turned up, say so in one line.

## Rules

- Only report modules or ideas not already in `seen.md`.
- Name the source for every claim.
- Never post on forums or contact anyone; the regimen only reads.
- If a source refuses automated reading, use search results about it instead and say so.
