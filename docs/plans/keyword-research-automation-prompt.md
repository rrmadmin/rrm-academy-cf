# Keyword Research Automation Tool

## Task
Build a Playwright-based keyword research script that bulk-queries SearchVolume.io and returns monthly search volume estimates for a list of keywords.

## What SearchVolume.io Does
- Free bulk keyword volume lookup (up to 800 keywords per query)
- No login, no API key, no daily limit
- You paste keywords into a textarea, submit, and get back a table with monthly search volume estimates
- URL: https://searchvolume.io/

## Requirements

1. **Input:** Accept keywords from either:
   - A text file (one keyword per line)
   - Command-line arguments
   - stdin

2. **Process:**
   - Open SearchVolume.io with Playwright (use Chromium)
   - Paste keywords into the bulk input textarea
   - Select country (default: US)
   - Submit the form
   - Wait for results table to populate
   - Scrape the results table (keyword, monthly volume)

3. **Output:**
   - Print results as a formatted table to stdout
   - Optionally save as CSV with `--csv output.csv` flag
   - Sort by volume descending by default

4. **Batch handling:**
   - If more than 800 keywords, split into batches and combine results

## Location
Save the script to `~/iCode/scripts/keyword-volume.mjs` (Node.js, using Playwright).

Install Playwright if needed: `npm install playwright` in the scripts directory.

## Usage Examples
```bash
# From a file
node scripts/keyword-volume.mjs --file keywords.txt

# From arguments
node scripts/keyword-volume.mjs "rrm vs ivf" "naprotechnology vs ivf" "ivf alternatives"

# Save to CSV
node scripts/keyword-volume.mjs --file keywords.txt --csv results.csv

# Different country
node scripts/keyword-volume.mjs --country uk "ivf alternatives"
```

## Notes
- SearchVolume.io may change its DOM structure. Use resilient selectors (data attributes > CSS classes).
- The site renders results client-side, so wait for the table to populate before scraping.
- Add a `--headless` flag (default true) with `--visible` to show the browser for debugging.
- If the site adds anti-bot measures, fall back to Ahrefs Keyword Generator (free, no login, 100 keywords per query at ahrefs.com/keyword-generator).
