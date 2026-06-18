# Deploying RachitAI online (free)

Your app has two parts that both run on the host:
- `index.html` — the chat screen
- `server.js` — the brain that talks to Gemini

We'll put the code on **GitHub**, then host it on **Render** (free). Render runs
`server.js`, which also serves the chat page — so visitors just open one link.

---

## Step 1 — Put the code on GitHub

Open the **Terminal** app and run these (one time):

```bash
cd /Users/tripta/Desktop/RachitGPT

# Log in to GitHub (opens your browser — follow the prompts)
gh auth login
# Choose: GitHub.com  →  HTTPS  →  Login with a web browser

# Create the GitHub repo and upload your code
gh repo create rachitgpt --public --source=. --push
```

When it finishes, your code is on GitHub. (Your `.env` API key is NOT uploaded —
it's protected by `.gitignore`.)

---

## Step 2 — Host it on Render

1. Go to **https://render.com** and sign up (free — use "Sign in with GitHub").
2. Click **New +**  →  **Web Service**.
3. Connect GitHub and pick the **`rachitgpt`** repository.
4. Fill in the settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Scroll to **Environment Variables** → **Add Environment Variable**:
   - **Key:** `GEMINI_API_KEY`
   - **Value:** *(paste your key from the `.env` file)*
6. Click **Create Web Service**.

Render builds and starts your app (takes ~2–3 minutes). When it's done, you'll get
a public link like `https://rachitgpt.onrender.com` — share it with anyone!

---

## Notes

- **Free tier sleeps:** after ~15 min of no use, the free server "sleeps." The next
  visitor waits ~30 seconds for it to wake up. Normal for free hosting.
- **Updating later:** make your changes, then run:
  ```bash
  git add -A
  git commit -m "describe your change"
  git push
  ```
  Render automatically redeploys.
- **Watch your usage:** the app limits each visitor to 15 messages/minute, but keep an
  eye on your Gemini quota in Google AI Studio if it gets popular.
