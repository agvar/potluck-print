# Setup guide: from zero to printing

Do these in order. Each part says **what** you're doing and **why**.
Time needed: about 45–60 minutes the first time.

---

## Part 1: Supabase (the database), ~15 min

**Why:** guests' phones and your iPhone never talk to each other directly.
They both talk to this database. Guests add dishes; your admin page reads them.

1. Go to **supabase.com** → *Start your project* → sign in with **GitHub**
   (create a free GitHub account first if you don't have one; you'll need it in Part 4 anyway).
2. **New project**
   - Name: `potluck-print`
   - Database password: click *Generate* and save it in your password manager
     (you won't need it for this app, but keep it).
   - Region: the one closest to you.
   - Wait ~2 minutes while it's created.
3. **Create the tables and security rules**
   - Left menu → **SQL Editor** → **New query**.
   - Open [`supabase/setup.sql`](supabase/setup.sql) on your Mac, copy **everything**, paste it in, click **Run**.
   - You should see *"Success. No rows returned."*
   - 📖 Read through the file. It's commented line by line and is the heart of the app's security.
4. **Create your admin login**
   - Left menu → **Authentication** → **Users** → **Add user** → **Create new user**.
   - Enter your email and a strong password, tick **Auto Confirm User**, click **Create user**.
5. **Make yourself admin.** Back in **SQL Editor**, new query, run (with your email):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
   It should say *"1 row"*. If it says 0, the email doesn't match the user you created.
6. **Stop strangers from creating accounts:** **Authentication** → **Sign In / Providers**
   (or *Settings*) → turn **off** *"Allow new users to sign up"* → Save.
   *Why:* only you need an account. Guests don't log in at all.
7. **Copy your two connection values:** **Project Settings** (gear icon) → **API Keys** (and **Data API** for the URL):
   - **Project URL**, like `https://abcdefgh.supabase.co`
   - **Publishable key**, starts with `sb_publishable_`
     (older projects call it the **anon** key, which works the same).
   - ⚠️ Do **not** use the *secret* / *service_role* key anywhere in this app.

---

## Part 2: Run it on your Mac, ~5 min

**Why:** you can try everything locally before putting it on the internet.

In Terminal, in the `potluck_print` folder:

```bash
cp .env.example .env.local
```

Open `.env.local` and paste in your Project URL and publishable key. Then:

```bash
npm run dev
```

- Guest page: http://localhost:5173/
- Admin page: http://localhost:5173/admin.html

**Try it:** submit a dish on the guest page, then sign in on the admin page. The dish should
appear in *Waiting*. Submit a second one; it should pop up within a second with a chime.
Tap **Print next 2** and the label PDF opens.

> **Test on your iPhone before deploying (optional):** with your iPhone on the same home Wi-Fi,
> run `npm run dev -- --host`. Vite prints a *Network* address like `http://192.168.1.20:5173`;
> open that in Safari on the iPhone.

---

## Part 3: Phone notifications with ntfy, ~5 min

**Why:** your iPhone buzzes whenever a guest submits, so you don't have to keep checking.

1. Make a secret channel name. In Terminal:
   ```bash
   echo "potluck-$(openssl rand -hex 8)"
   ```
   Copy the result (e.g. `potluck-3f9a1c2b7d4e6a01`).
   *Why random?* Anyone who knows the name can read the alerts, so it must be unguessable.
   The alerts only contain dish and cook names.
2. On your iPhone, install **ntfy** from the App Store → tap **+** → paste the channel name →
   **Subscribe** → allow notifications.
3. In Supabase **SQL Editor**, run (paste your channel name; you'll fix the URL in Part 4):
   ```sql
   update private.app_config
   set ntfy_topic = 'potluck-3f9a1c2b7d4e6a01',
       admin_url  = 'http://localhost:5173/admin.html'
   where id = 1;
   ```
4. Submit a dish on the guest page → your iPhone should buzz.

---

## Part 4: Put it on the internet (GitHub + Vercel), ~15 min

**Why:** guests' phones need a public HTTPS address. Vercel hosts the site for free and
redeploys automatically every time you push code to GitHub.

1. **GitHub:** go to github.com → **New repository** → name `potluck-print` → **Private** →
   create (don't add a README). Then in Terminal (in `potluck_print`), save a first
   snapshot of the code (skip if already committed) and connect it to GitHub:
   ```bash
   git add -A && git commit -m "Potluck Print v1"
   ```
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/potluck-print.git
   ```
   ```bash
   git push -u origin main
   ```
2. **Vercel:** go to vercel.com → sign up with **GitHub** → **Add New… → Project** →
   import `potluck-print`.
   - Framework preset: **Vite** (auto-detected).
   - Open **Environment Variables** and add both:
     - `VITE_SUPABASE_URL` = your Project URL
     - `VITE_SUPABASE_PUBLISHABLE_KEY` = your publishable key
   - Click **Deploy**. After ~1 minute you get an address like `https://potluck-print-xyz.vercel.app`.
3. Point the notification at the live admin page (Supabase SQL Editor):
   ```sql
   update private.app_config
   set admin_url = 'https://YOUR-APP.vercel.app/admin'
   where id = 1;
   ```
4. On your iPhone, open `https://YOUR-APP.vercel.app/admin`, sign in, then
   Share → **Add to Home Screen** so it's one tap away at the party.

From now on: change code, `git commit`, `git push`, and Vercel updates the site in about a minute.

---

## Part 5: Printer and label test, ~15 min

1. Make sure the DeskJet is on Wi-Fi and your iPhone can print to it
   (open any photo → Share → Print → it should list the DeskJet).
2. Admin page → **Label position** → **Print alignment test** → in the share sheet tap
   **Print** → DeskJet → set **Scale 100%** if offered → Print on **plain paper**.
3. Hold the printout over a label sheet against a window or lamp.
   - The solid boxes should match the label edges.
   - Off by a bit? Change **Nudge** (e.g. `0.05` = 1/20 inch) → **Save** → print again.
   - Labels a different size or position? Measure your sheet and fix the margins.
4. Load **one label sheet**. Note which way up it goes (on most DeskJets it's
   *label side up, top edge going in first*). → **Print sample labels**.
5. Test a **single** label: submit 1 dish → *Print alone on a fresh sheet* → then submit
   another → *Print on leftover bottom half* → feed the same sheet back in the **same way**.

---

## Part 6: Network fallbacks (test at home)

At the venue your iPhone and the printer must be on the **same** network. Test each:

| Setup | How |
|---|---|
| Venue Wi-Fi | Printer + iPhone join it. Easiest if it has no "click to accept" page. |
| iPhone hotspot | Settings → Personal Hotspot → on, **Maximize Compatibility** on → printer joins it (HP app → printer → Wi-Fi settings). |
| Printer Wi-Fi Direct | iPhone joins the printer's own `DIRECT-xx-HP DeskJet…` network (password is on the printer's info page). |

Guests don't need any of these. They use their own mobile data.

---

## Party-day checklist

- [ ] Printer: on, on the network, paper tray loaded with label sheets (right side up), ink OK
- [ ] iPhone: charged and **plugged in**, Auto-Lock **Never**, Focus/Do Not Disturb **off**
- [ ] ntfy notifications working (submit a test dish, then delete it in Edit)
- [ ] Admin page open and signed in, "live" badge showing
- [ ] QR code sign taped up (Admin → Guest QR code → Download)
- [ ] Spare label sheets and plain paper for the allergen list
- [ ] Backup: if the network fails, guests can still submit; you print later or from another spot

## After the party

- Print the **Buffet allergen list** from the admin page anytime.
- To clean up: Supabase → Table Editor → `dishes` → delete rows, or pause/delete the project.
