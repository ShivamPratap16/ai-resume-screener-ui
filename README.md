# Resume Screener UI

A small web interface for [ai-resume-screener](https://github.com/ShivamPratap16/ai-resume-screener). Drop in resumes, get a ranked shortlist, and click any candidate to see why they got each point.

Plain HTML, CSS and JavaScript: no framework, no build step, no dependencies.

## Features

- Drag-and-drop upload of PDF / DOCX / TXT resumes, with a live backend status indicator
- Summary tiles, plus **Ranked / Rejected / Failed** tabs with search
- Score bars split by category (AI depth, Python & backend, cloud, GitHub, engineering, penalties), with hover tooltips
- Detail panel per candidate: project summary, per-category evidence, strengths and concerns, GitHub activity, resume quotes
- **Demo mode** with fictional candidates, so it works without the backend; or open any `results.json`
- Export results as JSON; light and dark themes; works on mobile
- Resume text is always rendered as plain text, never as HTML

## Run it

**1. Start the backend** (in the `ai-resume-screener` folder):

```bash
uvicorn screener.api:app --app-dir src --port 8000
```

**2. Start the UI** (in this folder; standard-library Python 3.10+ only):

```bash
python serve.py
```

**3. Open** http://127.0.0.1:5173

`serve.py` serves the page and forwards `/api/*` to the backend, so the browser sees a single origin and the backend needs no CORS changes. It listens on `127.0.0.1` only, because the page uploads resumes. Use `--backend` to point at a different URL, or `--port` to change the UI port.

To just look around, click **Load demo results**. It needs no backend.

## Project layout

```
public/
  index.html                  page structure
  styles.css                  light/dark theme tokens and layout
  app.js                      upload, API calls, rendering
  demo/sample-results.json    output for 51 synthetic resumes (fictional people)
serve.py                      static server + /api proxy (standard library only)
```
